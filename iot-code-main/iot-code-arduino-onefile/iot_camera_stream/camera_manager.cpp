/*
 * Camera Manager Implementation
 * Camera initialization, frame capture, and upload functions
 */

#include "camera_manager.h"

// ===========================
// Camera Initialization
// ===========================

void initCamera() {
  Serial.println("Initializing OV5640 camera...");
  
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
  config.frame_size = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.jpeg_quality = JPEG_QUALITY_INITIAL;
  config.fb_count = FB_COUNT_DRAM;

  // Optimize for PSRAM
  if (psramFound()) {
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.jpeg_quality = JPEG_QUALITY_PSRAM;
    config.fb_count = FB_COUNT_PSRAM;
    Serial.println("PSRAM found - using optimized settings");
  } else {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.jpeg_quality = JPEG_QUALITY_DRAM;
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

  // Configure sensor
  sensor_t* s = esp_camera_sensor_get();
  if (s) {
    // Basic settings
    s->set_framesize(s, FRAMESIZE_VGA);
    s->set_brightness(s, 0);
    s->set_contrast(s, 0);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_gain_ctrl(s, 1);
    
    // Upgrade to 720p if PSRAM available
    if (psramFound()) {
      delay(2000);
      Serial.println("Upgrading to 720p...");
      s->set_framesize(s, FRAMESIZE_HD);  // Enable 720p for PSRAM systems
      s->set_quality(s, JPEG_QUALITY_PSRAM);
      s->set_contrast(s, 1);
      s->set_gainceiling(s, (gainceiling_t)4);
      s->set_bpc(s, 1);
      s->set_wpc(s, 1);
      s->set_raw_gma(s, 1);
      s->set_lenc(s, 1);
      s->set_dcw(s, 1);
      s->set_aec_value(s, 400);
      Serial.println("Camera upgraded to 720p");
    }
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
  
  // Try primary server first with reduced timeout
  for (int retry = 0; retry < MAX_SERVER_RETRIES; retry++) {
    int timeout = HTTP_TIMEOUT_MS - (retry * SERVER_TIMEOUT_REDUCTION_STEP);
    if (timeout < 2000) timeout = 2000; // Minimum 2 seconds
    
    if (frameCount % FRAME_LOG_INTERVAL == 0) {
      Serial.printf("Attempting upload to primary server (retry %d/%d, timeout: %dms)\n", 
                    retry + 1, MAX_SERVER_RETRIES, timeout);
    }
    
    if (sendFrameToURL(fb, SERVER_URL, timeout)) {
      if (frameCount % FRAME_LOG_INTERVAL == 0) {
        Serial.println("✅ Primary server upload successful");
      }
      return true;
    }
    
    delay(500 * (retry + 1)); // Progressive delay: 500ms, 1s, 1.5s
  }
  
  // If primary server fails and fallback is enabled
  if (USE_FALLBACK_ON_ERROR) {
    if (frameCount % FAILURE_LOG_INTERVAL == 0) {
      Serial.println("Primary server failed, trying fallback server...");
    }
    
    if (sendFrameToURL(fb, FALLBACK_SERVER_URL, 3000)) {
      if (frameCount % FAILURE_LOG_INTERVAL == 0) {
        Serial.println("✅ Fallback server upload successful");
      }
      return true;
    }
  }
  
  // Log failure details periodically
  if (frameCount % FAILURE_LOG_INTERVAL == 0) {
    Serial.printf("❌ All upload attempts failed for frame #%lu\n", frameCount);
  }
  
  return false;
}

bool sendFrameToURL(camera_fb_t* fb, const char* url, int timeout_ms) {
  if (!fb || fb->len == 0 || !url) return false;
  if (WiFi.status() != WL_CONNECTED) return false;

  http.begin(client, url);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(timeout_ms);
  
  String boundary = "----ESP32CAMBoundary";
  String header = "--" + boundary + "\r\n"
                  "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
                  "Content-Type: image/jpeg\r\n\r\n";
  String footer = "\r\n--" + boundary + "--\r\n";
  
  size_t totalLength = header.length() + fb->len + footer.length();
  
  // Always try the complete payload method first for simplicity
  uint8_t* payload = (uint8_t*)malloc(totalLength);
  if (payload) {
    memcpy(payload, header.c_str(), header.length());
    memcpy(payload + header.length(), fb->buf, fb->len);
    memcpy(payload + header.length() + fb->len, footer.c_str(), footer.length());
    
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    int httpCode = http.POST(payload, totalLength);
    free(payload);
    
    // Only log errors periodically to avoid spam
    if (httpCode != 200 && frameCount % FAILURE_LOG_INTERVAL == 0) {
      Serial.printf("HTTP Error: %d for URL: %s\n", httpCode, url);
      if (httpCode > 0) {
        String response = http.getString();
        Serial.printf("Error response: %s\n", response.substring(0, 100).c_str());
      } else {
        Serial.printf("Request failed: %s\n", http.errorToString(httpCode).c_str());
      }
    }
    
    http.end();
    return (httpCode == 200);
  } else {
    // Memory allocation failed
    if (frameCount % FAILURE_LOG_INTERVAL == 0) {
      Serial.printf("Memory allocation failed for frame upload (size: %d)\n", totalLength);
    }
    http.end();
    return false;
  }
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
        thermalAdjustedQuality = JPEG_QUALITY_PSRAM + 1;
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
      thermalAdjustedQuality = JPEG_QUALITY_PSRAM + 3; // Lower compression for quality
      
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
    thermalAdjustedQuality = JPEG_QUALITY_PSRAM + THERMAL_QUALITY_ADJUSTMENT;
    
    applyThermalOptimizations(currentTemperature);
  }
  else if (PROACTIVE_COOLING_ENABLED && currentTemperature >= TEMPERATURE_THRESHOLD_WARM) {
    if (!proactiveCoolingActive && !thermalThrottling) {
      Serial.printf("⚠️ WARM TEMPERATURE: %.1f°C - Applying proactive optimizations\n", currentTemperature);
      proactiveCoolingActive = true;
      
      // Light proactive optimizations
      thermalAdjustedFPS = TARGET_FPS * 0.9; // Slight FPS reduction
      thermalAdjustedQuality = JPEG_QUALITY_PSRAM; // Keep quality but optimize sensors
      
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
  
  // Adjust quality dynamically
  s->set_quality(s, thermalAdjustedQuality);
  
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
  s->set_quality(s, thermalAdjustedQuality);
}

void resetCameraToOptimalSettings() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) return;
  
  Serial.println("🔄 Resetting camera to optimal settings");
  
  // Restore optimal settings
  thermalAdjustedFPS = TARGET_FPS;
  thermalAdjustedQuality = JPEG_QUALITY_PSRAM;
  
  // Restore framesize to 720p if PSRAM available
  if (psramFound()) {
    s->set_framesize(s, FRAMESIZE_HD);
  } else {
    s->set_framesize(s, FRAMESIZE_VGA);
  }
  
  // Restore optimal quality
  s->set_quality(s, JPEG_QUALITY_PSRAM);
  
  // Restore optimal sensor settings
  s->set_gainceiling(s, (gainceiling_t)4);
  s->set_aec_value(s, 400);
  s->set_brightness(s, 0);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
  
  // Restore image processing
  s->set_bpc(s, 1);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_dcw(s, 1);
}
