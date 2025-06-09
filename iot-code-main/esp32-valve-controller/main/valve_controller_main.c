/*
 * ESP32 Valve Controller Main Application
 * 
 * Handles valve control operations with relay control, position feedback,
 * and communication with the master coordinator and backend server.
 * 
 * Hardware:
 * - ESP32 DevKit
 * - Relay module for valve control
 * - Position feedback sensor (optional)
 * - Status LEDs and emergency button
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "driver/adc.h"
#include "lwip/err.h"
#include "lwip/sys.h"
#include "lwip/sockets.h"
#include "cJSON.h"

#include "iot_system_config.h"

static const char *TAG = "VALVE_CONTROLLER";

// WiFi connection bits
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
static EventGroupHandle_t s_wifi_event_group;
static int s_retry_num = 0;

// Device status and configuration
static device_info_t device_info;
static valve_config_t valve_config;
static valve_status_t valve_status;
static QueueHandle_t command_queue;
static esp_timer_handle_t heartbeat_timer;
static esp_timer_handle_t valve_operation_timer;

// UDP socket for device communication
static int udp_socket = -1;
static struct sockaddr_in master_addr;

// Function prototypes
static void wifi_init_sta(void);
static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data);
static void valve_gpio_init(void);
static void valve_control_task(void* pvParameters);
static void communication_task(void* pvParameters);
static void heartbeat_callback(void* arg);
static void valve_timer_callback(void* arg);
static esp_err_t valve_open(void);
static esp_err_t valve_close(void);
static esp_err_t valve_set_position(uint8_t position);
static esp_err_t send_status_to_backend(void);
static esp_err_t send_message_to_master(command_type_t cmd, uint8_t* payload, size_t payload_len);
static esp_err_t process_command(iot_message_t* message);

void app_main(void)
{
    ESP_LOGI(TAG, "ESP32 Valve Controller starting...");
    ESP_LOGI(TAG, "Version: %s", SYSTEM_VERSION);
    ESP_LOGI(TAG, "Device ID: 0x%02X", VALVE_DEVICE_ID);

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize device information
    memset(&device_info, 0, sizeof(device_info));
    device_info.device_id = VALVE_DEVICE_ID;
    device_info.type = DEVICE_TYPE_VALVE;
    device_info.status = DEVICE_STATUS_OFFLINE;
    strcpy(device_info.device_name, VALVE_DEVICE_NAME);

    // Initialize valve configuration with defaults
    valve_config.type = VALVE_TYPE_SOLENOID;
    valve_config.relay_pin = VALVE_RELAY_PIN;
    valve_config.feedback_pin = VALVE_FEEDBACK_PIN;
    valve_config.open_time_ms = 2000;    // 2 seconds to open
    valve_config.close_time_ms = 2000;   // 2 seconds to close
    valve_config.auto_close_enabled = true;
    valve_config.auto_close_timeout = 30000; // 30 seconds
    valve_config.position_min = 0;
    valve_config.position_max = 100;

    // Initialize valve status
    memset(&valve_status, 0, sizeof(valve_status));
    valve_status.state = VALVE_STATE_CLOSED;
    valve_status.position = 0;
    valve_status.target_position = 0;

    // Initialize GPIO
    valve_gpio_init();

    // Initialize WiFi
    wifi_init_sta();

    // Create queues and timers
    command_queue = xQueueCreate(10, sizeof(iot_message_t));
    if (command_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create command queue");
        return;
    }

    // Create heartbeat timer
    const esp_timer_create_args_t heartbeat_timer_args = {
        .callback = &heartbeat_callback,
        .name = "heartbeat"
    };
    ESP_ERROR_CHECK(esp_timer_create(&heartbeat_timer_args, &heartbeat_timer));

    // Create valve operation timer
    const esp_timer_create_args_t valve_timer_args = {
        .callback = &valve_timer_callback,
        .name = "valve_operation"
    };
    ESP_ERROR_CHECK(esp_timer_create(&valve_timer_args, &valve_operation_timer));

    // Create tasks
    xTaskCreatePinnedToCore(valve_control_task, "valve_control", 4096, NULL, 5, NULL, 0);
    xTaskCreatePinnedToCore(communication_task, "communication", 8192, NULL, 4, NULL, 1);

    // Start heartbeat timer
    ESP_ERROR_CHECK(esp_timer_start_periodic(heartbeat_timer, DEVICE_HEARTBEAT_INTERVAL * 1000));

    ESP_LOGI(TAG, "ESP32 Valve Controller initialized successfully");
}

static void valve_gpio_init(void)
{
    ESP_LOGI(TAG, "Initializing GPIO pins...");

    // Configure relay pin as output
    gpio_config_t relay_config = {
        .pin_bit_mask = (1ULL << valve_config.relay_pin),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_ERROR_CHECK(gpio_config(&relay_config));
    gpio_set_level(valve_config.relay_pin, 0); // Start with valve closed

    // Configure status LED pin
    gpio_config_t led_config = {
        .pin_bit_mask = (1ULL << VALVE_STATUS_LED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_ERROR_CHECK(gpio_config(&led_config));
    gpio_set_level(VALVE_STATUS_LED_PIN, 0);

    // Configure emergency button pin
    gpio_config_t btn_config = {
        .pin_bit_mask = (1ULL << VALVE_EMERGENCY_BTN_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE
    };
    ESP_ERROR_CHECK(gpio_config(&btn_config));

    // Configure feedback pin if available
    if (valve_config.feedback_pin > 0) {
        gpio_config_t feedback_config = {
            .pin_bit_mask = (1ULL << valve_config.feedback_pin),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_ENABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE
        };
        ESP_ERROR_CHECK(gpio_config(&feedback_config));
    }

    ESP_LOGI(TAG, "GPIO initialization complete");
}

static void valve_control_task(void* pvParameters)
{
    iot_message_t message;
    TickType_t xLastWakeTime = xTaskGetTickCount();

    ESP_LOGI(TAG, "Valve control task started");

    while (1) {
        // Check for emergency button press
        if (gpio_get_level(VALVE_EMERGENCY_BTN_PIN) == 0) {
            ESP_LOGW(TAG, "Emergency button pressed!");
            valve_status.emergency_stop = true;
            valve_close();
            vTaskDelay(pdMS_TO_TICKS(1000)); // Debounce
        }

        // Process commands from queue
        if (xQueueReceive(command_queue, &message, pdMS_TO_TICKS(100)) == pdTRUE) {
            process_command(&message);
        }

        // Update status LED based on valve state
        switch (valve_status.state) {
            case VALVE_STATE_OPEN:
                gpio_set_level(VALVE_STATUS_LED_PIN, 1);
                break;
            case VALVE_STATE_CLOSED:
                gpio_set_level(VALVE_STATUS_LED_PIN, 0);
                break;
            case VALVE_STATE_OPENING:
            case VALVE_STATE_CLOSING:
                // Blink LED during operation
                gpio_set_level(VALVE_STATUS_LED_PIN, (esp_timer_get_time() / 250000) % 2);
                break;
            case VALVE_STATE_ERROR:
                // Fast blink for error
                gpio_set_level(VALVE_STATUS_LED_PIN, (esp_timer_get_time() / 100000) % 2);
                break;
            default:
                gpio_set_level(VALVE_STATUS_LED_PIN, 0);
                break;
        }

        // Auto-close functionality
        if (valve_config.auto_close_enabled && 
            valve_status.state == VALVE_STATE_OPEN &&
            (esp_timer_get_time() / 1000 - valve_status.last_operation_time) > valve_config.auto_close_timeout) {
            ESP_LOGI(TAG, "Auto-closing valve after timeout");
            valve_close();
        }

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(100));
    }
}

static void communication_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Communication task started");

    // Wait for WiFi connection
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, false, true, portMAX_DELAY);

    // Initialize UDP socket for master communication
    udp_socket = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (udp_socket < 0) {
        ESP_LOGE(TAG, "Unable to create socket: errno %d", errno);
        vTaskDelete(NULL);
        return;
    }

    // Set up master coordinator address
    master_addr.sin_family = AF_INET;
    master_addr.sin_port = htons(MASTER_UDP_PORT);
    inet_pton(AF_INET, BACKEND_SERVER_IP, &master_addr.sin_addr.s_addr); // Use backend IP for now

    // Bind to local port
    struct sockaddr_in local_addr;
    local_addr.sin_family = AF_INET;
    local_addr.sin_port = htons(VALVE_UDP_PORT);
    local_addr.sin_addr.s_addr = INADDR_ANY;
    
    int err = bind(udp_socket, (struct sockaddr*)&local_addr, sizeof(local_addr));
    if (err < 0) {
        ESP_LOGE(TAG, "Socket unable to bind: errno %d", errno);
        close(udp_socket);
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "Socket bound to port %d", VALVE_UDP_PORT);

    char rx_buffer[1024];
    struct sockaddr_in source_addr;
    socklen_t socklen = sizeof(source_addr);

    while (1) {
        // Receive messages
        int len = recvfrom(udp_socket, rx_buffer, sizeof(rx_buffer) - 1, MSG_DONTWAIT, 
                          (struct sockaddr*)&source_addr, &socklen);
        
        if (len > 0) {
            rx_buffer[len] = 0; // Null-terminate
            ESP_LOGI(TAG, "Received %d bytes from %s:%d", len, 
                    inet_ntoa(source_addr.sin_addr), ntohs(source_addr.sin_port));
            
            // Process received message
            if (len >= sizeof(message_header_t)) {
                iot_message_t* msg = (iot_message_t*)rx_buffer;
                if (msg->header.magic == PROTOCOL_MAGIC && 
                    (msg->header.target_id == VALVE_DEVICE_ID || msg->header.target_id == 0xFF)) {
                    xQueueSend(command_queue, msg, 0);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static esp_err_t valve_open(void)
{
    if (valve_status.emergency_stop) {
        ESP_LOGW(TAG, "Cannot open valve - emergency stop active");
        return ESP_ERR_INVALID_STATE;
    }

    ESP_LOGI(TAG, "Opening valve...");
    valve_status.state = VALVE_STATE_OPENING;
    valve_status.target_position = 100;
    valve_status.last_operation_time = esp_timer_get_time() / 1000;
    
    gpio_set_level(valve_config.relay_pin, 1);
    
    // Start timer for operation completion
    ESP_ERROR_CHECK(esp_timer_start_once(valve_operation_timer, valve_config.open_time_ms * 1000));
    
    valve_status.operation_count++;
    return ESP_OK;
}

static esp_err_t valve_close(void)
{
    ESP_LOGI(TAG, "Closing valve...");
    valve_status.state = VALVE_STATE_CLOSING;
    valve_status.target_position = 0;
    valve_status.last_operation_time = esp_timer_get_time() / 1000;
    
    gpio_set_level(valve_config.relay_pin, 0);
    
    // Start timer for operation completion
    ESP_ERROR_CHECK(esp_timer_start_once(valve_operation_timer, valve_config.close_time_ms * 1000));
    
    valve_status.operation_count++;
    return ESP_OK;
}

static esp_err_t valve_set_position(uint8_t position)
{
    position = CLAMP(position, valve_config.position_min, valve_config.position_max);
    
    ESP_LOGI(TAG, "Setting valve position to %d%%", position);
    valve_status.target_position = position;
    
    if (position > 50) {
        return valve_open();
    } else {
        return valve_close();
    }
}

static void valve_timer_callback(void* arg)
{
    // Valve operation completed
    if (valve_status.state == VALVE_STATE_OPENING) {
        valve_status.state = VALVE_STATE_OPEN;
        valve_status.position = valve_status.target_position;
        ESP_LOGI(TAG, "Valve opened successfully");
    } else if (valve_status.state == VALVE_STATE_CLOSING) {
        valve_status.state = VALVE_STATE_CLOSED;
        valve_status.position = valve_status.target_position;
        ESP_LOGI(TAG, "Valve closed successfully");
    }
    
    valve_status.operation_duration = esp_timer_get_time() / 1000 - valve_status.last_operation_time;
}

static esp_err_t process_command(iot_message_t* message)
{
    ESP_LOGI(TAG, "Processing command: 0x%02X from device 0x%02X", 
             message->header.command, message->header.device_id);

    switch (message->header.command) {
        case CMD_PING:
            send_message_to_master(CMD_PING, NULL, 0);
            break;
            
        case CMD_STATUS_REQUEST:
            send_status_to_backend();
            break;
            
        case CMD_VALVE_OPEN:
            valve_open();
            break;
            
        case CMD_VALVE_CLOSE:
            valve_close();
            break;
            
        case CMD_VALVE_TOGGLE:
            if (valve_status.state == VALVE_STATE_OPEN) {
                valve_close();
            } else if (valve_status.state == VALVE_STATE_CLOSED) {
                valve_open();
            }
            break;
            
        case CMD_VALVE_SET_POSITION:
            if (message->header.payload_length >= 1) {
                valve_set_position(message->payload[0]);
            }
            break;
            
        case CMD_VALVE_GET_STATUS:
            send_status_to_backend();
            break;
            
        case CMD_VALVE_EMERGENCY_STOP:
            valve_status.emergency_stop = true;
            valve_close();
            ESP_LOGW(TAG, "Emergency stop activated");
            break;
            
        case CMD_REBOOT:
            ESP_LOGW(TAG, "Reboot command received");
            vTaskDelay(pdMS_TO_TICKS(1000));
            esp_restart();
            break;
            
        default:
            ESP_LOGW(TAG, "Unknown command: 0x%02X", message->header.command);
            return ESP_ERR_NOT_SUPPORTED;
    }
    
    return ESP_OK;
}

static esp_err_t send_status_to_backend(void)
{
    // Create JSON status report
    cJSON *json = cJSON_CreateObject();
    cJSON *device = cJSON_CreateObject();
    cJSON *valve = cJSON_CreateObject();
    
    cJSON_AddNumberToObject(device, "device_id", device_info.device_id);
    cJSON_AddStringToObject(device, "device_name", device_info.device_name);
    cJSON_AddNumberToObject(device, "status", device_info.status);
    cJSON_AddNumberToObject(device, "free_heap", esp_get_free_heap_size());
    cJSON_AddNumberToObject(device, "uptime", esp_timer_get_time() / 1000000);
    
    cJSON_AddNumberToObject(valve, "state", valve_status.state);
    cJSON_AddNumberToObject(valve, "position", valve_status.position);
    cJSON_AddNumberToObject(valve, "target_position", valve_status.target_position);
    cJSON_AddNumberToObject(valve, "operation_count", valve_status.operation_count);
    cJSON_AddBoolToObject(valve, "emergency_stop", valve_status.emergency_stop);
    
    cJSON_AddItemToObject(json, "device", device);
    cJSON_AddItemToObject(json, "valve", valve);
    
    char *json_string = cJSON_Print(json);
    
    // TODO: Send to backend via HTTP POST
    ESP_LOGI(TAG, "Status: %s", json_string);
    
    free(json_string);
    cJSON_Delete(json);
    
    return ESP_OK;
}

static esp_err_t send_message_to_master(command_type_t cmd, uint8_t* payload, size_t payload_len)
{
    if (udp_socket < 0) {
        return ESP_ERR_INVALID_STATE;
    }
    
    iot_message_t message;
    memset(&message, 0, sizeof(message));
    
    message.header.magic = PROTOCOL_MAGIC;
    message.header.version = PROTOCOL_VERSION;
    message.header.device_id = VALVE_DEVICE_ID;
    message.header.target_id = MASTER_DEVICE_ID;
    message.header.command = cmd;
    message.header.payload_length = payload_len;
    message.header.timestamp = esp_timer_get_time() / 1000;
    
    if (payload && payload_len > 0) {
        memcpy(message.payload, payload, MIN(payload_len, MAX_PAYLOAD_SIZE));
    }
    
    int err = sendto(udp_socket, &message, sizeof(message_header_t) + payload_len, 0,
                     (struct sockaddr*)&master_addr, sizeof(master_addr));
    
    if (err < 0) {
        ESP_LOGE(TAG, "Error occurred during sending: errno %d", errno);
        return ESP_ERR_INVALID_STATE;
    }
    
    return ESP_OK;
}

static void heartbeat_callback(void* arg)
{
    // Update device status
    device_info.status = DEVICE_STATUS_ONLINE;
    device_info.last_heartbeat = esp_timer_get_time() / 1000;
    device_info.free_heap = esp_get_free_heap_size();
    device_info.uptime_hours = (esp_timer_get_time() / 1000000) / 3600.0;
    
    // Send heartbeat to master
    send_message_to_master(CMD_PING, NULL, 0);
    
    // Send status to backend
    send_status_to_backend();
    
    ESP_LOGI(TAG, "Heartbeat sent - Valve State: %d, Position: %d%%", 
             valve_status.state, valve_status.position);
}

static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                              int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < MAX_RETRY_ATTEMPTS) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "retry to connect to the AP");
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
        ESP_LOGI(TAG,"connect to the AP fail");
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        sprintf(device_info.ip_address, IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler,
                                                        NULL,
                                                        &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASSWORD,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "wifi_init_sta finished.");
}
