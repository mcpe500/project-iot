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
 * 
 * Code Structure:
 * - config.h: All configuration constants and pin definitions
 * - camera_network.h: Camera and network function implementations
 * - iot_camera_stream.ino: Main program logic and performance monitoring
 */

#include "config.h"
#include "camera_network.h"

// Global objects
HTTPClient http;
WiFiClient client;

// Timing variables
unsigned long lastFrameTime = 0;
unsigned long lastHeartbeatTime = 0;
unsigned long lastStatsTime = 0;
unsigned long streamStartTime = 0;

// Performance tracking
uint32_t frameCount = 0;
uint32_t successCount = 0;
uint32_t dropCount = 0;
uint32_t totalBytes = 0;
bool deviceRegistered = false;

// WiFi management
static unsigned long lastWiFiCheck = 0;
static unsigned long lastReconnectAttempt = 0;

void setup() {
  // Initialize serial communication
  Serial.begin(SERIAL_BAUD_RATE);
  delay(2000);
  
  // System information
  Serial.println("\nESP32-S3 OV5640 Camera Stream Initializing...");
  Serial.println("System Information:");
  Serial.printf("- Chip: %s Rev %d\n", ESP.getChipModel(), ESP.getChipRevision());
  Serial.printf("- Flash: %d bytes\n", ESP.getFlashChipSize());
  Serial.printf("- Free Heap: %lu bytes\n", ESP.getFreeHeap());

  // CPU frequency optimization
  setCpuFrequencyMhz(INITIAL_CPU_FREQ_MHZ);
  Serial.printf("- CPU Frequency: %d MHz\n", getCpuFrequencyMhz());
  
  // PSRAM check
  if (psramFound()) {
    Serial.printf("- PSRAM: %d bytes\n", ESP.getPsramSize());
  } else {
    Serial.println("- PSRAM: Not found - using conservative settings");
  }

  // Initialize subsystems
  Serial.println("\nInitializing WiFi...");
  initWiFi();
  
  Serial.println("\nInitializing camera...");
  delay(3000); // Stability delay
  initCamera();
  
  // Performance boost
  delay(2000);
  setCpuFrequencyMhz(MAX_CPU_FREQ_MHZ);
  Serial.printf("CPU boosted to: %d MHz\n", getCpuFrequencyMhz());
  
  // Register device if WiFi connected
  if (WiFi.status() == WL_CONNECTED) {
    registerDevice();
  }
  
  Serial.println("Setup complete. Starting video stream...");
  streamStartTime = millis();
  lastFrameTime = streamStartTime;
  lastHeartbeatTime = streamStartTime;
  lastStatsTime = streamStartTime;
  lastWiFiCheck = streamStartTime;
}

void loop() {
  unsigned long currentTime = millis();
  
  // Frame capture and transmission
  if (currentTime - lastFrameTime >= FRAME_INTERVAL_MS) {
    captureAndSendFrame();
    lastFrameTime = currentTime;
  }
  
  // Heartbeat transmission
  if (currentTime - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
    lastHeartbeatTime = currentTime;
  }
  
  // Performance statistics
  if (currentTime - lastStatsTime >= STATS_INTERVAL_MS) {
    printPerformanceStats();
    lastStatsTime = currentTime;
  }
  
  // WiFi connection monitoring
  if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL_MS) {
    if (WiFi.status() != WL_CONNECTED) {
      if (currentTime - lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
        Serial.printf("WiFi disconnected (%s) - reconnecting...\n", 
                      getWiFiStatusString(WiFi.status()).c_str());
        initWiFi();
        lastReconnectAttempt = currentTime;
      }
    } else {
      lastReconnectAttempt = 0; // Reset reconnect timer
    }
    lastWiFiCheck = currentTime;
  }
  
  // Memory management and watchdog
  if (frameCount % GC_INTERVAL_FRAMES == 0) {
    ESP.getFreeHeap(); // Trigger garbage collection
  }
  
  delay(WATCHDOG_FEED_DELAY_MS); // Feed watchdog
}

// ===========================
// Performance Monitoring
// ===========================

void printPerformanceStats() {
  unsigned long currentTime = millis();
  unsigned long runTime = currentTime - streamStartTime;
  
  if (runTime == 0) return;
  
  float actualFPS = (float)frameCount * 1000.0 / runTime;
  float successRate = frameCount > 0 ? (float)successCount * 100.0 / frameCount : 0;
  float avgFrameSize = successCount > 0 ? (float)totalBytes / successCount : 0;
  float throughputKBps = (float)totalBytes / (runTime / 1000.0) / 1024.0;
  
  Serial.println("\n" + String("=").substring(0, 50));
  Serial.println("📊 PERFORMANCE STATISTICS");
  Serial.println(String("=").substring(0, 50));
  Serial.printf("Runtime: %lu.%03lu seconds\n", runTime/1000, runTime%1000);
  Serial.printf("FPS: %.2f (Target: %d)\n", actualFPS, TARGET_FPS);
  Serial.printf("Frames: Total=%lu, Success=%lu, Dropped=%lu\n", frameCount, successCount, dropCount);
  Serial.printf("Success Rate: %.1f%%\n", successRate);
  Serial.printf("Frame Size: %.1f KB avg\n", avgFrameSize/1024.0);
  Serial.printf("Throughput: %.1f KB/s\n", throughputKBps);
  Serial.printf("Memory: Free=%lu", ESP.getFreeHeap());
  if (psramFound()) {
    Serial.printf(", PSRAM=%lu", ESP.getFreePsram());
  }
  Serial.printf(" bytes\n");
  Serial.printf("Network: RSSI=%d dBm, CPU=%d MHz\n", WiFi.RSSI(), getCpuFrequencyMhz());
  
  // Performance rating
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


