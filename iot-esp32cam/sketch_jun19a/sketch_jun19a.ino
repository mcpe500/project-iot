/*
 * ESP32 CAM OV2640 Camera Streaming
 * Simplified to send a single HTTP POST request per frame.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <esp_camera.h>

// ===========================
// Configuration Section
// ===========================

// Network Configuration
#define WIFI_SSID "G123_967E"
#define WIFI_PASSWORD "Ivan4321"

// Server Configuration
#define SERVER_HOST "203.175.11.145"
#define SERVER_PORT 9003
#define SERVER_PATH "/api/v1/stream/fast"  // Use the high-performance endpoint
#define SERVER_URL "http://" SERVER_HOST ":" "9003" SERVER_PATH
#define API_KEY "dev-api-key-change-in-production"
#define DEVICE_ID "ESP32-CAM-001"

// ESP32 CAM Pin Configuration for AI-Thinker OV2640
#define PWDN_GPIO_NUM    32
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM    26
#define SIOC_GPIO_NUM    27

#define Y9_GPIO_NUM      35
#define Y8_GPIO_NUM      34
#define Y7_GPIO_NUM      39
#define Y6_GPIO_NUM      36
#define Y5_GPIO_NUM      21
#define Y4_GPIO_NUM      19
#define Y3_GPIO_NUM      18
#define Y2_GPIO_NUM       5
#define VSYNC_GPIO_NUM   25
#define HREF_GPIO_NUM    23
#define PCLK_GPIO_NUM    22

// Performance Configuration
#define TARGET_FPS 20
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define HTTP_TIMEOUT_MS 1500 // Ultra-fast timeout
#define MAX_RETRIES 0 // No retries for maximum speed

// Global variables
WiFiClient client;
unsigned long lastFrameTime = 0;
uint32_t frameCount = 0;
uint32_t successCount = 0;
uint32_t dropCount = 0;
unsigned long deviceStartTime = 0; // For tracking uptime
int8_t wifiRetryCount = 0; // For tracking WiFi connection attempts

// Buzzer control variables
bool buzzerActive = false;
unsigned long lastBuzzerPoll = 0;
const unsigned long BUZZER_POLL_INTERVAL = 150; // Poll every 150ms
const unsigned long SINGLE_BEEP_DURATION = 200; // Duration of single beep in ms

// ===========================
// Camera Initialization
// ===========================
void initCamera() {
  Serial.println("\n[Camera] Initializing OV2640...");
  
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
  config.jpeg_quality = 10; // Start with moderate quality
  config.fb_count = 1;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;

  if (psramFound()) {
    Serial.println("[Camera] PSRAM detected - enabling high quality mode");
    config.jpeg_quality = 8;
    config.fb_count = 2;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[Camera] ❌ Init failed: 0x%x\n", err);
    delay(1000);
    ESP.restart();
  }

  sensor_t * s = esp_camera_sensor_get();
  if (s) {
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
    Serial.println("[Camera] ✅ OV2640 configured successfully");
  } else {
    Serial.println("[Camera] ❌ Failed to get sensor");
  }
}

// ===========================
// WiFi Management
// ===========================
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
    Serial.println("[WiFi] ✅ Connected!");
    Serial.printf("[WiFi] IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println();
    Serial.println("[WiFi] ❌ Connection failed. Restarting...");
    delay(3000);
    ESP.restart();
  }
}

// =========================================================
// Frame Capture and Upload (SIMPLIFIED AND CORRECTED)
// =========================================================
bool sendFrameToServer(camera_fb_t* fb) {
  if (!fb || fb->len < 1000) {
    Serial.println("[HTTP] Invalid frame buffer");
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi not connected");
    return false;
  }

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("[HTTP] Failed to begin connection");
    return false;
  }

  // Add headers
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
  http.setTimeout(HTTP_TIMEOUT_MS);

  Serial.printf("[HTTP] Sending %d bytes to server...\n", fb->len);
  int httpCode = http.POST(fb->buf, fb->len);
  
  bool success = (httpCode == 200);
  if (success) {
    Serial.printf("[HTTP] ✅ Success (200)\n");
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

void captureAndSendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[Capture] Failed to get frame buffer");
    dropCount++;
    return;
  }

  Serial.printf("[Capture] Frame size: %d bytes\n", fb->len);
  
  // Validate frame size
  if (fb->len < 5000 || fb->len > 800000) {
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
    Serial.println("[Capture] ✅ Frame sent successfully");
  } else {
    dropCount++;
    Serial.println("[Capture] ❌ Frame send failed");
  }
  
  // Status logging
  if (frameCount % 10 == 0) {
    Serial.printf("[Stats] Frames: %d, Success: %d, Rate: %.1f%%, Heap: %d\n", 
                 frameCount, successCount, (float)successCount/frameCount*100, ESP.getFreeHeap());
  }
}

// ===========================
// Main Program
// ===========================
void setup() {
  Serial.begin(921600); // Standard baud rate for better compatibility
  delay(1000); // Give serial time to initialize
  deviceStartTime = millis();
  
  Serial.println();
  Serial.println("=== ESP32-CAM OV2640 Initialization ===");
  Serial.printf("Device ID: %s\n", DEVICE_ID);
  Serial.printf("Server URL: %s\n", SERVER_URL);
  Serial.printf("Target FPS: %d\n", TARGET_FPS);
  Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());
  
  initWiFi();
  initCamera();
  
  Serial.println("Setup complete. Starting image capture loop...");
  Serial.println("Device will register automatically with server on first frame");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[Loop] WiFi disconnected, reconnecting...");
    initWiFi();
    return;
  }
  
  // Frame capture timing
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    lastFrameTime = currentTime;
    Serial.printf("\n[Loop] === Frame %d at %lu ms ===\n", frameCount + 1, currentTime);
    captureAndSendFrame();
  }
  
  // Small delay to prevent watchdog issues
  delay(10);
}