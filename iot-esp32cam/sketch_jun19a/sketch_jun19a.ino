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
#define WIFI_SSID "BIZNET357"
#define WIFI_PASSWORD "ivan4321"

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
#define TARGET_FPS 10
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define HTTP_TIMEOUT_MS 3000 // Reduced timeout for faster response
#define MAX_RETRIES 2 // Limit retries for failed uploads

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

  // Set standard headers with device information
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
  http.addHeader("Device-Capabilities", "[\"camera\",\"image_capture\",\"ov2640\",\"wifi\"]");
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
      Serial.printf("[HTTP] Response: %s\n", payload.c_str());
      success = true;
    } else if (httpCode >= 400) {
      String errorPayload = http.getString();
      Serial.printf("[HTTP] Server error (%d): %s\n", httpCode, errorPayload.c_str());
    }
  } else {
    Serial.printf("[HTTP] POST... failed, error: %s\n", http.errorToString(httpCode).c_str());
    Serial.println("[HTTP] Check server connectivity and URL");
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

  // Quick frame size check for performance
  if (fb->len == 0) {
    Serial.println("Empty frame buffer");
    esp_camera_fb_return(fb);
    dropCount++;
    return;
  }

  // Send frame with timeout handling
  bool success = sendFrameToServer(fb);
  if (success) {
    successCount++;
  } else {
    dropCount++;
  }

  esp_camera_fb_return(fb); // IMPORTANT: Always return the frame buffer!
  
  // Print stats less frequently for performance
  frameCount++;
  if (frameCount % 50 == 0) {
    Serial.printf("Frames: %d, Success: %d, Dropped: %d, Success Rate: %.1f%%\n",
                 frameCount, successCount, dropCount, 
                 (float)successCount / frameCount * 100.0);
  }
}

// ===========================
// Main Program
// ===========================
void setup() {
  Serial.begin(921600);
  deviceStartTime = millis(); // Initialize device uptime tracking
  
  Serial.println("=== ESP32-CAM OV2640 Initialization ===");
  Serial.printf("Device ID: %s\n", DEVICE_ID);
  Serial.printf("Server URL: %s\n", SERVER_URL);
  Serial.printf("Target FPS: %d\n", TARGET_FPS);
  
  initWiFi();
  initCamera();
  
  Serial.println("Setup complete. Starting image capture loop...");
  Serial.println("Device will register automatically with server on first frame");
  Serial.println("Buzzer control initialized");
}

void loop() {
  unsigned long currentTime = millis();
  
  // Maintain target FPS with precise timing
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    lastFrameTime = currentTime;
    captureAndSendFrame();
  }
  
  // Minimal delay for watchdog and other tasks
  delay(1);
}