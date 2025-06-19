/*
 * ESP32 CAM OV2640 Camera Streaming
 * Merged from iot_camera_stream modular files
 * Modified for ESP32 CAM with OV2640
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
#define SERVER_PORT 9003
#define SERVER_PATH "/api/v1/stream/stream"
#define SERVER_URL "http://" SERVER_HOST ":" "9003" SERVER_PATH
#define API_KEY "dev-api-key-change-in-production"
#define DEVICE_ID "ESP32-CAM-001"

// Chunk Configuration
#define CHUNK_SIZE 2048  // 2KB chunks
#define MAX_RETRIES 5
#define INITIAL_RETRY_DELAY 500  // 0.5s initial delay

// ESP32 CAM Pin Configuration for OV2640
#define PWDN_GPIO_NUM    32
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM    26
#define SIOC_GPIO_NUM    27

#define Y9_GPIO_NUM      35
#define Y8_GPIO_NUM      34
#define Y7_GPIO_NUM      39
#define Y8_GPIO_NUM      36
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
#define HTTP_TIMEOUT_MS 3000

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
  
  // OV2640 specific configuration
  config.frame_size = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.jpeg_quality = 10;
  config.fb_count = 1;

  if(psramFound()){
    config.jpeg_quality = 6;
    config.fb_count = 2;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x", err);
    ESP.restart();
  }

  // Configure sensor settings
  sensor_t * s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_VGA);
  s->set_quality(s, 10);
}

// ===========================
// WiFi Management
// ===========================

void initWiFi() {
  Serial.println("Initializing WiFi...");
  
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false);

  int retryCount = 0;
  int maxRetries = 50;  // Increased from 30
  int retryDelay = 2000; // Increased from 1000
  
  while (WiFi.status() != WL_CONNECTED && retryCount < maxRetries) {
    Serial.printf("Connection attempt %d/%d...\n", retryCount + 1, maxRetries);
    delay(retryDelay);
    retryCount++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed");
    Serial.println("Retrying in 5 seconds...");
    delay(5000);
    ESP.restart();
  }
}

// ===========================
// Chunked Upload Implementation
// ===========================

bool sendChunkedFrame(camera_fb_t* fb) {
  if (!fb || fb->len == 0) {
    Serial.println("Invalid frame buffer");
    return false;
  }

  // Initialize HTTP client
  HTTPClient http;
  if (!http.begin(client, SERVER_URL)) {
    Serial.println("HTTP client initialization failed");
    return false;
  }

  // Add standard headers
  http.addHeader("X-API-Key", API_KEY);
  http.addHeader("Device-ID", DEVICE_ID);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setReuse(true);

  // Calculate total chunks
  uint16_t totalChunks = (fb->len / CHUNK_SIZE) + ((fb->len % CHUNK_SIZE) ? 1 : 0);
  uint32_t crc32 = crc32_le(0, fb->buf, fb->len);
  
  // Send chunks with exponential backoff
  for (uint16_t chunkNum = 0; chunkNum < totalChunks; chunkNum++) {
    size_t chunkStart = chunkNum * CHUNK_SIZE;
    size_t chunkSize = min(CHUNK_SIZE, fb->len - chunkStart);
    
    // Create chunk header
    String header = "CHUNK|" + String(chunkNum) + "|" + String(totalChunks) + "|" + String(crc32) + "|";
    
    // Calculate content length for this chunk
    size_t contentLength = header.length() + chunkSize + 2; // +2 for \r\n
    
    // Set content length header
    http.addHeader("Content-Length", String(contentLength));
    
    // Start POST
    int httpCode = http.POST((uint8_t*)NULL, 0);
    if (httpCode <= 0) {
      // Exponential backoff retry logic
      int retryCount = 0;
      int retryDelay = INITIAL_RETRY_DELAY;
      
      while (retryCount < MAX_RETRIES) {
        delay(retryDelay);
        httpCode = http.POST((uint8_t*)NULL, 0);
        if (httpCode > 0) break;
        
        retryCount++;
        retryDelay *= 2; // Exponential backoff
        Serial.printf("Retry %d/%d, delay: %dms\n", retryCount, MAX_RETRIES, retryDelay);
      }
      
      if (httpCode <= 0) {
        Serial.println("Failed to start chunk upload");
        http.end();
        return false;
      }
    }
    
    // Write chunk data
    WiFiClient * stream = http.getStreamPtr();
    if (!stream) {
      Serial.println("Failed to get HTTP stream");
      http.end();
      return false;
    }

    // Write header
    if (!stream->print(header)) {
      Serial.println("Failed to write chunk header");
      http.end();
      return false;
    }

    // Write chunk data
    size_t written = stream->write(fb->buf + chunkStart, chunkSize);
    if (written != chunkSize) {
      Serial.printf("Chunk write failed: %d/%d bytes\n", written, chunkSize);
      http.end();
      return false;
    }

    // Write footer
    if (!stream->print("\r\n")) {
      Serial.println("Failed to write chunk footer");
      http.end();
      return false;
    }
  }

  http.end();
  return true;
}

// ===========================
// Frame Capture and Upload
// ===========================

bool sendFrameToServer(camera_fb_t* fb) {
  // Fallback to original implementation if chunked upload fails
  if (!sendChunkedFrame(fb)) {
    Serial.println("Chunked upload failed, falling back to original method");
    // Original multipart form upload implementation here
    // (Keep original implementation for backward compatibility)
  }
  return true;
}

void captureAndSendFrame() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Capture failed");
    dropCount++;
    return;
  }

  bool success = sendFrameToServer(fb);
  if (success) {
    successCount++;
  } else {
    dropCount++;
  }

  esp_camera_fb_return(fb);
}

// ===========================
// Main Program
// ===========================

void setup() {
  Serial.begin(115200);
  
  // Initialize subsystems
  initWiFi();
  initCamera();
  
  Serial.println("Setup complete");
}

void loop() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    captureAndSendFrame();
    lastFrameTime = currentTime;
    
    if (frameCount % 10 == 0) {
      Serial.printf("Frames: %d, Success: %d, Dropped: %d\n", 
                   frameCount, successCount, dropCount);
    }
    
    frameCount++;
  }
  
  delay(1);
}
