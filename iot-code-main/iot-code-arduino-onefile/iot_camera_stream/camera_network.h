/*
 * Camera and Network Functions
 * Contains all camera initialization, WiFi management, and HTTP communication functions
 */

#ifndef CAMERA_NETWORK_H
#define CAMERA_NETWORK_H

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"

// External objects
extern HTTPClient http;
extern WiFiClient client;

// Performance tracking variables
extern uint32_t frameCount;
extern uint32_t successCount;
extern uint32_t dropCount;
extern uint32_t totalBytes;
extern unsigned long streamStartTime;
extern bool deviceRegistered;

// ===========================
// Function Declarations
// ===========================

// WiFi Management
void initWiFi();
String getWiFiStatusString(wl_status_t status);

// Camera Functions
void initCamera();
void captureAndSendFrame();
bool sendFrameToServer(camera_fb_t* fb);

// Device Management
bool registerDevice();
bool sendHeartbeat();

// Network Testing
bool testServerConnectivity();
bool testSimpleUpload();

// ===========================
// WiFi Management Functions
// ===========================

void initWiFi() {
  Serial.println("Initializing WiFi...");
  
  WiFi.disconnect(true);
  delay(1000);
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  
  // Quick network scan for diagnostics
  Serial.println("Scanning for WiFi networks...");
  int networkCount = WiFi.scanNetworks();
  Serial.printf("Found %d networks\n", networkCount);
  
  bool targetFound = false;
  for (int i = 0; i < networkCount; i++) {
    String foundSSID = WiFi.SSID(i);
    if (foundSSID == WIFI_SSID) {
      targetFound = true;
      int32_t rssi = WiFi.RSSI(i);
      Serial.printf("✓ Target network '%s' found (RSSI: %d dBm)\n", WIFI_SSID, rssi);
      if (rssi < -80) Serial.println("⚠️ Weak signal strength");
      break;
    }
  }
  
  if (!targetFound) {
    Serial.printf("❌ Network '%s' not found!\n", WIFI_SSID);
    return;
  }
  
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < WIFI_RETRY_COUNT) {
    delay(1000);
    if (++retryCount % 5 == 0) {
      Serial.printf("WiFi connecting... %d/%d\n", retryCount, WIFI_RETRY_COUNT);
      if (retryCount == 15) {
        WiFi.disconnect();
        delay(1000);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    }
    yield();
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✅ WiFi connected!");
    Serial.printf("IP: %s | RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    WiFi.setAutoReconnect(true);
  } else {
    Serial.printf("❌ WiFi failed after %d attempts\n", retryCount);
  }
}

String getWiFiStatusString(wl_status_t status) {
  switch (status) {
    case WL_CONNECTED: return "Connected";
    case WL_NO_SSID_AVAIL: return "No SSID";
    case WL_CONNECT_FAILED: return "Failed";
    case WL_CONNECTION_LOST: return "Lost";
    case WL_DISCONNECTED: return "Disconnected";
    default: return "Unknown";
  }
}

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
      s->set_framesize(s, FRAMESIZE_HD);
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
  bool success = sendFrameToServer(fb);
  unsigned long sendTime = millis() - sendStart;
  
  if (success) {
    successCount++;
    totalBytes += fb->len;
    if (frameCount % FRAME_LOG_INTERVAL == 0) {
      Serial.printf("✓ Frame #%lu: %lu bytes, Cap: %lums, Send: %lums\n", 
                    frameCount, fb->len, captureTime, sendTime);
    }
  } else {
    dropCount++;
    if (frameCount % FAILURE_LOG_INTERVAL == 0) {
      Serial.printf("✗ Frame #%lu failed (%lu bytes)\n", frameCount, fb->len);
    }
  }

  esp_camera_fb_return(fb);
}

bool sendFrameToServer(camera_fb_t* fb) {
  if (!fb || fb->len == 0) return false;
  if (WiFi.status() != WL_CONNECTED) return false;

  http.begin(client, SERVER_URL);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String boundary = "----ESP32CAMBoundary";
  String header = "--" + boundary + "\r\n"
                  "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
                  "Content-Type: image/jpeg\r\n\r\n";
  String footer = "\r\n--" + boundary + "--\r\n";
  
  size_t totalLength = header.length() + fb->len + footer.length();
    // Try complete payload method first
  uint8_t* payload = (uint8_t*)malloc(totalLength);
  if (payload) {
    memcpy(payload, header.c_str(), header.length());
    memcpy(payload + header.length(), fb->buf, fb->len);
    memcpy(payload + header.length() + fb->len, footer.c_str(), footer.length());
    
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    int httpCode = http.POST(payload, totalLength);
    free(payload);
    
    // Enhanced error reporting
    Serial.printf("HTTP Response Code: %d\n", httpCode);
    if (httpCode > 0) {
      String response = http.getString();
      if (httpCode != 200) {
        Serial.printf("HTTP Error Details: %s\n", response.c_str());
      }
    } else {
      Serial.printf("HTTP Request Failed: %s\n", http.errorToString(httpCode).c_str());
    }
    
    bool result = (httpCode == 200);
    http.end();
    return result;  } else {
    // Fallback to streaming method
    Serial.println("Using streaming method (memory allocation failed)");
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
    http.addHeader("Content-Length", String(totalLength));
    
    int httpCode = http.sendRequest("POST", (uint8_t*)NULL, 0);
    Serial.printf("Stream HTTP Response Code: %d\n", httpCode);
    
    if (httpCode > 0) {
      WiFiClient* stream = http.getStreamPtr();
      if (stream) {
        stream->print(header);
        
        size_t bytesWritten = 0;
        while (bytesWritten < fb->len) {
          size_t bytesToWrite = min((size_t)CHUNK_SIZE, fb->len - bytesWritten);
          size_t written = stream->write(fb->buf + bytesWritten, bytesToWrite);
          if (written != bytesToWrite) {
            Serial.printf("Stream write failed at byte %d\n", bytesWritten);
            break;
          }
          bytesWritten += written;
        }
        
        stream->print(footer);
        stream->flush();
        
        String response = http.getString();
        if (httpCode != 200) {
          Serial.printf("Stream Error Details: %s\n", response.c_str());
        }
        
        bool result = (httpCode == 200);
        http.end();
        return result;
      } else {
        Serial.println("Failed to get HTTP stream");
      }
    } else {
      Serial.printf("Stream Request Failed: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
    return false;
  }
}

// ===========================
// Device Registration and Heartbeat
// ===========================

bool registerDevice() {
  Serial.println("Registering device...");
  
  http.begin(client, REGISTER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String payload = "{\"deviceId\":\"" + String(DEVICE_ID) + 
                  "\",\"deviceName\":\"" + String(DEVICE_NAME) + 
                  "\",\"deviceType\":\"camera\",\"ipAddress\":\"" + 
                  WiFi.localIP().toString() + 
                  "\",\"capabilities\":[\"streaming\",\"recording\",\"capture\"]}";
  
  int httpCode = http.POST(payload);
  bool success = (httpCode == 200);
  
  if (success) {
    Serial.println("Device registered successfully!");
    deviceRegistered = true;
  } else {
    Serial.printf("Registration failed: %d\n", httpCode);
  }
  
  http.end();
  return success;
}

bool sendHeartbeat() {
  if (!deviceRegistered) {
    return registerDevice();
  }
  
  http.begin(client, HEARTBEAT_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String payload = "{\"deviceId\":\"" + String(DEVICE_ID) + 
                  "\",\"uptime\":" + String(millis()) + 
                  ",\"freeHeap\":" + String(ESP.getFreeHeap()) + 
                  ",\"wifiRssi\":" + String(WiFi.RSSI()) + 
                  ",\"status\":\"online\"}";
  
  int httpCode = http.POST(payload);
  bool success = (httpCode == 200);
  
  if (success) {
    Serial.println("Heartbeat sent");
  } else {
    Serial.printf("Heartbeat failed: %d\n", httpCode);
    deviceRegistered = false;
  }
  
  http.end();
  return success;
}

// ===========================
// Network Testing
// ===========================

bool testServerConnectivity() {
  Serial.println("Testing server connectivity...");
  
  // Test basic HTTP connection
  http.begin(client, SERVER_URL);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(5000); // Shorter timeout for connectivity test
  
  // Try a simple GET request first
  int httpCode = http.GET();
  
  Serial.printf("Server connectivity test result: %d\n", httpCode);
  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("Server response: %s\n", response.substring(0, 200).c_str()); // First 200 chars
    
    if (httpCode == 200 || httpCode == 405) { // 405 = Method Not Allowed is OK for GET on POST endpoint
      Serial.println("✅ Server is reachable");
      http.end();
      return true;
    } else {
      Serial.printf("⚠️ Server returned unexpected code: %d\n", httpCode);
    }
  } else {
    Serial.printf("❌ Server connection failed: %s\n", http.errorToString(httpCode).c_str());
  }
  
  http.end();
  return false;
}

bool testSimpleUpload() {
  Serial.println("Testing simple HTTP POST...");
  
  http.begin(client, SERVER_URL);
  http.addHeader("X-API-Key", API_KEY);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);
  
  // Send a simple JSON test payload
  String testPayload = "{\"test\":\"ESP32-camera-connectivity\",\"timestamp\":" + String(millis()) + "}";
  
  int httpCode = http.POST(testPayload);
  Serial.printf("Simple POST test result: %d\n", httpCode);
  
  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("Simple POST response: %s\n", response.substring(0, 200).c_str());
    http.end();
    return (httpCode == 200 || httpCode == 400); // 400 might be expected for wrong format
  } else {
    Serial.printf("Simple POST failed: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

#endif // CAMERA_NETWORK_H
