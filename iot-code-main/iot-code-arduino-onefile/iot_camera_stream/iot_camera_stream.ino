/*
 * ESP32-S3 OV5640 Camera Video Streaming to Backend
 * Captures frames at 10 FPS and sends them via HTTP POST to backend server
 */

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ===========================
// Configuration Section
// ===========================
const char* ssid = "wireless@STTS";
const char* password = "";
const char* server_url = "http://203.175.11.145:9003/api/v1/stream/stream";
const char* register_url = "http://203.175.11.145:9003/api/v1/devices/register";
const char* heartbeat_url = "http://203.175.11.145:9003/api/v1/devices/heartbeat";
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
const unsigned long frameInterval = 100; // 100ms = 10 FPS
const unsigned long heartbeatInterval = 30000; // 30 seconds
bool deviceRegistered = false;

void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.println("ESP32-S3 OV5640 Camera Stream Initializing...");

  // Initialize WiFi
  initWiFi();
    // Initialize Camera
  initCamera();
  
  // Register device with backend
  registerDevice();
  
  Serial.println("Setup complete. Starting video stream...");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Maintain 10 FPS by checking frame interval
  if (currentTime - lastFrameTime >= frameInterval) {
    captureAndSendFrame();
    lastFrameTime = currentTime;
  }
  
  // Send heartbeat every 30 seconds
  if (currentTime - lastHeartbeatTime >= heartbeatInterval) {
    sendHeartbeat();
    lastHeartbeatTime = currentTime;
  }
  
  // Small delay to prevent watchdog issues
  delay(1);
}

void initWiFi() {
  Serial.println("Initializing WiFi...");
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setSleep(false);
  
  Serial.print("Connecting to WiFi");
  int retryCount = 0;
  
  while (WiFi.status() != WL_CONNECTED && retryCount < 30) {
    delay(1000);
    Serial.print(".");
    retryCount++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("");
    Serial.println("WiFi connected successfully!");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal strength (RSSI): ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("");
    Serial.println("WiFi connection failed! Restarting...");
    ESP.restart();
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
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_VGA; // 640x480 for balanced performance
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12; // Balance between quality and performance
  config.fb_count = 1;

  // Optimize settings for PSRAM availability
  if (psramFound()) {
    Serial.println("PSRAM found, optimizing camera settings...");
    config.jpeg_quality = 10;
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    Serial.println("PSRAM not found, using conservative settings...");
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.frame_size = FRAMESIZE_SVGA;
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

  // Get sensor handle and optimize settings for OV5640
  sensor_t * s = esp_camera_sensor_get();
  if (s != NULL) {
    // Set frame size to VGA for consistent 640x480 output
    s->set_framesize(s, FRAMESIZE_VGA);
    
    // Optimize camera settings for streaming
    s->set_brightness(s, 0);     // -2 to 2
    s->set_contrast(s, 0);       // -2 to 2
    s->set_saturation(s, 0);     // -2 to 2
    s->set_special_effect(s, 0); // 0 to 6 (0 - No Effect)
    s->set_whitebal(s, 1);       // 0 = disable , 1 = enable
    s->set_awb_gain(s, 1);       // 0 = disable , 1 = enable
    s->set_wb_mode(s, 0);        // 0 to 4 - if awb_gain enabled
    s->set_exposure_ctrl(s, 1);  // 0 = disable , 1 = enable
    s->set_aec2(s, 0);           // 0 = disable , 1 = enable
    s->set_ae_level(s, 0);       // -2 to 2
    s->set_aec_value(s, 300);    // 0 to 1200
    s->set_gain_ctrl(s, 1);      // 0 = disable , 1 = enable
    s->set_agc_gain(s, 0);       // 0 to 30
    s->set_gainceiling(s, (gainceiling_t)0);  // 0 to 6
    s->set_bpc(s, 0);            // 0 = disable , 1 = enable
    s->set_wpc(s, 1);            // 0 = disable , 1 = enable
    s->set_raw_gma(s, 1);        // 0 = disable , 1 = enable
    s->set_lenc(s, 1);           // 0 = disable , 1 = enable
    s->set_hmirror(s, 0);        // 0 = disable , 1 = enable
    s->set_vflip(s, 0);          // 0 = disable , 1 = enable
    s->set_dcw(s, 1);            // 0 = disable , 1 = enable
    s->set_colorbar(s, 0);       // 0 = disable , 1 = enable
    
    Serial.println("Camera sensor optimized for OV5640 streaming");
  }
}

void captureAndSendFrame() {
  // Capture frame
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Camera capture failed");
    return;
  }

  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected, attempting reconnect...");
    esp_camera_fb_return(fb);
    initWiFi();
    return;
  }

  // Send frame to backend
  bool success = sendFrameToServer(fb);
  
  if (success) {
    Serial.printf("Frame sent successfully (Size: %d bytes)\n", fb->len);
  } else {
    Serial.println("Failed to send frame to server");
  }

  // Return frame buffer
  esp_camera_fb_return(fb);
}

bool sendFrameToServer(camera_fb_t * fb) {
  if (!fb || fb->len == 0) {
    Serial.println("Invalid frame buffer");
    return false;
  }

  Serial.printf("Sending frame of size: %d bytes\n", fb->len);

  http.begin(client, server_url);
  http.addHeader("X-API-Key", api_key);
  http.setTimeout(15000); // 15 second timeout
  
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
