/*
 * Configuration Header File
 * Contains all configuration constants and pin definitions
 */

#ifndef CONFIG_H
#define CONFIG_H

// ===========================
// Network Configuration
// ===========================
const char* WIFI_SSID = "BIZNET357";
const char* WIFI_PASSWORD = "ivan4321";

// ===========================
// Server Configuration
// ===========================
const char* SERVER_URL = "http://203.175.11.145:9005/api/v1/stream/stream";
const char* REGISTER_URL = "http://203.175.11.145:9005/api/v1/devices/register";
const char* HEARTBEAT_URL = "http://203.175.11.145:9005/api/v1/devices/heartbeat";
const char* API_KEY = "dev-api-key-change-in-production";

// ===========================
// Device Configuration
// ===========================
const char* DEVICE_ID = "ESP32-CAM-001";
const char* DEVICE_NAME = "Camera #1";

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
#define TARGET_FPS 30
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define HEARTBEAT_INTERVAL_MS 30000
#define STATS_INTERVAL_MS 5000
#define WIFI_CHECK_INTERVAL_MS 15000
#define WIFI_RECONNECT_INTERVAL_MS 60000

// ===========================
// Camera Configuration
// ===========================
#define INITIAL_CPU_FREQ_MHZ 160
#define MAX_CPU_FREQ_MHZ 240
#define XCLK_FREQ_HZ 20000000

// Quality settings
#define JPEG_QUALITY_PSRAM 6
#define JPEG_QUALITY_DRAM 12
#define JPEG_QUALITY_INITIAL 10

// Buffer settings
#define FB_COUNT_PSRAM 2
#define FB_COUNT_DRAM 1

// Network settings
#define HTTP_TIMEOUT_MS 10000
#define WIFI_RETRY_COUNT 30
#define CHUNK_SIZE 1024

// ===========================
// Debug Configuration
// ===========================
#define SERIAL_BAUD_RATE 115200
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
