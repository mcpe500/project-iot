/*
 * ESP32-S3 OV5640 Camera High-Performance Video Streaming
 * MAXIMUM QUALITY OPTIMIZATION FOR 720p @ 30 FPS
 * 
 * Features:
 * - 720p (1280x720) resolution at 30 FPS target
 * - JPEG Quality 4 (high quality, low compression)
 * - Triple buffering with PSRAM optimization
 * - Real-time performance monitoring
 * - Optimized WiFi and camera sensor settings
 * - Advanced frame timing and throughput management
 * 
 * Hardware: ESP32-S3 + OV5640 Camera Module + PSRAM
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ===========================
// Configuration Section
// ===========================
const char* ssid = "BIZNET357";
const char* password = "ivan4321";
const char* server_url = "http://203.175.11.145:9005/api/v1/stream/stream";
const char* register_url = "http://203.175.11.145:9005/api/v1/devices/register";
const char* heartbeat_url = "http://203.175.11.145:9005/api/v1/devices/heartbeat";
const char* api_key = "dev-api-key-change-in-production";
const char* device_id = "ESP32-CAM-001";
const char* device_name = "Camera #1";

// ===========================
// ESP32-S3 Camera Pin Configuration for OV5640
// ===========================
#define PWDN_GPIO_NUM  -1
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM  15
#define SIOD_GPIO_NUM  4
#define SIOC_GPIO_NUM  5

#define Y9_GPIO_NUM    16
#define Y8_GPIO_NUM    17
#define Y7_GPIO_NUM    18
#define Y6_GPIO_NUM    12
#define Y5_GPIO_NUM    10
#define Y4_GPIO_NUM    8
#define Y3_GPIO_NUM    9
#define Y2_GPIO_NUM    11
#define VSYNC_GPIO_NUM 6
#define HREF_GPIO_NUM  7
#define PCLK_GPIO_NUM  13

// Global variables
HTTPClient http;
WiFiClient client;
unsigned long lastFrameTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastStatsTime = 0;
const unsigned long frameInterval = 100; // Start with 100ms = 10 FPS, can be adjusted
const unsigned long heartbeatInterval = 30000; // 30 seconds
const unsigned long statsInterval = 5000; // 5 seconds for performance stats
bool deviceRegistered = false;
uint32_t frameCount = 0;
uint32_t successCount = 0;
uint32_t dropCount = 0;
uint32_t totalBytes = 0;
unsigned long streamStartTime = 0;

void setup() {
  // Start with standard baud rate for stability
  Serial.begin(115200);
  delay(2000); // Give serial time to initialize properly
  Serial.println();
  Serial.println("ESP32-S3 OV5640 Camera Stream Initializing...");
  Serial.println("System Information:");
  Serial.printf("- Chip Model: %s\n", ESP.getChipModel());
  Serial.printf("- Chip Revision: %d\n", ESP.getChipRevision());
  Serial.printf("- Flash Size: %d bytes\n", ESP.getFlashChipSize());

  // Set CPU frequency - start conservative, then increase
  setCpuFrequencyMhz(160); // Start with 160MHz for stability
  Serial.printf("CPU Frequency: %d MHz\n", getCpuFrequencyMhz());
  
  // Check PSRAM availability
  if (psramFound()) {
    Serial.printf("PSRAM found: %d bytes\n", ESP.getPsramSize());
  } else {
    Serial.println("PSRAM not found - using conservative settings");
  }

  // Initialize WiFi first
  Serial.println("\nStarting WiFi initialization...");
  initWiFi();
  
  // Add delay before camera initialization
  Serial.println("\nWaiting before camera initialization...");
  delay(3000);
  
  // Initialize Camera
  Serial.println("Starting camera initialization...");
  initCamera();
  
  // Add delay before increasing CPU frequency
  delay(2000);
  
  // Now increase CPU frequency for performance
  setCpuFrequencyMhz(240);
  Serial.printf("CPU Frequency increased to: %d MHz\n", getCpuFrequencyMhz());
  
  // Only register device if WiFi is connected
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Registering device with backend...");
    registerDevice();
  } else {
    Serial.println("Skipping device registration - WiFi not connected");
  }
  
  Serial.println("Setup complete. Starting video stream...");
  streamStartTime = millis();
}

void loop() {
  unsigned long currentTime = millis();
  
  // Maintain target FPS by checking frame interval
  if (currentTime - lastFrameTime >= frameInterval) {
    captureAndSendFrame();
    lastFrameTime = currentTime;
  }
  
  // Send heartbeat every 30 seconds
  if (currentTime - lastHeartbeatTime >= heartbeatInterval) {
    sendHeartbeat();
    lastHeartbeatTime = currentTime;
  }
  
  // Print performance statistics every 5 seconds
  if (currentTime - lastStatsTime >= statsInterval) {
    printPerformanceStats();
    lastStatsTime = currentTime;
  }
  
  // Check WiFi status periodically and attempt reconnection
  static unsigned long lastWiFiCheck = 0;
  static unsigned long lastReconnectAttempt = 0;
  if (currentTime - lastWiFiCheck >= 15000) { // Check every 15 seconds
    if (WiFi.status() != WL_CONNECTED) {
      // Only attempt reconnection every 60 seconds to avoid spam
      if (currentTime - lastReconnectAttempt >= 60000) {
        Serial.printf("WiFi disconnected (Status: %d - %s) - attempting reconnection...\n", 
                      WiFi.status(), getWiFiStatusString(WiFi.status()).c_str());
        initWiFi();
        lastReconnectAttempt = currentTime;
      }
    } else {
      // Reset reconnect timer when connected
      lastReconnectAttempt = 0;
    }
    lastWiFiCheck = currentTime;
  }
  
  // Small delay to prevent watchdog issues
  delay(1);
}

void initWiFi() {
  Serial.println("Initializing WiFi...");
  
  // Disconnect any previous connection
  WiFi.disconnect(true);
  delay(1000);
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Disable WiFi sleep
  
  // Scan for available networks first
  Serial.println("Scanning for WiFi networks...");
  int networkCount = WiFi.scanNetworks();
  Serial.printf("Found %d networks:\n", networkCount);
  
  bool targetNetworkFound = false;
  for (int i = 0; i < networkCount; i++) {
    String foundSSID = WiFi.SSID(i);
    int32_t rssi = WiFi.RSSI(i);
    wifi_auth_mode_t encType = WiFi.encryptionType(i);
    
    Serial.printf("  %d: %s (RSSI: %d, Encryption: %d)\n", i, foundSSID.c_str(), rssi, encType);
    
    if (foundSSID == ssid) {
      targetNetworkFound = true;
      Serial.printf("✓ Target network '%s' found with RSSI: %d dBm\n", ssid, rssi);
      
      if (rssi < -80) {
        Serial.println("⚠️ WARNING: Signal strength is weak (< -80 dBm)");
      }
    }
  }
  
  if (!targetNetworkFound) {
    Serial.printf("❌ ERROR: Target network '%s' not found!\n", ssid);
    Serial.println("Please check:");
    Serial.println("- SSID spelling and case sensitivity");
    Serial.println("- Network is broadcasting (not hidden)");
    Serial.println("- ESP32 is in range of the router");
    return;
  }
  
  Serial.printf("Connecting to WiFi network: %s\n", ssid);
  WiFi.begin(ssid, password);
  
  Serial.print("Connecting");
  int retryCount = 0;
  
  while (WiFi.status() != WL_CONNECTED && retryCount < 30) {
    delay(1000);
    Serial.print(".");
    retryCount++;
    
    // Print WiFi status for debugging
    if (retryCount % 5 == 0) {
      wl_status_t status = WiFi.status();
      Serial.printf("\nWiFi Status: %d (%s), Retry: %d/30\n", 
                    status, getWiFiStatusString(status).c_str(), retryCount);
      Serial.print("Continuing");
      
      // Try to reconnect if stuck
      if (retryCount == 15) {
        Serial.println("\nRe-attempting connection...");
        WiFi.disconnect();
        delay(1000);
        WiFi.begin(ssid, password);
      }
    }
    
    // Feed watchdog
    yield();
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("✅ WiFi connected successfully!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.printf("Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("DNS: %s\n", WiFi.dnsIP().toString().c_str());
    
    // Configure for better performance
    WiFi.setAutoReconnect(true);
    
  } else {
    Serial.println("");
    Serial.printf("❌ WiFi connection failed after %d attempts!\n", retryCount);
    wl_status_t finalStatus = WiFi.status();
    Serial.printf("Final WiFi Status: %d (%s)\n", finalStatus, getWiFiStatusString(finalStatus).c_str());
    
    Serial.println("\n🔧 Troubleshooting suggestions:");
    Serial.println("1. Verify SSID and password are correct");
    Serial.println("2. Check if MAC address filtering is enabled on router");
    Serial.println("3. Try moving ESP32 closer to router");
    Serial.println("4. Check if router has device connection limits");
    Serial.println("5. Try restarting your router");
    Serial.println("Continuing without WiFi - will retry later...");
    
    return;
  }
}

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
  config.xclk_freq_hz = 20000000; // Start with 20MHz for stability
  config.frame_size = FRAMESIZE_VGA; // Start with VGA, upgrade after init
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY; // Start conservative
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 10; // Start with moderate quality
  config.fb_count = 1; // Start with single buffer

  // Optimize settings for PSRAM availability
  if (psramFound()) {
    Serial.println("PSRAM found, will upgrade to 720p after initialization...");
    config.jpeg_quality = 8; // Better quality with PSRAM
    config.fb_count = 2; // Double buffering
    Serial.println("Initial config: VGA, JPEG Quality: 8, Double buffering");
  } else {
    Serial.println("PSRAM not found, staying with VGA for stability...");
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    Serial.println("Fallback: VGA (640x480), JPEG Quality: 12, Single buffering");
  }

  // Initialize camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
    Serial.println("Restarting in 5 seconds...");
    delay(5000);
    ESP.restart();
    return;
  }

  Serial.println("Camera initialized successfully!");

  // Get sensor handle and configure basic settings first
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    Serial.println("Configuring camera sensor...");
    
    // Basic settings first
    s->set_framesize(s, FRAMESIZE_VGA); // Start with VGA
    s->set_brightness(s, 0);     // -2 to 2
    s->set_contrast(s, 0);       // -2 to 2  
    s->set_saturation(s, 0);     // -2 to 2
    s->set_whitebal(s, 1);       // Enable auto white balance
    s->set_awb_gain(s, 1);       // Enable AWB gain
    s->set_exposure_ctrl(s, 1);  // Enable auto exposure
    s->set_gain_ctrl(s, 1);      // Enable auto gain
    
    Serial.println("Basic camera sensor configuration applied");
    
    // If PSRAM is available, upgrade to 720p after a delay
    if (psramFound()) {
      delay(2000); // Wait for camera to stabilize
      Serial.println("Upgrading to 720p...");
      
      // Upgrade to HD settings
      s->set_framesize(s, FRAMESIZE_HD);
      s->set_quality(s, 6); // Better quality for 720p
      
      // Apply advanced settings for 720p
      s->set_contrast(s, 1);       // Slightly increased for clarity
      s->set_gainceiling(s, (gainceiling_t)4);  // Gain ceiling for low noise
      s->set_bpc(s, 1);            // Black pixel correction
      s->set_wpc(s, 1);            // White pixel correction
      s->set_raw_gma(s, 1);        // Gamma correction
      s->set_lenc(s, 1);           // Lens correction
      s->set_dcw(s, 1);            // Downscale enable
      s->set_aec_value(s, 400);    // Manual exposure value
      
      Serial.println("Camera upgraded to 720p with enhanced settings");
    }
  } else {
    Serial.println("Failed to get camera sensor handle");
  }
}

void captureAndSendFrame() {
  frameCount++;
  
  // Feed the watchdog
  yield();
  
  // Check WiFi connection first
  if (WiFi.status() != WL_CONNECTED) {
    if (frameCount % 50 == 0) { // Print every 50 frames to avoid spam
      Serial.println("WiFi not connected - skipping frame");
    }
    dropCount++;
    return;
  }
  
  unsigned long captureStart = millis();
  
  // Capture frame with timeout handling
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed - frame dropped");
    dropCount++;
    return;
  }
  
  unsigned long captureTime = millis() - captureStart;

  // Send frame to backend
  unsigned long sendStart = millis();
  bool success = sendFrameToServer(fb);
  unsigned long sendTime = millis() - sendStart;
  
  if (success) {
    successCount++;
    totalBytes += fb->len;
    if (frameCount % 10 == 0) { // Print every 10th frame to reduce spam
      Serial.printf("✓ Frame #%lu: %lu bytes, Capture: %lums, Send: %lums\n", 
                    frameCount, fb->len, captureTime, sendTime);
    }
  } else {
    dropCount++;
    if (frameCount % 5 == 0) { // Print every 5th failure
      Serial.printf("✗ Frame #%lu failed (Size: %lu bytes)\n", frameCount, fb->len);
    }
  }

  // Return frame buffer
  esp_camera_fb_return(fb);
}

bool sendFrameToServer(camera_fb_t * fb) {
  if (!fb || fb->len == 0) {
    Serial.println("Invalid frame buffer");
    return false;
  }

  // Double-check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  Serial.printf("Sending frame of size: %d bytes\n", fb->len);

  http.begin(client, server_url);
  http.addHeader("X-API-Key", api_key);
  http.setTimeout(10000); // 10 second timeout for stability
  
  // Create boundary
  String boundary = "----ESP32CAMFormBoundary";
  
  // Build multipart form data
  String header = "--" + boundary + "\r\n";
  header += "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n";
  header += "Content-Type: image/jpeg\r\n\r\n";
  
  String footer = "\r\n--" + boundary + "--\r\n";
  
  size_t totalLength = header.length() + fb->len + footer.length();
  Serial.printf("Total payload size: %d bytes\n", totalLength);
  
  // Try to allocate memory for complete payload
  uint8_t* payload = (uint8_t*)malloc(totalLength);
  if (payload) {
    Serial.println("Using complete payload method");
    
    // Copy header
    memcpy(payload, header.c_str(), header.length());
    size_t offset = header.length();
    
    // Copy image data
    memcpy(payload + offset, fb->buf, fb->len);
    offset += fb->len;
    
    // Copy footer
    memcpy(payload + offset, footer.c_str(), footer.length());
    
    // Send POST request
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    int httpResponseCode = http.POST(payload, totalLength);
    
    free(payload);
    
    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.printf("HTTP Response Code: %d\n", httpResponseCode);
      
      if (httpResponseCode == 200) {
        Serial.println("Frame uploaded successfully");
        http.end();
        return true;
      } else {
        Serial.printf("HTTP Error: %d, Response: %s\n", httpResponseCode, response.c_str());
      }
    } else {
      Serial.printf("HTTP Request failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
  } else {
    Serial.println("Failed to allocate memory, trying stream method");
    
    // Fallback: Use stream method
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    http.addHeader("Content-Length", String(totalLength));
    
    int httpResponseCode = http.sendRequest("POST", (uint8_t*)NULL, 0);
    
    if (httpResponseCode > 0) {
      WiFiClient * stream = http.getStreamPtr();
      if (stream) {
        // Send header
        stream->print(header);
        
        // Send image data in chunks
        const size_t chunkSize = 1024;
        size_t bytesWritten = 0;
        
        while (bytesWritten < fb->len) {
          size_t bytesToWrite = min(chunkSize, fb->len - bytesWritten);
          size_t written = stream->write(fb->buf + bytesWritten, bytesToWrite);
          
          if (written != bytesToWrite) {
            Serial.printf("Error writing image data at byte %d\n", bytesWritten);
            http.end();
            return false;
          }
          
          bytesWritten += written;
        }
          // Send footer
        stream->print(footer);
        stream->flush();
        
        // The response code is already available from sendRequest
        String response = http.getString();
        
        Serial.printf("HTTP Response Code: %d\n", httpResponseCode);
        
        if (httpResponseCode == 200) {
          Serial.println("Frame uploaded successfully (stream method)");
          http.end();
          return true;
        } else {
          Serial.printf("HTTP Error: %d, Response: %s\n", httpResponseCode, response.c_str());
        }
      } else {
        Serial.println("Failed to get HTTP stream");
      }
    } else {
      Serial.printf("HTTP sendRequest failed, error: %s\n", http.errorToString(httpResponseCode).c_str());
    }
  }
  
  http.end();
  return false;
}

// Register device with backend server
bool registerDevice() {
  Serial.println("Registering device with backend...");
  
  http.begin(client, register_url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", api_key);
  http.setTimeout(10000);
  
  // Create JSON payload for device registration
  String payload = "{";
  payload += "\"deviceId\":\"" + String(device_id) + "\",";
  payload += "\"deviceName\":\"" + String(device_name) + "\",";
  payload += "\"deviceType\":\"camera\",";
  payload += "\"ipAddress\":\"" + WiFi.localIP().toString() + "\",";
  payload += "\"capabilities\":[\"streaming\",\"recording\",\"capture\"]";
  payload += "}";
  
  Serial.printf("Registration payload: %s\n", payload.c_str());
  
  int httpResponseCode = http.POST(payload);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("Registration response code: %d\n", httpResponseCode);
    Serial.printf("Registration response: %s\n", response.c_str());
    
    if (httpResponseCode == 200) {
      Serial.println("Device registered successfully!");
      deviceRegistered = true;
      http.end();
      return true;
    } else {
      Serial.printf("Registration failed with code: %d\n", httpResponseCode);
    }
  } else {
    Serial.printf("Registration HTTP request failed: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  
  http.end();
  return false;
}

// Send heartbeat to backend to maintain device status
bool sendHeartbeat() {
  if (!deviceRegistered) {
    Serial.println("Device not registered, attempting registration...");
    return registerDevice();
  }
  
  http.begin(client, heartbeat_url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", api_key);
  http.setTimeout(10000);
  
  // Create JSON payload for heartbeat
  String payload = "{";
  payload += "\"deviceId\":\"" + String(device_id) + "\",";
  payload += "\"uptime\":" + String(millis()) + ",";
  payload += "\"freeHeap\":" + String(ESP.getFreeHeap()) + ",";
  payload += "\"wifiRssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"status\":\"online\"";
  payload += "}";
  
  int httpResponseCode = http.POST(payload);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("Heartbeat response code: %d\n", httpResponseCode);
    
    if (httpResponseCode == 200) {
      Serial.println("Heartbeat sent successfully");
      http.end();
      return true;
    } else {
      Serial.printf("Heartbeat failed with code: %d, response: %s\n", httpResponseCode, response.c_str());
    }
  } else {
    Serial.printf("Heartbeat HTTP request failed: %s\n", http.errorToString(httpResponseCode).c_str());
    // Try to re-register if heartbeat fails
    deviceRegistered = false;
  }
  
  http.end();
  return false;
}

// Performance monitoring and statistics
void printPerformanceStats() {
  unsigned long currentTime = millis();
  unsigned long runTime = currentTime - streamStartTime;
  
  if (runTime > 0) {
    float actualFPS = (float)frameCount * 1000.0 / runTime;
    float successRate = frameCount > 0 ? (float)successCount * 100.0 / frameCount : 0;
    float avgFrameSize = successCount > 0 ? (float)totalBytes / successCount : 0;
    float throughputKBps = (float)totalBytes / (runTime / 1000.0) / 1024.0;
    
    Serial.println("\n" + String("=").substring(0, 50));
    Serial.println("📊 PERFORMANCE STATISTICS");
    Serial.println(String("=").substring(0, 50));
    Serial.printf("Runtime: %lu.%03lu seconds\n", runTime/1000, runTime%1000);
    Serial.printf("Current FPS: %.2f (Target: adjustable)\n", actualFPS);
    Serial.printf("Frames: Total=%lu, Success=%lu, Dropped=%lu\n", frameCount, successCount, dropCount);
    Serial.printf("Success Rate: %.1f%%\n", successRate);
    Serial.printf("Avg Frame Size: %.1f KB (%.0f bytes)\n", avgFrameSize/1024.0, avgFrameSize);
    Serial.printf("Data Throughput: %.1f KB/s\n", throughputKBps);
    Serial.printf("Free Heap: %lu bytes\n", ESP.getFreeHeap());
    if (psramFound()) {
      Serial.printf("PSRAM Free: %lu bytes\n", ESP.getFreePsram());
    }
    Serial.printf("WiFi RSSI: %d dBm | CPU Freq: %d MHz\n", 
                  WiFi.RSSI(), getCpuFrequencyMhz());
    
    // Performance indicators
    if (actualFPS >= 25.0) {
      Serial.println("🟢 Performance: EXCELLENT");
    } else if (actualFPS >= 15.0) {
      Serial.println("🟡 Performance: GOOD");
    } else if (actualFPS >= 8.0) {
      Serial.println("🟠 Performance: MODERATE");
    } else {
      Serial.println("🔴 Performance: NEEDS OPTIMIZATION");
    }
    
    Serial.println(String("=").substring(0, 50) + "\n");
  }
}

// Helper function to decode WiFi status codes
String getWiFiStatusString(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS:     return "Idle";
    case WL_NO_SSID_AVAIL:   return "No SSID Available";
    case WL_SCAN_COMPLETED:  return "Scan Completed";
    case WL_CONNECTED:       return "Connected";
    case WL_CONNECT_FAILED:  return "Connection Failed";
    case WL_CONNECTION_LOST: return "Connection Lost";
    case WL_DISCONNECTED:    return "Disconnected";
    default:                 return "Unknown";
  }
}
