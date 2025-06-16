/*
 * ESP32-S3 OV5640 Camera High-Performance Video Streaming
 * MAXIMUM QUALITY OPTIMIZATION FOR 720p @ 30 FPS
 * 
 * Features:
 * - 720p (1280x720) resolution at 30 FPS target
 * - JPEG Quality optimization with PSRAM support
 * - Triple buffering with PSRAM optimization
 * - Real-time performance monitoring
 * - Modular architecture for maintainability
 * - Advanced retry logic and fallback servers
 * 
 * Hardware: ESP32-S3 + OV5640 Camera Module + PSRAM
 * 
 * File Structure:
 * - config.h: Configuration constants and pin definitions
 * - globals.h: Global variables and external declarations
 * - wifi_manager.h/.cpp: WiFi and network management
 * - camera_manager.h/.cpp: Camera operations and frame handling
 * - iot_camera_stream.ino: Main program logic and performance monitoring
 */

#include "config.h"
#include "globals.h"
#include "wifi_manager.h"
#include "camera_manager.h"

// ===========================
// Global Variable Definitions
// ===========================

// HTTP Objects
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
unsigned long lastWiFiCheck = 0;
unsigned long lastReconnectAttempt = 0;

// Thermal Management Variables
unsigned long lastTemperatureCheck = 0;
float currentTemperature = 25.0;  // Initialize to room temperature
float temperatureHistory[TEMPERATURE_AVERAGING_SAMPLES] = {25.0}; // Initialize all to room temp
int temperatureHistoryIndex = 0;
bool thermalThrottling = false;
float thermalAdjustedFPS = TARGET_FPS;
int thermalAdjustedQuality = JPEG_QUALITY_PSRAM;
bool proactiveCoolingActive = false;
bool startupCoolingPhase = AGGRESSIVE_COOLING_AT_STARTUP;
unsigned long startupPhaseEndTime = 0;

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

  // Initialize thermal management
  if (AGGRESSIVE_COOLING_AT_STARTUP) {
    startupPhaseEndTime = millis() + 120000; // 2 minutes of conservative settings
    Serial.println("🚀 Startup cooling phase: 2 minutes of conservative settings for image stability");
  }
  
  // Initialize temperature history
  for (int i = 0; i < TEMPERATURE_AVERAGING_SAMPLES; i++) {
    temperatureHistory[i] = 25.0; // Room temperature baseline
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
    // Test server connectivity first
    if (testServerConnectivity()) {
      Serial.println("Testing simple HTTP POST...");
      testSimpleUpload();
      registerDevice();
    } else {
      Serial.println("⚠️ Server connectivity test failed - will retry during streaming");
    }
  }
  
  Serial.println("Setup complete. Starting video stream...");
  streamStartTime = millis();
  lastFrameTime = streamStartTime;
  lastHeartbeatTime = streamStartTime;
  lastStatsTime = streamStartTime;
  lastWiFiCheck = streamStartTime;
}

void loop() {
  // --- REMOVE THE FRAME INTERVAL CHECK ---
  // This lets the loop run as fast as the hardware and network physically allow,
  // which is what we want for maximum performance.
  captureAndSendFrame();
  
  // These other tasks will run between frame captures, which is perfect.
  unsigned long currentTime = millis();
  if (currentTime - lastHeartbeatTime >= HEARTBEAT_INTERVAL_MS) {
    sendHeartbeat();
    lastHeartbeatTime = currentTime;
  }
  if (currentTime - lastStatsTime >= STATS_INTERVAL_MS) {
    printPerformanceStats();
    lastStatsTime = currentTime;
  }
  checkWiFiConnection();
  
  // A tiny delay can prevent the watchdog timer from resetting the ESP
  // in very tight, high-speed loops. Start with 1.
  delay(1); 
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
  Serial.printf("FPS: %.2f (Target: %d", actualFPS, TARGET_FPS);
  if (thermalAdjustedFPS != TARGET_FPS) {
    Serial.printf(", Thermal: %.1f", thermalAdjustedFPS);
  }
  Serial.printf(")\n");
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
  Serial.printf("Thermal: %.1f°C", currentTemperature);
  if (thermalThrottling) {
    Serial.printf(" (OPTIMIZED)");
  } else if (proactiveCoolingActive) {
    Serial.printf(" (PROACTIVE)");
  } else if (startupCoolingPhase) {
    Serial.printf(" (STARTUP)");
  }
  Serial.println();
  
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


