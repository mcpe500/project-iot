/*
 * Camera Manager Implementation
 * Camera initialization, frame capture, and upload functions
 */

#include "camera_manager.h"

// ===========================
// Camera Initialization
// ===========================

void initCamera() {
  Serial.println("Initializing OV5640 camera for HIGH-SPEED STREAMING...");
  
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = XCLK_FREQ_HZ;
  
  // --- HYBRID CONFIGURATION FOR OPTIMAL PERFORMANCE ---
  config.frame_size = FRAMESIZE_VGA;       // 640x480 for better performance (was SVGA 800x600)
  
  #if USE_RAW_STREAMING
    config.pixel_format = PIXFORMAT_RGB565;  // Raw pixels for maximum speed
    Serial.println("Using RAW RGB565 streaming mode");
  #else
    config.pixel_format = PIXFORMAT_JPEG;    // Optimized JPEG for reliability
    config.jpeg_quality = JPEG_QUALITY_OPTIMIZED;
    Serial.println("Using optimized JPEG streaming mode with aggressive compression");
  #endif
  
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  // Optimize for PSRAM
  if (psramFound()) {
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.fb_count = FB_COUNT_PSRAM;
    #if !USE_RAW_STREAMING
      config.jpeg_quality = JPEG_QUALITY_HIGH;
    #endif
    Serial.println("PSRAM found - using optimized settings");
  } else {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.fb_count = FB_COUNT_DRAM;
    Serial.println("No PSRAM - using conservative settings");
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    delay(5000);
    ESP.restart();
    return;
  }

  Serial.println("Camera initialized successfully!");

  // Configure sensor for optimal image quality
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    s->set_framesize(s, FRAMESIZE_VGA);  // VGA for better performance
    
    #if !USE_RAW_STREAMING
      s->set_quality(s, JPEG_QUALITY_OPTIMIZED);  // Aggressive compression for speed
    #endif
    
    // Optimize sensor settings for high FPS
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);     // Reset contrast for speed
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_aec_value(s, 300);  // Lower exposure for faster processing
    s->set_gain_ctrl(s, 1);
    s->set_gainceiling(s, (gainceiling_t)2);  // Lower gain for speed
    s->set_bpc(s, 0);          // Disable some processing for speed
    s->set_wpc(s, 0);
    s->set_raw_gma(s, 0);
    s->set_lenc(s, 0);
    
    Serial.println("Camera configured for HIGH-SPEED streaming");
  }
}

// ===========================
// Frame Capture and Upload
// ===========================

void captureAndSendFrame() {
  frameCount++;
  yield();
  
  // Check thermal conditions before capture
  checkThermalConditions();
  
  if (WiFi.status() != WL_CONNECTED) {
    if (frameCount % WIFI_STATUS_LOG_INTERVAL == 0) {
      Serial.println("WiFi not connected - skipping frame");
    }
    dropCount++;
    return;
  }
  
  unsigned long captureStart = millis();
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    dropCount++;
    return;
  }
  
  unsigned long captureTime = millis() - captureStart;
  unsigned long sendStart = millis();
  bool success = sendFrameWithRetry(fb);
  unsigned long sendTime = millis() - sendStart;
  
  if (success) {
    successCount++;
    totalBytes += fb->len;
    if (frameCount % FRAME_LOG_INTERVAL == 0) {
      Serial.printf("✓ Frame #%lu: %lu bytes, Cap: %lums, Send: %lums", 
                    frameCount, fb->len, captureTime, sendTime);
      if (thermalThrottling) {
        Serial.printf(" [THERMAL: %.1f°C]", currentTemperature);
      }
      Serial.println();
    }
  } else {
    dropCount++;
    if (frameCount % FAILURE_LOG_INTERVAL == 0) {
      Serial.printf("✗ Frame #%lu failed (%lu bytes)", frameCount, fb->len);
      if (thermalThrottling) {
        Serial.printf(" [THERMAL: %.1f°C]", currentTemperature);
      }
      Serial.println();
    }
  }

  esp_camera_fb_return(fb);
}

// ===========================
// Enhanced Frame Upload with Retry Logic
// ===========================

bool sendFrameWithRetry(camera_fb_t* fb) {
  if (!fb || fb->len == 0) return false;
  if (WiFi.status() != WL_CONNECTED) return false;
  
  // Single attempt with reduced timeout for maximum speed
  if (frameCount % FRAME_LOG_INTERVAL == 0) {
    Serial.printf("Uploading frame (size: %lu bytes) with fast timeout\n", fb->len);
  }
  
  if (sendFrameToURL(fb, SERVER_URL, HTTP_TIMEOUT_MS)) {
    if (frameCount % FRAME_LOG_INTERVAL == 0) {
      Serial.println("✅ Upload successful");
    }
    return true;
  }
  
  // Log failure details periodically
  if (frameCount % FAILURE_LOG_INTERVAL == 0) {
    Serial.printf("❌ Upload failed for frame #%lu (size: %lu bytes)\n", frameCount, fb->len);
  }
  
  return false;
}

// Hybrid function that sends either raw pixels or JPEG based on configuration
bool sendFrameToURL(camera_fb_t* fb, const char* url, int timeout_ms) {
    if (!fb || fb->len == 0) return false;
    if (WiFi.status() != WL_CONNECTED) return false;

    // Connect to the server using the defined host and port
    if (!client.connect(SERVER_HOST, SERVER_PORT)) {
        if (frameCount % FAILURE_LOG_INTERVAL == 0) {
            Serial.println("Connection to server failed!");
        }
        return false;
    }

    #if USE_RAW_STREAMING
        // --- RAW RGB565 STREAMING MODE ---
        client.print("POST " + String(SERVER_PATH) + " HTTP/1.1\r\n");
        client.print("Host: " + String(SERVER_HOST) + "\r\n");
        client.print("X-API-Key: " + String(API_KEY) + "\r\n");
        client.print("Content-Type: application/octet-stream\r\n");
        client.print("X-Frame-Format: RGB565\r\n");
        client.print("X-Frame-Width: " + String(fb->width) + "\r\n");
        client.print("X-Frame-Height: " + String(fb->height) + "\r\n");
        client.print("X-Device-Id: " + String(DEVICE_ID) + "\r\n");
        client.print("Content-Length: " + String(fb->len) + "\r\n");
        client.print("Connection: close\r\n");
        client.print("\r\n");
        
        // Send raw pixel data
        if (client.write(fb->buf, fb->len) != fb->len) {
            if (frameCount % FAILURE_LOG_INTERVAL == 0) {
                Serial.println("Failed to send raw frame buffer.");
            }
            client.stop();
            return false;
        }
    #else
        // --- OPTIMIZED JPEG STREAMING MODE ---
        String boundary = "----ESP32CAMBoundary";
        String header = "--" + boundary + "\r\n"
                        "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
                        "Content-Type: image/jpeg\r\n\r\n";
        String footer = "\r\n--" + boundary + "--\r\n";
        
        size_t totalLength = header.length() + fb->len + footer.length();

        client.print("POST " + String(SERVER_PATH) + " HTTP/1.1\r\n");
        client.print("Host: " + String(SERVER_HOST) + "\r\n");
        client.print("X-API-Key: " + String(API_KEY) + "\r\n");
        client.print("X-Device-Id: " + String(DEVICE_ID) + "\r\n");
        client.print("Content-Length: " + String(totalLength) + "\r\n");
        client.print("Content-Type: multipart/form-data; boundary=" + boundary + "\r\n");
        client.print("Connection: close\r\n");
        client.print("\r\n");

        // Send multipart form data
        client.print(header);
        client.write(fb->buf, fb->len);
        client.print(footer);
    #endif

    // --- Wait for the server's response ---
    unsigned long responseTimeout = millis();
    while (client.connected() && !client.available() && millis() - responseTimeout < timeout_ms) {
        delay(10);
    }
    
    bool success = false;
    if (client.available()) {
        String line = client.readStringUntil('\n');
        if (line.indexOf("200 OK") > 0) {
            success = true;
        } else if (frameCount % FAILURE_LOG_INTERVAL == 0) {
            Serial.printf("HTTP Error: Unexpected response: %s\n", line.c_str());
        }
    } else if (frameCount % FAILURE_LOG_INTERVAL == 0) {
        Serial.println("HTTP Response Timeout");
    }

    // Cleanly close the connection
    client.stop();
    return success;
}

// Legacy function - now uses the retry logic
bool sendFrameToServer(camera_fb_t* fb) {
  return sendFrameWithRetry(fb);
}

// ===========================
// Thermal Management Functions
// ===========================

float getESP32Temperature() {
  // ESP32-S3 has internal temperature sensor
  // Note: This is an approximation, actual implementation may vary
  
  // Method 1: Use ESP32 internal temperature sensor (if available)
  #ifdef SOC_TEMP_SENSOR_SUPPORTED
    // Use built-in temperature sensor API if available
    float temp = temperatureRead();
    return temp;
  #endif
  
  // Method 2: Estimate based on CPU frequency and load
  // Higher CPU usage and frequency = higher temperature
  uint32_t cpuFreq = getCpuFrequencyMhz();
  uint32_t freeHeap = ESP.getFreeHeap();
  uint32_t totalHeap = ESP.getHeapSize();
  float heapUsage = (float)(totalHeap - freeHeap) / totalHeap;
  
  // Rough temperature estimation formula (more conservative)
  // Base temperature + CPU frequency factor + load factor
  float estimatedTemp = 30.0 + (cpuFreq - 160) * 0.12 + heapUsage * 8.0;
  
  // Add some variance based on frame processing
  if (successCount > 0) {
    float processingLoad = (float)frameCount / (millis() / 1000.0);
    estimatedTemp += processingLoad * 0.3;
  }
  
  // Account for ambient and startup warming
  unsigned long runtime = millis();
  if (runtime < 60000) { // First minute
    estimatedTemp += 5.0; // Assume higher initial temperature
  } else if (runtime < 300000) { // First 5 minutes
    estimatedTemp += 2.0; // Gradual warm-up
  }
  
  return estimatedTemp;
}

float getAveragedTemperature() {
  // Add current temperature to history
  temperatureHistory[temperatureHistoryIndex] = getESP32Temperature();
  temperatureHistoryIndex = (temperatureHistoryIndex + 1) % TEMPERATURE_AVERAGING_SAMPLES;
  
  // Calculate average
  float sum = 0;
  for (int i = 0; i < TEMPERATURE_AVERAGING_SAMPLES; i++) {
    sum += temperatureHistory[i];
  }
  
  return sum / TEMPERATURE_AVERAGING_SAMPLES;
}

void checkThermalConditions() {
  if (!ENABLE_THERMAL_MANAGEMENT) return;
  
  unsigned long currentTime = millis();
  if (currentTime - lastTemperatureCheck < TEMPERATURE_CHECK_INTERVAL_MS) {
    return;
  }
  
  // Get averaged temperature for more stable readings
  currentTemperature = getAveragedTemperature();
  lastTemperatureCheck = currentTime;
  
  // Handle startup cooling phase
  if (AGGRESSIVE_COOLING_AT_STARTUP && startupCoolingPhase) {
    if (currentTime < startupPhaseEndTime) {
      // Keep conservative settings during startup
      if (!thermalThrottling) {
        Serial.println("🚀 Startup phase: Using conservative settings for stable quality");
        thermalThrottling = true;
        thermalAdjustedFPS = TARGET_FPS * 0.8;
        applyThermalOptimizations(currentTemperature);
      }
      return;
    } else {
      // End startup phase
      startupCoolingPhase = false;
      Serial.println("✅ Startup phase complete - switching to normal thermal management");
    }
  }
  
  // Log temperature periodically
  if (frameCount % (FRAME_LOG_INTERVAL * 4) == 0) {
    Serial.printf("🌡️ Temperature: %.1f°C", currentTemperature);
    if (thermalThrottling) {
      Serial.printf(" (OPTIMIZED)");
    }
    if (proactiveCoolingActive) {
      Serial.printf(" (PROACTIVE)");
    }
    Serial.println();
  }
  
  // Apply thermal management with hysteresis to prevent oscillation
  if (currentTemperature >= TEMPERATURE_THRESHOLD_CRITICAL) {
    if (!thermalThrottling) {
      Serial.printf("🔥 CRITICAL TEMPERATURE: %.1f°C - Applying aggressive cooling\n", currentTemperature);
      thermalThrottling = true;
      proactiveCoolingActive = false;
      
      // Aggressive thermal management
      thermalAdjustedFPS = TARGET_FPS * 0.6; // More aggressive FPS reduction
      
      applyThermalOptimizations(currentTemperature);
      
      // Force cooling delay
      delay(COOLING_DELAY_MS);
    }
  }
  else if (currentTemperature >= TEMPERATURE_THRESHOLD_HIGH) {
    if (!thermalThrottling) {
      Serial.printf("🔥 HIGH TEMPERATURE: %.1f°C - Applying thermal optimizations\n", currentTemperature);
      thermalThrottling = true;
      proactiveCoolingActive = false;
    }
    
    // Moderate thermal management
    thermalAdjustedFPS = TARGET_FPS * THERMAL_FPS_REDUCTION_FACTOR;
    
    applyThermalOptimizations(currentTemperature);
  }
  else if (PROACTIVE_COOLING_ENABLED && currentTemperature >= TEMPERATURE_THRESHOLD_WARM) {
    if (!proactiveCoolingActive && !thermalThrottling) {
      Serial.printf("⚠️ WARM TEMPERATURE: %.1f°C - Applying proactive optimizations\n", currentTemperature);
      proactiveCoolingActive = true;
      
      // Light proactive optimizations
      thermalAdjustedFPS = TARGET_FPS * 0.9; // Slight FPS reduction
      
      applyProactiveOptimizations();
    }
  }
  else if (currentTemperature < TEMPERATURE_THRESHOLD_WARM - 3.0) { // Hysteresis
    if (thermalThrottling || proactiveCoolingActive) {
      Serial.printf("❄️ Temperature normalized: %.1f°C - Restoring optimal settings\n", currentTemperature);
      thermalThrottling = false;
      proactiveCoolingActive = false;
      resetCameraToOptimalSettings();
    }
  }
}

void applyThermalOptimizations(float temperature) {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  
  Serial.printf("🔧 Applying thermal optimizations for %.1f°C\n", temperature);
  
  // Reduce sensor gain to minimize noise and heat generation
  s->set_gain_ctrl(s, 1);
  if (temperature >= TEMPERATURE_THRESHOLD_CRITICAL) {
    s->set_gainceiling(s, (gainceiling_t)1); // Lowest gain ceiling for critical temp
  } else {
    s->set_gainceiling(s, (gainceiling_t)2); // Lower gain ceiling
  }
  
  // Optimize exposure for heat conditions
  s->set_exposure_ctrl(s, 1);
  if (temperature >= TEMPERATURE_THRESHOLD_CRITICAL) {
    s->set_aec_value(s, 250); // Lower exposure for critical temp
  } else {
    s->set_aec_value(s, 300); // Slightly lower exposure to reduce sensor heat
  }
  
  // Improve white balance for thermal stability
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  
  // Adjust image processing for better quality under heat
  s->set_bpc(s, 1);      // Black pixel correction
  s->set_wpc(s, 1);      // White pixel correction
  s->set_raw_gma(s, 1);  // Gamma correction
  s->set_lenc(s, 1);     // Lens correction
  
  // Enhanced denoise settings for high temperature
  s->set_denoise(s, 1);  // Enable denoise if available
  
  // Brightness and contrast adjustments for heat
  s->set_brightness(s, 0);
  s->set_contrast(s, 2);  // Slightly higher contrast to compensate for quality loss
  s->set_saturation(s, 1); // Maintain good saturation
  
  // If temperature is very high, temporarily reduce resolution
  if (temperature >= TEMPERATURE_THRESHOLD_CRITICAL) {
    Serial.println("📉 Reducing resolution to VGA for cooling");
    s->set_framesize(s, FRAMESIZE_VGA);
  } else if (temperature >= TEMPERATURE_THRESHOLD_HIGH) {
    // Keep current resolution but optimize settings
    Serial.println("⚙️ Optimizing settings for high temperature");
  }
}

void applyProactiveOptimizations() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  
  Serial.println("🛡️ Applying proactive thermal optimizations");
  
  // Light optimizations to prevent overheating
  s->set_gain_ctrl(s, 1);
  s->set_gainceiling(s, (gainceiling_t)3); // Moderate gain ceiling
  
  s->set_exposure_ctrl(s, 1);
  s->set_aec_value(s, 350); // Slightly reduced exposure
  
  // Ensure all quality enhancements are active
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_denoise(s, 1);
  
  // Maintain good image quality
  s->set_brightness(s, 0);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
}

void resetCameraToOptimalSettings() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  
  Serial.println("🔄 Resetting camera to optimal VGA settings for speed");
  
  thermalAdjustedFPS = TARGET_FPS;
  
  // ENSURE WE RESET TO VGA FOR SPEED
  s->set_framesize(s, FRAMESIZE_VGA);
  s->set_quality(s, JPEG_QUALITY_OPTIMIZED);  // High compression number for speed
  
  // Restore fast settings
  s->set_gainceiling(s, (gainceiling_t)2);  // Lower for speed
  s->set_aec_value(s, 300);
  s->set_brightness(s, 0);
  s->set_contrast(s, 0);
  s->set_saturation(s, 0);
  
  // Disable processing for speed
  s->set_bpc(s, 0);
  s->set_wpc(s, 0);
  s->set_raw_gma(s, 0);
  s->set_lenc(s, 0);
  s->set_dcw(s, 0);
}
