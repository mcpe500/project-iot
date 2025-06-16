/*
 * Configuration Header File
 * Contains ONLY configuration constants, pin definitions, and compile-time settings
 * No function declarations or global variables here
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===========================
// Network Configuration
// ===========================
#define WIFI_SSID "BIZNET357"
#define WIFI_PASSWORD "ivan4321"

// ===========================
// Server Configuration
// ===========================
#define SERVER_URL "http://203.175.11.145:9005/api/v1/stream/stream"
#define REGISTER_URL "http://203.175.11.145:9005/api/v1/devices/register"
#define HEARTBEAT_URL "http://203.175.11.145:9005/api/v1/devices/heartbeat"
#define API_KEY "dev-api-key-change-in-production"

// Fallback/Alternative Servers
#define FALLBACK_SERVER_URL "http://httpbin.org/post"
#define LOCAL_SERVER_URL "http://192.168.18.100:3000/upload"

// ===========================
// Device Configuration
// ===========================
#define DEVICE_ID "ESP32-CAM-001"
#define DEVICE_NAME "Camera #1"

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

// ===========================
// Performance Configuration
// ===========================
#define TARGET_FPS 10
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define HEARTBEAT_INTERVAL_MS 30000
#define STATS_INTERVAL_MS 5000
#define WIFI_CHECK_INTERVAL_MS 15000
#define WIFI_RECONNECT_INTERVAL_MS 60000

// ===========================
// Thermal Management Configuration
// ===========================
#define ENABLE_THERMAL_MANAGEMENT true
#define TEMPERATURE_CHECK_INTERVAL_MS 1500    // Check temperature every 1.5 seconds (more frequent)
#define TEMPERATURE_THRESHOLD_WARM 60.0       // Start light optimizations (°C)
#define TEMPERATURE_THRESHOLD_HIGH 68.0       // High temperature threshold (°C) - lowered
#define TEMPERATURE_THRESHOLD_CRITICAL 75.0   // Critical temperature threshold (°C) - lowered
#define COOLING_DELAY_MS 3000                 // Shorter cooling delay for responsiveness
#define THERMAL_FPS_REDUCTION_FACTOR 0.75     // Reduce FPS to 75% when hot (less aggressive)
#define THERMAL_QUALITY_ADJUSTMENT 1          // Smaller quality adjustment for better consistency
#define PROACTIVE_COOLING_ENABLED true        // Enable proactive cooling before overheating
#define TEMPERATURE_AVERAGING_SAMPLES 3       // Average temperature over multiple readings
#define AGGRESSIVE_COOLING_AT_STARTUP true    // Apply conservative settings initially

// ===========================
// Camera Configuration
// ===========================
#define INITIAL_CPU_FREQ_MHZ 160
#define MAX_CPU_FREQ_MHZ 240
#define XCLK_FREQ_HZ 20000000

// Quality settings
#define JPEG_QUALITY_PSRAM 30
#define JPEG_QUALITY_DRAM 40
#define JPEG_QUALITY_INITIAL 35

// Buffer settings
#define FB_COUNT_PSRAM 3
#define FB_COUNT_DRAM 1

// ===========================
// Network Settings
// ===========================
#define HTTP_TIMEOUT_MS 5000
#define WIFI_RETRY_COUNT 30
#define CHUNK_SIZE 1024
#define USE_FALLBACK_ON_ERROR true
#define MAX_SERVER_RETRIES 3
#define SERVER_TIMEOUT_REDUCTION_STEP 2000

// ===========================
// Debug Configuration
// ===========================
#define SERIAL_BAUD_RATE 921600
#define FRAME_LOG_INTERVAL 10
#define FAILURE_LOG_INTERVAL 5
#define WIFI_STATUS_LOG_INTERVAL 50

// Enhanced debugging options
#define DEBUG_HTTP_RESPONSES true
#define DEBUG_PAYLOAD_SIZE true
#define TEST_SERVER_CONNECTIVITY true

// ===========================
// Memory Optimization
// ===========================
#define GC_INTERVAL_FRAMES 100
#define WATCHDOG_FEED_DELAY_MS 1

#endif // CONFIG_H
