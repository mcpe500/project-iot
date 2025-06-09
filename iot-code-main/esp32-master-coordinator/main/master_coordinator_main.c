/*
 * ESP32 Master Coordinator Main Application
 * 
 * Central coordinator for the IoT system that manages communication between
 * camera, valve controller, and backend server. Handles system orchestration,
 * device monitoring, and command routing.
 * 
 * Hardware:
 * - ESP32 DevKit
 * - Status LEDs for system status
 * - Buzzer for audio alerts
 * - Reset button
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "freertos/timers.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "esp_http_client.h"
#include "nvs_flash.h"
#include "driver/gpio.h"
#include "lwip/err.h"
#include "lwip/sys.h"
#include "lwip/sockets.h"
#include "cJSON.h"

#include "iot_system_config.h"

static const char *TAG = "MASTER_COORDINATOR";

// WiFi connection bits
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
static EventGroupHandle_t s_wifi_event_group;
static int s_retry_num = 0;

// Device status tracking
static device_info_t master_info;
static device_info_t camera_info;
static device_info_t valve_info;
static system_status_t system_status;
static QueueHandle_t command_queue;
static QueueHandle_t backend_queue;

// Communication sockets
static int udp_socket = -1;
static struct sockaddr_in camera_addr;
static struct sockaddr_in valve_addr;

// Timers
static esp_timer_handle_t heartbeat_timer;
static esp_timer_handle_t device_monitor_timer;
static esp_timer_handle_t backend_sync_timer;
static TimerHandle_t buzzer_timer;

// Function prototypes
static void wifi_init_sta(void);
static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data);
static void master_gpio_init(void);
static void device_monitor_task(void* pvParameters);
static void communication_task(void* pvParameters);
static void backend_sync_task(void* pvParameters);
static void command_processor_task(void* pvParameters);
static void heartbeat_callback(void* arg);
static void device_monitor_callback(void* arg);
static void backend_sync_callback(void* arg);
static void buzzer_timer_callback(TimerHandle_t timer);
static esp_err_t send_command_to_device(uint8_t device_id, command_type_t cmd, uint8_t* payload, size_t payload_len);
static esp_err_t sync_with_backend(void);
static esp_err_t process_backend_command(const char* command_json);
static esp_err_t update_device_status(uint8_t device_id, const iot_message_t* message);
static void play_alert_tone(int duration_ms);
static void update_status_leds(void);

void app_main(void)
{
    ESP_LOGI(TAG, "ESP32 Master Coordinator starting...");
    ESP_LOGI(TAG, "Version: %s", SYSTEM_VERSION);
    ESP_LOGI(TAG, "Device ID: 0x%02X", MASTER_DEVICE_ID);

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize master device information
    memset(&master_info, 0, sizeof(master_info));
    master_info.device_id = MASTER_DEVICE_ID;
    master_info.type = DEVICE_TYPE_MASTER;
    master_info.status = DEVICE_STATUS_OFFLINE;
    strcpy(master_info.device_name, MASTER_DEVICE_NAME);

    // Initialize other device info structures
    memset(&camera_info, 0, sizeof(camera_info));
    camera_info.device_id = CAMERA_DEVICE_ID;
    camera_info.type = DEVICE_TYPE_CAMERA;
    camera_info.status = DEVICE_STATUS_OFFLINE;
    strcpy(camera_info.device_name, CAMERA_DEVICE_NAME);

    memset(&valve_info, 0, sizeof(valve_info));
    valve_info.device_id = VALVE_DEVICE_ID;
    valve_info.type = DEVICE_TYPE_VALVE;
    valve_info.status = DEVICE_STATUS_OFFLINE;
    strcpy(valve_info.device_name, VALVE_DEVICE_NAME);

    // Initialize system status
    memset(&system_status, 0, sizeof(system_status));
    system_status.devices_total = MAX_DEVICE_COUNT;
    system_status.devices_online = 0;
    system_status.backend_connected = false;

    // Initialize GPIO
    master_gpio_init();

    // Initialize WiFi
    wifi_init_sta();

    // Create queues
    command_queue = xQueueCreate(20, sizeof(iot_message_t));
    backend_queue = xQueueCreate(10, 512); // For backend command strings
    if (command_queue == NULL || backend_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create queues");
        return;
    }

    // Create timers
    const esp_timer_create_args_t heartbeat_timer_args = {
        .callback = &heartbeat_callback,
        .name = "heartbeat"
    };
    ESP_ERROR_CHECK(esp_timer_create(&heartbeat_timer_args, &heartbeat_timer));

    const esp_timer_create_args_t monitor_timer_args = {
        .callback = &device_monitor_callback,
        .name = "device_monitor"
    };
    ESP_ERROR_CHECK(esp_timer_create(&monitor_timer_args, &device_monitor_timer));

    const esp_timer_create_args_t backend_timer_args = {
        .callback = &backend_sync_callback,
        .name = "backend_sync"
    };
    ESP_ERROR_CHECK(esp_timer_create(&backend_timer_args, &backend_sync_timer));

    // Create FreeRTOS timer for buzzer
    buzzer_timer = xTimerCreate("buzzer", pdMS_TO_TICKS(100), pdFALSE, NULL, buzzer_timer_callback);

    // Create tasks
    xTaskCreatePinnedToCore(device_monitor_task, "device_monitor", 4096, NULL, 5, NULL, 0);
    xTaskCreatePinnedToCore(communication_task, "communication", 8192, NULL, 4, NULL, 1);
    xTaskCreatePinnedToCore(backend_sync_task, "backend_sync", 8192, NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(command_processor_task, "command_processor", 4096, NULL, 4, NULL, 1);

    // Start timers
    ESP_ERROR_CHECK(esp_timer_start_periodic(heartbeat_timer, DEVICE_HEARTBEAT_INTERVAL * 1000));
    ESP_ERROR_CHECK(esp_timer_start_periodic(device_monitor_timer, 10000 * 1000)); // 10 seconds
    ESP_ERROR_CHECK(esp_timer_start_periodic(backend_sync_timer, 30000 * 1000)); // 30 seconds

    ESP_LOGI(TAG, "ESP32 Master Coordinator initialized successfully");
    play_alert_tone(200); // Startup beep
}

static void master_gpio_init(void)
{
    ESP_LOGI(TAG, "Initializing GPIO pins...");

    // Configure status LED pin
    gpio_config_t status_led_config = {
        .pin_bit_mask = (1ULL << MASTER_STATUS_LED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_ERROR_CHECK(gpio_config(&status_led_config));
    gpio_set_level(MASTER_STATUS_LED_PIN, 0);

    // Configure error LED pin
    gpio_config_t error_led_config = {
        .pin_bit_mask = (1ULL << MASTER_ERROR_LED_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_ERROR_CHECK(gpio_config(&error_led_config));
    gpio_set_level(MASTER_ERROR_LED_PIN, 0);

    // Configure buzzer pin
    gpio_config_t buzzer_config = {
        .pin_bit_mask = (1ULL << MASTER_BUZZER_PIN),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE
    };
    ESP_ERROR_CHECK(gpio_config(&buzzer_config));
    gpio_set_level(MASTER_BUZZER_PIN, 0);

    // Configure reset button pin
    gpio_config_t btn_config = {
        .pin_bit_mask = (1ULL << MASTER_RESET_BTN_PIN),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE
    };
    ESP_ERROR_CHECK(gpio_config(&btn_config));

    ESP_LOGI(TAG, "GPIO initialization complete");
}

static void device_monitor_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Device monitor task started");
    TickType_t xLastWakeTime = xTaskGetTickCount();

    while (1) {
        // Check reset button
        if (gpio_get_level(MASTER_RESET_BTN_PIN) == 0) {
            ESP_LOGW(TAG, "Reset button pressed!");
            play_alert_tone(500);
            vTaskDelay(pdMS_TO_TICKS(2000)); // Wait 2 seconds
            if (gpio_get_level(MASTER_RESET_BTN_PIN) == 0) {
                ESP_LOGW(TAG, "System reset initiated");
                esp_restart();
            }
        }

        // Update status LEDs
        update_status_leds();

        // Update system load (simple calculation based on free heap)
        uint32_t free_heap = esp_get_free_heap_size();
        uint32_t total_heap = heap_caps_get_total_size(MALLOC_CAP_DEFAULT);
        system_status.system_load = 100 - ((free_heap * 100) / total_heap);

        vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(1000));
    }
}

static void communication_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Communication task started");

    // Wait for WiFi connection
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, false, true, portMAX_DELAY);

    // Initialize UDP socket
    udp_socket = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (udp_socket < 0) {
        ESP_LOGE(TAG, "Unable to create socket: errno %d", errno);
        vTaskDelete(NULL);
        return;
    }

    // Set up device addresses
    camera_addr.sin_family = AF_INET;
    camera_addr.sin_port = htons(CAMERA_UDP_PORT);
    inet_pton(AF_INET, "255.255.255.255", &camera_addr.sin_addr.s_addr); // Broadcast for discovery

    valve_addr.sin_family = AF_INET;
    valve_addr.sin_port = htons(VALVE_UDP_PORT);
    inet_pton(AF_INET, "255.255.255.255", &valve_addr.sin_addr.s_addr); // Broadcast for discovery

    // Bind to local port
    struct sockaddr_in local_addr;
    local_addr.sin_family = AF_INET;
    local_addr.sin_port = htons(MASTER_UDP_PORT);
    local_addr.sin_addr.s_addr = INADDR_ANY;
    
    int err = bind(udp_socket, (struct sockaddr*)&local_addr, sizeof(local_addr));
    if (err < 0) {
        ESP_LOGE(TAG, "Socket unable to bind: errno %d", errno);
        close(udp_socket);
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "Socket bound to port %d", MASTER_UDP_PORT);

    char rx_buffer[1024];
    struct sockaddr_in source_addr;
    socklen_t socklen = sizeof(source_addr);

    while (1) {
        // Receive messages from devices
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
                    (msg->header.target_id == MASTER_DEVICE_ID || msg->header.target_id == 0xFF)) {
                    
                    // Update device status
                    update_device_status(msg->header.device_id, msg);
                    
                    // Forward to command processor
                    xQueueSend(command_queue, msg, 0);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

static void backend_sync_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Backend sync task started");

    // Wait for WiFi connection
    xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT, false, true, portMAX_DELAY);

    char backend_command[512];

    while (1) {
        // Process backend commands
        if (xQueueReceive(backend_queue, backend_command, pdMS_TO_TICKS(100)) == pdTRUE) {
            process_backend_command(backend_command);
        }

        // Periodic sync with backend
        sync_with_backend();

        vTaskDelay(pdMS_TO_TICKS(5000)); // 5 second loop
    }
}

static void command_processor_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Command processor task started");
    iot_message_t message;

    while (1) {
        if (xQueueReceive(command_queue, &message, pdMS_TO_TICKS(100)) == pdTRUE) {
            ESP_LOGI(TAG, "Processing command: 0x%02X from device 0x%02X", 
                     message.header.command, message.header.device_id);

            switch (message.header.command) {
                case CMD_PING:
                    // Device heartbeat received
                    ESP_LOGI(TAG, "Heartbeat from device 0x%02X", message.header.device_id);
                    break;
                    
                case CMD_STATUS_REQUEST:
                    // Forward status request to appropriate device
                    send_command_to_device(message.header.device_id, CMD_STATUS_REQUEST, NULL, 0);
                    break;
                    
                // Camera commands
                case CMD_CAM_START_STREAM:
                case CMD_CAM_STOP_STREAM:
                case CMD_CAM_TAKE_PHOTO:
                case CMD_CAM_RECORD_START:
                case CMD_CAM_RECORD_STOP:
                    send_command_to_device(CAMERA_DEVICE_ID, message.header.command, 
                                         message.payload, message.header.payload_length);
                    break;
                    
                // Valve commands
                case CMD_VALVE_OPEN:
                case CMD_VALVE_CLOSE:
                case CMD_VALVE_TOGGLE:
                case CMD_VALVE_SET_POSITION:
                case CMD_VALVE_EMERGENCY_STOP:
                    send_command_to_device(VALVE_DEVICE_ID, message.header.command, 
                                         message.payload, message.header.payload_length);
                    break;
                    
                default:
                    ESP_LOGW(TAG, "Unknown command: 0x%02X", message.header.command);
                    break;
            }
            
            system_status.total_commands_sent++;
        }
    }
}

static esp_err_t send_command_to_device(uint8_t device_id, command_type_t cmd, uint8_t* payload, size_t payload_len)
{
    if (udp_socket < 0) {
        system_status.total_commands_failed++;
        return ESP_ERR_INVALID_STATE;
    }
    
    iot_message_t message;
    memset(&message, 0, sizeof(message));
    
    message.header.magic = PROTOCOL_MAGIC;
    message.header.version = PROTOCOL_VERSION;
    message.header.device_id = MASTER_DEVICE_ID;
    message.header.target_id = device_id;
    message.header.command = cmd;
    message.header.payload_length = payload_len;
    message.header.timestamp = esp_timer_get_time() / 1000;
    
    if (payload && payload_len > 0) {
        memcpy(message.payload, payload, MIN(payload_len, MAX_PAYLOAD_SIZE));
    }
    
    struct sockaddr_in* target_addr = NULL;
    if (device_id == CAMERA_DEVICE_ID) {
        target_addr = &camera_addr;
    } else if (device_id == VALVE_DEVICE_ID) {
        target_addr = &valve_addr;
    } else {
        ESP_LOGE(TAG, "Unknown device ID: 0x%02X", device_id);
        system_status.total_commands_failed++;
        return ESP_ERR_INVALID_ARG;
    }
    
    int err = sendto(udp_socket, &message, sizeof(message_header_t) + payload_len, 0,
                     (struct sockaddr*)target_addr, sizeof(*target_addr));
    
    if (err < 0) {
        ESP_LOGE(TAG, "Error occurred during sending: errno %d", errno);
        system_status.total_commands_failed++;
        return ESP_ERR_INVALID_STATE;
    }
    
    ESP_LOGI(TAG, "Command 0x%02X sent to device 0x%02X", cmd, device_id);
    return ESP_OK;
}

static esp_err_t sync_with_backend(void)
{
    // Create comprehensive system status JSON
    cJSON *json = cJSON_CreateObject();
    cJSON *master_obj = cJSON_CreateObject();
    cJSON *camera_obj = cJSON_CreateObject();
    cJSON *valve_obj = cJSON_CreateObject();
    cJSON *system_obj = cJSON_CreateObject();
    
    // Master coordinator info
    cJSON_AddNumberToObject(master_obj, "device_id", master_info.device_id);
    cJSON_AddStringToObject(master_obj, "device_name", master_info.device_name);
    cJSON_AddNumberToObject(master_obj, "status", master_info.status);
    cJSON_AddStringToObject(master_obj, "ip_address", master_info.ip_address);
    cJSON_AddNumberToObject(master_obj, "free_heap", esp_get_free_heap_size());
    cJSON_AddNumberToObject(master_obj, "uptime", esp_timer_get_time() / 1000000);
    
    // Camera info
    cJSON_AddNumberToObject(camera_obj, "device_id", camera_info.device_id);
    cJSON_AddStringToObject(camera_obj, "device_name", camera_info.device_name);
    cJSON_AddNumberToObject(camera_obj, "status", camera_info.status);
    cJSON_AddStringToObject(camera_obj, "ip_address", camera_info.ip_address);
    cJSON_AddNumberToObject(camera_obj, "last_heartbeat", camera_info.last_heartbeat);
    
    // Valve info
    cJSON_AddNumberToObject(valve_obj, "device_id", valve_info.device_id);
    cJSON_AddStringToObject(valve_obj, "device_name", valve_info.device_name);
    cJSON_AddNumberToObject(valve_obj, "status", valve_info.status);
    cJSON_AddStringToObject(valve_obj, "ip_address", valve_info.ip_address);
    cJSON_AddNumberToObject(valve_obj, "last_heartbeat", valve_info.last_heartbeat);
    
    // System status
    cJSON_AddNumberToObject(system_obj, "devices_online", system_status.devices_online);
    cJSON_AddNumberToObject(system_obj, "devices_total", system_status.devices_total);
    cJSON_AddNumberToObject(system_obj, "system_uptime", esp_timer_get_time() / 1000000);
    cJSON_AddNumberToObject(system_obj, "total_commands_sent", system_status.total_commands_sent);
    cJSON_AddNumberToObject(system_obj, "total_commands_failed", system_status.total_commands_failed);
    cJSON_AddBoolToObject(system_obj, "backend_connected", system_status.backend_connected);
    cJSON_AddNumberToObject(system_obj, "system_load", system_status.system_load);
    
    cJSON_AddItemToObject(json, "master", master_obj);
    cJSON_AddItemToObject(json, "camera", camera_obj);
    cJSON_AddItemToObject(json, "valve", valve_obj);
    cJSON_AddItemToObject(json, "system", system_obj);
    
    char *json_string = cJSON_Print(json);
    
    // TODO: Send to backend via HTTP POST
    ESP_LOGI(TAG, "System Status: %s", json_string);
    
    system_status.last_backend_sync = esp_timer_get_time() / 1000;
    system_status.backend_connected = true; // TODO: Set based on actual HTTP response
    
    free(json_string);
    cJSON_Delete(json);
    
    return ESP_OK;
}

static esp_err_t process_backend_command(const char* command_json)
{
    cJSON *json = cJSON_Parse(command_json);
    if (json == NULL) {
        ESP_LOGE(TAG, "Invalid JSON command");
        return ESP_ERR_INVALID_ARG;
    }
    
    cJSON *device_id = cJSON_GetObjectItem(json, "device_id");
    cJSON *command = cJSON_GetObjectItem(json, "command");
    cJSON *payload = cJSON_GetObjectItem(json, "payload");
    
    if (device_id && command) {
        uint8_t dev_id = device_id->valueint;
        command_type_t cmd = command->valueint;
        
        uint8_t *payload_data = NULL;
        size_t payload_len = 0;
        
        if (payload && cJSON_IsString(payload)) {
            payload_data = (uint8_t*)payload->valuestring;
            payload_len = strlen(payload->valuestring);
        }
        
        send_command_to_device(dev_id, cmd, payload_data, payload_len);
    }
    
    cJSON_Delete(json);
    return ESP_OK;
}

static esp_err_t update_device_status(uint8_t device_id, const iot_message_t* message)
{
    device_info_t* device_info_ptr = NULL;
    
    switch (device_id) {
        case CAMERA_DEVICE_ID:
            device_info_ptr = &camera_info;
            break;
        case VALVE_DEVICE_ID:
            device_info_ptr = &valve_info;
            break;
        default:
            return ESP_ERR_INVALID_ARG;
    }
    
    if (device_info_ptr) {
        device_info_ptr->status = DEVICE_STATUS_ONLINE;
        device_info_ptr->last_heartbeat = esp_timer_get_time() / 1000;
        // TODO: Extract more info from message payload
    }
    
    // Update system online count
    system_status.devices_online = 0;
    uint32_t current_time = esp_timer_get_time() / 1000;
    
    if (current_time - camera_info.last_heartbeat < 60000) { // 60 seconds timeout
        system_status.devices_online++;
    } else {
        camera_info.status = DEVICE_STATUS_OFFLINE;
    }
    
    if (current_time - valve_info.last_heartbeat < 60000) {
        system_status.devices_online++;
    } else {
        valve_info.status = DEVICE_STATUS_OFFLINE;
    }
    
    return ESP_OK;
}

static void play_alert_tone(int duration_ms)
{
    gpio_set_level(MASTER_BUZZER_PIN, 1);
    xTimerChangePeriod(buzzer_timer, pdMS_TO_TICKS(duration_ms), 0);
    xTimerStart(buzzer_timer, 0);
}

static void buzzer_timer_callback(TimerHandle_t timer)
{
    gpio_set_level(MASTER_BUZZER_PIN, 0);
}

static void update_status_leds(void)
{
    // Status LED: System status
    if (system_status.devices_online == system_status.devices_total - 1) { // Exclude master from count
        gpio_set_level(MASTER_STATUS_LED_PIN, 1); // All devices online
    } else {
        // Blink based on online devices
        gpio_set_level(MASTER_STATUS_LED_PIN, (esp_timer_get_time() / 500000) % 2);
    }
    
    // Error LED: System errors
    if (system_status.total_commands_failed > 0 || system_status.devices_online == 0) {
        gpio_set_level(MASTER_ERROR_LED_PIN, (esp_timer_get_time() / 200000) % 2); // Fast blink
    } else {
        gpio_set_level(MASTER_ERROR_LED_PIN, 0);
    }
}

static void heartbeat_callback(void* arg)
{
    // Update master device status
    master_info.status = DEVICE_STATUS_ONLINE;
    master_info.last_heartbeat = esp_timer_get_time() / 1000;
    master_info.free_heap = esp_get_free_heap_size();
    master_info.uptime_hours = (esp_timer_get_time() / 1000000) / 3600.0;
    
    // Send ping to all devices for discovery/keepalive
    send_command_to_device(0xFF, CMD_PING, NULL, 0); // Broadcast ping
    
    ESP_LOGI(TAG, "Heartbeat - Devices online: %d/%d, System load: %d%%", 
             system_status.devices_online, system_status.devices_total - 1, system_status.system_load);
}

static void device_monitor_callback(void* arg)
{
    // Check device timeouts and update status
    uint32_t current_time = esp_timer_get_time() / 1000;
    
    // Check camera timeout
    if (current_time - camera_info.last_heartbeat > 60000 && camera_info.status == DEVICE_STATUS_ONLINE) {
        ESP_LOGW(TAG, "Camera device timeout");
        camera_info.status = DEVICE_STATUS_OFFLINE;
        play_alert_tone(100);
    }
    
    // Check valve timeout
    if (current_time - valve_info.last_heartbeat > 60000 && valve_info.status == DEVICE_STATUS_ONLINE) {
        ESP_LOGW(TAG, "Valve device timeout");
        valve_info.status = DEVICE_STATUS_OFFLINE;
        play_alert_tone(100);
    }
}

static void backend_sync_callback(void* arg)
{
    // Trigger backend sync
    sync_with_backend();
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
        sprintf(master_info.ip_address, IPSTR, IP2STR(&event->ip_info.ip));
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
