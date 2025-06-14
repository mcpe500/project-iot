/*
 * IoT System Common Configuration
 * Shared definitions for all ESP devices in the multi-ESP IoT system
 * 
 * Device Types:
 * 1. ESP32-S3 Camera (ID: 0x01)
 * 2. ESP32 Valve Controller (ID: 0x02) 
 * 3. ESP32 Master Coordinator (ID: 0x03)
 */

#ifndef IOT_SYSTEM_CONFIG_H
#define IOT_SYSTEM_CONFIG_H

#include <stdint.h>

// ===========================
// System-Wide Configuration
// ===========================
#define SYSTEM_VERSION              "1.0.0"
#define MAX_DEVICE_COUNT           3
#define DEVICE_HEARTBEAT_INTERVAL  30000    // 30 seconds
#define COMMAND_TIMEOUT_MS         5000     // 5 seconds
#define MAX_RETRY_ATTEMPTS         3

// ===========================
// Network Configuration
// ===========================
#define WIFI_SSID                  "YOUR_WIFI_SSID"
#define WIFI_PASSWORD              "YOUR_WIFI_PASSWORD"
#define BACKEND_SERVER_IP          "192.168.1.100"
#define BACKEND_SERVER_PORT        3000

// Device Communication Ports
#define MASTER_UDP_PORT            8001
#define CAMERA_UDP_PORT            8002
#define VALVE_UDP_PORT             8003

// Backend API Endpoints
#define BACKEND_STREAM_ENDPOINT    "/api/v1/stream/stream"
#define BACKEND_DEVICE_ENDPOINT    "/api/v1/devices"
#define BACKEND_COMMAND_ENDPOINT   "/api/v1/control/command"
#define BACKEND_STATUS_ENDPOINT    "/api/v1/devices/status"

// ===========================
// Device Type Definitions
// ===========================
typedef enum {
    DEVICE_TYPE_UNKNOWN = 0x00,
    DEVICE_TYPE_CAMERA = 0x01,
    DEVICE_TYPE_VALVE = 0x02,
    DEVICE_TYPE_MASTER = 0x03
} device_type_t;

// ===========================
// Device Status Definitions
// ===========================
typedef enum {
    DEVICE_STATUS_OFFLINE = 0,
    DEVICE_STATUS_ONLINE = 1,
    DEVICE_STATUS_ERROR = 2,
    DEVICE_STATUS_MAINTENANCE = 3
} device_status_t;

// ===========================
// Command Types
// ===========================
typedef enum {
    CMD_PING = 0x01,
    CMD_STATUS_REQUEST = 0x02,
    CMD_REBOOT = 0x03,
    CMD_UPDATE_CONFIG = 0x04,
    
    // Camera specific commands
    CMD_CAM_START_STREAM = 0x10,
    CMD_CAM_STOP_STREAM = 0x11,
    CMD_CAM_TAKE_PHOTO = 0x12,
    CMD_CAM_ADJUST_QUALITY = 0x13,
    CMD_CAM_RECORD_START = 0x14,
    CMD_CAM_RECORD_STOP = 0x15,
    
    // Valve specific commands
    CMD_VALVE_OPEN = 0x20,
    CMD_VALVE_CLOSE = 0x21,
    CMD_VALVE_TOGGLE = 0x22,
    CMD_VALVE_SET_POSITION = 0x23,
    CMD_VALVE_GET_STATUS = 0x24,
    CMD_VALVE_EMERGENCY_STOP = 0x25
} command_type_t;

// ===========================
// Communication Protocol
// ===========================
#define PROTOCOL_MAGIC             0xA5A5
#define PROTOCOL_VERSION           1
#define MAX_PAYLOAD_SIZE           1024

typedef struct __attribute__((packed)) {
    uint16_t magic;                 // Protocol magic number
    uint8_t version;                // Protocol version
    uint8_t device_id;              // Source device ID
    uint8_t target_id;              // Target device ID (0xFF = broadcast)
    uint8_t command;                // Command type
    uint16_t payload_length;        // Payload data length
    uint32_t sequence;              // Sequence number for tracking
    uint32_t timestamp;             // Timestamp
    uint8_t checksum;               // Simple checksum
} message_header_t;

typedef struct {
    message_header_t header;
    uint8_t payload[MAX_PAYLOAD_SIZE];
} iot_message_t;

// ===========================
// Device Information Structure
// ===========================
typedef struct {
    uint8_t device_id;
    device_type_t type;
    device_status_t status;
    char device_name[32];
    char ip_address[16];
    uint32_t last_heartbeat;
    float uptime_hours;
    uint32_t free_heap;
    int8_t wifi_rssi;
    uint8_t error_count;
} device_info_t;

// ===========================
// Camera Specific Definitions
// ===========================
#define CAMERA_DEVICE_ID           0x01
#define CAMERA_DEVICE_NAME         "ESP32S3-Camera"

// Camera configuration
typedef struct {
    uint8_t fps;                    // Target FPS (1-30)
    uint8_t quality;                // JPEG quality (1-63)
    uint8_t frame_size;             // Frame size enum
    bool auto_exposure;
    bool auto_white_balance;
    int8_t brightness;              // -2 to +2
    int8_t contrast;                // -2 to +2
    int8_t saturation;              // -2 to +2
} camera_config_t;

// Camera status
typedef struct {
    bool streaming;
    bool recording;
    uint32_t frames_captured;
    uint32_t frames_sent;
    uint32_t frames_failed;
    float current_fps;
    uint32_t total_data_sent;       // In bytes
    uint8_t sensor_temperature;     // In Celsius
} camera_status_t;

// ===========================
// Valve Controller Definitions
// ===========================
#define VALVE_DEVICE_ID            0x02
#define VALVE_DEVICE_NAME          "ESP32-Valve"

// Valve types (for future expansion)
typedef enum {
    VALVE_TYPE_SOLENOID = 0,       // Simple on/off
    VALVE_TYPE_SERVO = 1,          // Position control
    VALVE_TYPE_STEPPER = 2,        // Precise positioning
    VALVE_TYPE_MOTOR = 3           // Continuous rotation
} valve_type_t;

// Valve states
typedef enum {
    VALVE_STATE_CLOSED = 0,
    VALVE_STATE_OPEN = 1,
    VALVE_STATE_OPENING = 2,
    VALVE_STATE_CLOSING = 3,
    VALVE_STATE_ERROR = 4,
    VALVE_STATE_MAINTENANCE = 5
} valve_state_t;

// Valve configuration
typedef struct {
    valve_type_t type;
    uint8_t relay_pin;              // GPIO pin for relay
    uint8_t feedback_pin;           // GPIO pin for position feedback
    uint16_t open_time_ms;          // Time to fully open
    uint16_t close_time_ms;         // Time to fully close
    bool auto_close_enabled;        // Auto-close after timeout
    uint32_t auto_close_timeout;    // Auto-close timeout in ms
    uint8_t position_min;           // Minimum position (0-100%)
    uint8_t position_max;           // Maximum position (0-100%)
} valve_config_t;

// Valve status
typedef struct {
    valve_state_t state;
    uint8_t position;               // Current position (0-100%)
    uint8_t target_position;        // Target position (0-100%)
    uint32_t operation_count;       // Total operations
    uint32_t last_operation_time;   // Last operation timestamp
    uint16_t operation_duration;    // Last operation duration in ms
    bool emergency_stop;            // Emergency stop status
    float operating_voltage;        // Current operating voltage
    uint8_t temperature;            // Operating temperature
} valve_status_t;

// ===========================
// Master Coordinator Definitions
// ===========================
#define MASTER_DEVICE_ID           0x03
#define MASTER_DEVICE_NAME         "ESP32-Master"

// System status
typedef struct {
    uint8_t devices_online;
    uint8_t devices_total;
    uint32_t system_uptime;
    uint32_t total_commands_sent;
    uint32_t total_commands_failed;
    bool backend_connected;
    uint32_t last_backend_sync;
    uint8_t system_load;            // 0-100%
} system_status_t;

// ===========================
// Pin Definitions
// ===========================

// ESP32-S3 Camera Pins (OV5640)
#define CAM_PIN_PWDN               -1
#define CAM_PIN_RESET              -1
#define CAM_PIN_XCLK               15
#define CAM_PIN_SIOD               4
#define CAM_PIN_SIOC               5
#define CAM_PIN_D7                 16
#define CAM_PIN_D6                 17
#define CAM_PIN_D5                 18
#define CAM_PIN_D4                 12
#define CAM_PIN_D3                 10
#define CAM_PIN_D2                 8
#define CAM_PIN_D1                 9
#define CAM_PIN_D0                 11
#define CAM_PIN_VSYNC              6
#define CAM_PIN_HREF               7
#define CAM_PIN_PCLK               13

// ESP32 Valve Controller Pins
#define VALVE_RELAY_PIN            2   // GPIO2 for relay control
#define VALVE_FEEDBACK_PIN         4   // GPIO4 for position feedback
#define VALVE_STATUS_LED_PIN       5   // GPIO5 for status LED
#define VALVE_EMERGENCY_BTN_PIN    0   // GPIO0 for emergency button

// ESP32 Master Coordinator Pins
#define MASTER_STATUS_LED_PIN      2   // GPIO2 for system status LED
#define MASTER_ERROR_LED_PIN       4   // GPIO4 for error indication
#define MASTER_BUZZER_PIN          5   // GPIO5 for audio alerts
#define MASTER_RESET_BTN_PIN       0   // GPIO0 for system reset

// ===========================
// Utility Macros
// ===========================
#define ARRAY_SIZE(x)              (sizeof(x) / sizeof((x)[0]))
#define MIN(a, b)                  ((a) < (b) ? (a) : (b))
#define MAX(a, b)                  ((a) > (b) ? (a) : (b))
#define CLAMP(x, min, max)         (MIN(MAX(x, min), max))

// Time conversion macros
#define MS_TO_TICKS(ms)            (ms / portTICK_PERIOD_MS)
#define SECONDS_TO_MS(s)           (s * 1000)
#define MINUTES_TO_MS(m)           (m * 60 * 1000)

// Memory alignment
#define ALIGN_4(x)                 (((x) + 3) & ~3)
#define ALIGN_8(x)                 (((x) + 7) & ~7)

// ===========================
// Debug and Logging
// ===========================
#define LOG_LEVEL_ERROR            0
#define LOG_LEVEL_WARN             1
#define LOG_LEVEL_INFO             2
#define LOG_LEVEL_DEBUG            3
#define LOG_LEVEL_VERBOSE          4

#ifndef LOG_LEVEL
#define LOG_LEVEL                  LOG_LEVEL_INFO
#endif

// ===========================
// Error Codes
// ===========================
typedef enum {
    IOT_OK = 0,
    IOT_ERR_INVALID_PARAM = -1,
    IOT_ERR_NO_MEMORY = -2,
    IOT_ERR_TIMEOUT = -3,
    IOT_ERR_NOT_FOUND = -4,
    IOT_ERR_COMMUNICATION = -5,
    IOT_ERR_DEVICE_OFFLINE = -6,
    IOT_ERR_INVALID_STATE = -7,
    IOT_ERR_CHECKSUM = -8,
    IOT_ERR_PROTOCOL = -9,
    IOT_ERR_HARDWARE = -10
} iot_error_t;

#endif // IOT_SYSTEM_CONFIG_H
