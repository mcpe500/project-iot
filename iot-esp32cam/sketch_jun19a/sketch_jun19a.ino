#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_camera.h>

// Configuration constants
#define WIFI_SSID "WIFI_SSID"
#define WIFI_PASSWORD "WIFI_PASSWORD"
#define SERVER_HOST "SERVER_IP"
#define SERVER_PORT "9003"
#define SERVER_URL "http://" SERVER_HOST ":" SERVER_PORT "/api/v1/stream/fast"
#define API_KEY "dev-api-key-change-in-production"
#define DEVICE_ID "ESP32-CAM-001"

// Camera pins (AI-Thinker)
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// Performance settings
#define TARGET_FPS 20
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)

// Global state
WiFiClient client;
unsigned long lastFrameTime = 0, deviceStartTime = 0;
uint32_t frameCount = 0, successCount = 0, dropCount = 0;

// Utility functions
void logStatus(const char* module, const char* message, bool success = true) {
  Serial.printf("[%s] %s %s\n", module, success ? "✅" : "❌", message);
}

void logFrame(const char* message) {
  Serial.printf("[Capture] %s\n", message);
}

void logHttp(const char* message) {
  Serial.printf("[HTTP] %s\n", message);
}

// Camera functions
camera_config_t getCameraConfig() {
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
  config.frame_size = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.jpeg_quality = 10;
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  if (psramFound()) {
    Serial.println("[Camera] PSRAM detected - enabling high quality mode");
    config.jpeg_quality = 8;
    config.fb_count = 2;
  }
  return config;
}

void configureSensor() {
  sensor_t* s = esp_camera_sensor_get();
  if (!s) {
    logStatus("Camera", "Failed to get sensor", false);
    return;
  }
  
  s->set_framesize(s, FRAMESIZE_VGA);
  s->set_brightness(s, 0);
  s->set_contrast(s, 1);
  s->set_saturation(s, 0);
  s->set_whitebal(s, 1);
  s->set_awb_gain(s, 1);
  s->set_wb_mode(s, 0);
  s->set_exposure_ctrl(s, 1);
  s->set_aec2(s, 0);
  s->set_ae_level(s, 0);
  s->set_aec_value(s, 300);
  s->set_gain_ctrl(s, 1);
  s->set_agc_gain(s, 0);
  s->set_gainceiling(s, (gainceiling_t)0);
  s->set_bpc(s, 0);
  s->set_wpc(s, 1);
  s->set_raw_gma(s, 1);
  s->set_lenc(s, 1);
  s->set_dcw(s, 1);
  s->set_colorbar(s, 0);
  
  logStatus("Camera", "OV2640 configured successfully");
}

void initCamera() {
  Serial.println("\n[Camera] Initializing OV2640...");
  
  camera_config_t config = getCameraConfig();
  esp_err_t err = esp_camera_init(&config);
  
  if (err != ESP_OK) {
    Serial.printf("[Camera] ❌ Init failed: 0x%x\n", err);
    delay(1000);
    ESP.restart();
  }
  
  configureSensor();
}

// WiFi functions
void initWiFi() {
  Serial.println("\n[WiFi] Initializing WiFi...");
  Serial.printf("[WiFi] SSID: %s\n", WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false);
  
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 30) {
    delay(500);
    Serial.print(".");
    retryCount++;
    if (retryCount % 10 == 0) {
      Serial.printf(" %d/30\n", retryCount);
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    logStatus("WiFi", "Connected!");
    Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println();
    logStatus("WiFi", "Connection failed. Restarting...", false);
    delay(3000);
    ESP.restart();
  }
}

// HTTP functions
void addHttpHeaders(HTTPClient& http) {
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key", API_KEY);
  http.addHeader("Device-Name", "ESP32-CAM OV2640");
  http.addHeader("Device-Type", "ESP32-CAM");
  http.addHeader("Device-IP", WiFi.localIP().toString());
  http.addHeader("Device-Status", "online");
  http.addHeader("Device-Uptime", String(millis() - deviceStartTime));
  http.addHeader("Device-FreeHeap", String(ESP.getFreeHeap()));
  http.addHeader("Device-WifiRssi", String(WiFi.RSSI()));
}

bool sendFrameToServer(camera_fb_t* fb) {
  if (!fb || fb->len < 1000) {
    logHttp("Invalid frame buffer");
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    logHttp("WiFi not connected");
    return false;
  }

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    logHttp("Failed to begin connection");
    return false;
  }

  addHttpHeaders(http);
  
  Serial.printf("[HTTP] Sending %d bytes to server...\n", fb->len);
  int httpCode = http.POST(fb->buf, fb->len);
  
  bool success = (httpCode == 200);
  if (success) {
    logHttp("Success (200)");
  } else {
    Serial.printf("[HTTP] ❌ Failed: %d\n", httpCode);
    if (httpCode > 0) {
      String response = http.getString();
      Serial.printf("[HTTP] Response: %s\n", response.c_str());
    }
  }
  
  http.end();
  return success;
}

// Frame capture functions
bool isValidFrame(camera_fb_t* fb) {
  return fb && fb->len >= 5000 && fb->len <= 800000;
}

void logStats() {
  if (frameCount % 10 == 0) {
    Serial.printf("[Stats] Frames: %d, Success: %d, Rate: %.1f%%, Heap: %d\n", 
                 frameCount, successCount, (float)successCount/frameCount*100, ESP.getFreeHeap());
  }
}

void captureAndSendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    logFrame("Failed to get frame buffer");
    dropCount++;
    return;
  }

  Serial.printf("[Capture] Frame size: %d bytes\n", fb->len);
  
  if (!isValidFrame(fb)) {
    Serial.printf("[Capture] Invalid frame size: %d bytes\n", fb->len);
    esp_camera_fb_return(fb);
    dropCount++;
    return;
  }

  bool success = sendFrameToServer(fb);
  esp_camera_fb_return(fb);
  
  frameCount++;
  if (success) {
    successCount++;
    logFrame("Frame sent successfully");
  } else {
    dropCount++;
    logFrame("Frame send failed");
  }
  
  logStats();
}

// Main functions
void printStartupInfo() {
  Serial.println("=== ESP32-CAM OV2640 Initialization ===");
  Serial.printf("Device ID: %s\n", DEVICE_ID);
  Serial.printf("Server URL: %s\n", SERVER_URL);
  Serial.printf("Target FPS: %d\n", TARGET_FPS);
  Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());
}

void setup() {
  Serial.begin(921600);
  delay(1000);
  deviceStartTime = millis();
  
  Serial.println();
  printStartupInfo();
  
  initWiFi();
  initCamera();
  
  Serial.println("Setup complete. Starting image capture loop...");
  Serial.println("Device will register automatically with server on first frame");
}

void loop() {
  unsigned long currentTime = millis();
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Loop] WiFi disconnected, reconnecting...");
    initWiFi();
    return;
  }
  
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    lastFrameTime = currentTime;
    Serial.printf("\n[Loop] === Frame %d at %lu ms ===\n", frameCount + 1, currentTime);
    captureAndSendFrame();
  }
  
  delay(10);
}