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
#define WIFI_SSID "weef1"
#define WIFI_PASSWORD "1234567899"

// Server Configuration
#define SERVER_HOST "203.175.11.145"
#define SERVER_PORT 9004
#define SERVER_PATH "/api/v1/stream/stream"
#define SERVER_URL "http://" SERVER_HOST ":" "9004" SERVER_PATH
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
#define TARGET_FPS 10
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define HTTP_TIMEOUT_MS 5000 // Increased timeout for single large upload

// Global variables
WiFiClient client;
unsigned long lastFrameTime = 0;
uint32_t frameCount = 0;
uint32_t successCount = 0;
uint32_t dropCount = 0;

// ===========================
// Camera Initialization
// ===========================
void initCamera() {
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
  config.jpeg_quality = 12; // Quality can be slightly higher now
  config.fb_count = 1;

  if (psramFound()) {
    config.jpeg_quality = 10;
    config.fb_count = 2;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    ESP.restart();
  }

  sensor_t * s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_VGA);
}

// ===========================
// WiFi Management
// ===========================
void initWiFi() {
  Serial.println("Initializing WiFi...");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false);
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 50) {
    Serial.printf("Connection attempt %d/50...\n", retryCount + 1);
    delay(1000);
    retryCount++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed. Restarting...");
    delay(5000);
    ESP.restart();
  }
}

// =========================================================
// Frame Capture and Upload (SIMPLIFIED AND CORRECTED)
// =========================================================
bool sendFrameToServer(camera_fb_t* fb) {
  if (!fb || fb->len == 0) {
    Serial.println("Invalid frame buffer");
    return false;
  }

  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("HTTP client initialization failed");
    return false;
  }

  // Set standard headers
  // CRITICAL FIX: Set the Content-Type so the server knows it's a JPEG image
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("Device-ID", DEVICE_ID);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);

  // Send the entire frame buffer in one POST request.
  // The library handles the chunking and Content-Length internally.
  int httpCode = http.POST(fb->buf, fb->len);

  // Check the result
  bool success = false;
  if (httpCode > 0) {
    Serial.printf("[HTTP] POST... code: %d\n", httpCode);
    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_ACCEPTED) {
      String payload = http.getString();
      Serial.println(payload);
      success = true;
    }
  } else {
    Serial.printf("[HTTP] POST... failed, error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
  return success;
}

void captureAndSendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Capture failed");
    dropCount++;
    return;
  }

  // The function now directly sends the frame
  if (sendFrameToServer(fb)) {
    successCount++;
  } else {
    dropCount++;
  }

  esp_camera_fb_return(fb); // IMPORTANT: Always return the frame buffer!
}

// ===========================
// Main Program
// ===========================
void setup() {
  Serial.begin(115200);
  initWiFi();
  initCamera();
  Serial.println("Setup complete. Starting image capture loop...");
}

void loop() {
  unsigned long currentTime = millis();
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    lastFrameTime = currentTime;
    captureAndSendFrame();

    if (frameCount % 10 == 0) {
      Serial.printf("Frames: %d, Success: %d, Dropped: %d\n",
                   frameCount, successCount, dropCount);
    }
    frameCount++;
  }
  delay(1); // Small delay to prevent watchdog timer issues
}