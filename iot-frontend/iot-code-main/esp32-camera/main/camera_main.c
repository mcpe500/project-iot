/*
 * ESP32-S3 Camera Main Application
 * 
 * High-performance camera streaming firmware optimized for ESP32-S3
 * dual-core architecture with advanced features for IoT video streaming.
 * 
 * Hardware:
 * - ESP32-S3 DevKit
 * - OV5640 Camera Module
 * - PSRAM (8MB recommended)
 * - Status LEDs
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
#include "lwip/err.h"
#include "lwip/sys.h"
#include "lwip/sockets.h"
#include "esp_camera.h"
#include "cJSON.h"

#include "iot_system_config.h"

static const char *TAG = "CAMERA_STREAM";

// WiFi connection bits
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
static EventGroupHandle_t s_wifi_event_group;
static int s_retry_num = 0;

// Device status and configuration
static device_info_t device_info;
static camera_config_t cam_config;
static camera_status_t cam_status;
static QueueHandle_t command_queue;
static QueueHandle_t frame_queue;

// Communication
static int udp_socket = -1;
static struct sockaddr_in master_addr;

// Timers
static esp_timer_handle_t heartbeat_timer;
static esp_timer_handle_t fps_monitor_timer;

// Camera configuration
static camera_config_t camera_config = {
    .pin_pwdn  = CAM_PIN_PWDN,
    .pin_reset = CAM_PIN_RESET,
    .pin_xclk = CAM_PIN_XCLK,
    .pin_sscb_sda = CAM_PIN_SIOD,
    .pin_sscb_scl = CAM_PIN_SIOC,

    .pin_d7 = CAM_PIN_D7,
    .pin_d6 = CAM_PIN_D6,
    .pin_d5 = CAM_PIN_D5,
    .pin_d4 = CAM_PIN_D4,
    .pin_d3 = CAM_PIN_D3,
    .pin_d2 = CAM_PIN_D2,
    .pin_d1 = CAM_PIN_D1,
    .pin_d0 = CAM_PIN_D0,
    .pin_vsync = CAM_PIN_VSYNC,
    .pin_href = CAM_PIN_HREF,
    .pin_pclk = CAM_PIN_PCLK,

    .xclk_freq_hz = 20000000,
    .ledc_timer = LEDC_TIMER_0,
    .ledc_channel = LEDC_CHANNEL_0,

    .pixel_format = PIXFORMAT_JPEG,
    .frame_size = FRAMESIZE_VGA,
    .jpeg_quality = 12,
    .fb_count = 3,
    .fb_location = CAMERA_FB_IN_PSRAM,
    .grab_mode = CAMERA_GRAB_WHEN_EMPTY,
};

// Function prototypes
static void wifi_init_sta(void);
static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data);
static esp_err_t init_camera(void);
static void camera_task(void* pvParameters);
static void streaming_task(void* pvParameters);
static void communication_task(void* pvParameters);
static void heartbeat_callback(void* arg);
static void fps_monitor_callback(void* arg);
static esp_err_t send_frame_to_backend(camera_fb_t* fb);
static esp_err_t send_status_to_backend(void);
static esp_err_t send_message_to_master(command_type_t cmd, uint8_t* payload, size_t payload_len);
static esp_err_t process_command(iot_message_t* message);
static esp_err_t start_streaming(void);
static esp_err_t stop_streaming(void);
static esp_err_t take_photo(void);
static esp_err_t start_recording(void);
static esp_err_t stop_recording(void);

void app_main(void)
{
    ESP_LOGI(TAG, "ESP32-S3 Camera starting...");
    ESP_LOGI(TAG, "Version: %s", SYSTEM_VERSION);
    ESP_LOGI(TAG, "Device ID: 0x%02X", CAMERA_DEVICE_ID);

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize device information
    memset(&device_info, 0, sizeof(device_info));
    device_info.device_id = CAMERA_DEVICE_ID;
    device_info.type = DEVICE_TYPE_CAMERA;
    device_info.status = DEVICE_STATUS_OFFLINE;
    strcpy(device_info.device_name, CAMERA_DEVICE_NAME);

    // Initialize camera configuration with defaults
    cam_config.fps = 10;
    cam_config.quality = 12;
    cam_config.frame_size = FRAMESIZE_VGA;
    cam_config.auto_exposure = true;
    cam_config.auto_white_balance = true;
    cam_config.brightness = 0;
    cam_config.contrast = 0;
    cam_config.saturation = 0;

    // Initialize camera status
    memset(&cam_status, 0, sizeof(cam_status));
    cam_status.streaming = false;
    cam_status.recording = false;

    // Initialize camera
    ESP_ERROR_CHECK(init_camera());

    // Initialize WiFi
    wifi_init_sta();

    // Create queues
    command_queue = xQueueCreate(10, sizeof(iot_message_t));
    frame_queue = xQueueCreate(5, sizeof(camera_fb_t*));
    if (command_queue == NULL || frame_queue == NULL) {
        ESP_LOGE(TAG, "Failed to create queues");
        return;
    }

    // Create timers
    const esp_timer_create_args_t heartbeat_timer_args = {
        .callback = &heartbeat_callback,
        .name = "heartbeat"
    };
    ESP_ERROR_CHECK(esp_timer_create(&heartbeat_timer_args, &heartbeat_timer));

    const esp_timer_create_args_t fps_timer_args = {
        .callback = &fps_monitor_callback,
        .name = "fps_monitor"
    };
    ESP_ERROR_CHECK(esp_timer_create(&fps_timer_args, &fps_monitor_timer));

    // Create tasks - optimized for dual-core ESP32-S3
    xTaskCreatePinnedToCore(camera_task, "camera_capture", 8192, NULL, 6, NULL, 1);      // Core 1: Camera
    xTaskCreatePinnedToCore(streaming_task, "frame_streaming", 8192, NULL, 5, NULL, 1);   // Core 1: Streaming
    xTaskCreatePinnedToCore(communication_task, "communication", 6144, NULL, 4, NULL, 0); // Core 0: Network

    // Start timers
    ESP_ERROR_CHECK(esp_timer_start_periodic(heartbeat_timer, DEVICE_HEARTBEAT_INTERVAL * 1000));
    ESP_ERROR_CHECK(esp_timer_start_periodic(fps_timer, 1000 * 1000)); // 1 second

    ESP_LOGI(TAG, "ESP32-S3 Camera initialized successfully");
}

static esp_err_t init_camera(void)
{
    ESP_LOGI(TAG, "Initializing camera...");

    // Initialize the camera
    esp_err_t err = esp_camera_init(&camera_config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed with error 0x%x", err);
        return err;
    }

    // Get camera sensor
    sensor_t *s = esp_camera_sensor_get();
    if (s == NULL) {
        ESP_LOGE(TAG, "Failed to get camera sensor");
        return ESP_FAIL;
    }

    // Configure sensor settings
    s->set_brightness(s, cam_config.brightness);
    s->set_contrast(s, cam_config.contrast);
    s->set_saturation(s, cam_config.saturation);
    s->set_aec2(s, cam_config.auto_exposure);
    s->set_awb_gain(s, cam_config.auto_white_balance);
    s->set_quality(s, cam_config.quality);

    ESP_LOGI(TAG, "Camera initialized successfully");
    return ESP_OK;
}

static void camera_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Camera capture task started on core %d", xPortGetCoreID());
    
    TickType_t xLastWakeTime = xTaskGetTickCount();
    const TickType_t xFrequency = pdMS_TO_TICKS(1000 / cam_config.fps); // Target FPS
    
    while (1) {
        // Process commands
        iot_message_t message;
        if (xQueueReceive(command_queue, &message, 0) == pdTRUE) {
            process_command(&message);
        }

        // Capture frame if streaming
        if (cam_status.streaming) {
            camera_fb_t* fb = esp_camera_fb_get();
            if (fb) {
                cam_status.frames_captured++;
                
                // Send frame to streaming task
                if (xQueueSend(frame_queue, &fb, 0) != pdTRUE) {
                    // Queue full, drop frame
                    esp_camera_fb_return(fb);
                    cam_status.frames_failed++;
                    ESP_LOGW(TAG, "Frame queue full, dropping frame");
                } else {
                    cam_status.frames_sent++;
                }
            } else {
                cam_status.frames_failed++;
                ESP_LOGW(TAG, "Failed to capture frame");
            }
        }

        vTaskDelayUntil(&xLastWakeTime, xFrequency);
    }
}

static void streaming_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Frame streaming task started on core %d", xPortGetCoreID());
    
    camera_fb_t* fb;
    
    while (1) {
        if (xQueueReceive(frame_queue, &fb, pdMS_TO_TICKS(1000)) == pdTRUE) {
            // Send frame to backend
            esp_err_t err = send_frame_to_backend(fb);
            if (err != ESP_OK) {
                cam_status.frames_failed++;
                ESP_LOGW(TAG, "Failed to send frame to backend: %s", esp_err_to_name(err));
            }
            
            // Return frame buffer
            esp_camera_fb_return(fb);
            cam_status.total_data_sent += fb->len;
        }
    }
}

static void communication_task(void* pvParameters)
{
    ESP_LOGI(TAG, "Communication task started on core %d", xPortGetCoreID());

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
    local_addr.sin_port = htons(CAMERA_UDP_PORT);
    local_addr.sin_addr.s_addr = INADDR_ANY;
    
    int err = bind(udp_socket, (struct sockaddr*)&local_addr, sizeof(local_addr));
    if (err < 0) {
        ESP_LOGE(TAG, "Socket unable to bind: errno %d", errno);
        close(udp_socket);
        vTaskDelete(NULL);
        return;
    }

    ESP_LOGI(TAG, "Socket bound to port %d", CAMERA_UDP_PORT);

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
                    (msg->header.target_id == CAMERA_DEVICE_ID || msg->header.target_id == 0xFF)) {
                    xQueueSend(command_queue, msg, 0);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
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
            
        case CMD_CAM_START_STREAM:
            start_streaming();
            break;
            
        case CMD_CAM_STOP_STREAM:
            stop_streaming();
            break;
            
        case CMD_CAM_TAKE_PHOTO:
            take_photo();
            break;
            
        case CMD_CAM_RECORD_START:
            start_recording();
            break;
            
        case CMD_CAM_RECORD_STOP:
            stop_recording();
            break;
            
        case CMD_CAM_ADJUST_QUALITY:
            if (message->header.payload_length >= 1) {
                cam_config.quality = CLAMP(message->payload[0], 1, 63);
                sensor_t *s = esp_camera_sensor_get();
                if (s) {
                    s->set_quality(s, cam_config.quality);
                }
                ESP_LOGI(TAG, "Quality adjusted to %d", cam_config.quality);
            }
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

static esp_err_t start_streaming(void)
{
    if (cam_status.streaming) {
        ESP_LOGW(TAG, "Streaming already active");
        return ESP_OK;
    }
    
    ESP_LOGI(TAG, "Starting video streaming...");
    cam_status.streaming = true;
    cam_status.frames_captured = 0;
    cam_status.frames_sent = 0;
    cam_status.frames_failed = 0;
    cam_status.total_data_sent = 0;
    
    return ESP_OK;
}

static esp_err_t stop_streaming(void)
{
    if (!cam_status.streaming) {
        ESP_LOGW(TAG, "Streaming not active");
        return ESP_OK;
    }
    
    ESP_LOGI(TAG, "Stopping video streaming...");
    cam_status.streaming = false;
    
    return ESP_OK;
}

static esp_err_t take_photo(void)
{
    ESP_LOGI(TAG, "Taking photo...");
    
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
        ESP_LOGE(TAG, "Failed to capture photo");
        return ESP_FAIL;
    }
    
    // Send photo to backend
    esp_err_t err = send_frame_to_backend(fb);
    esp_camera_fb_return(fb);
    
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Photo captured and sent successfully");
    } else {
        ESP_LOGE(TAG, "Failed to send photo");
    }
    
    return err;
}

static esp_err_t start_recording(void)
{
    ESP_LOGI(TAG, "Starting recording...");
    cam_status.recording = true;
    
    // Start streaming if not already active
    if (!cam_status.streaming) {
        start_streaming();
    }
    
    return ESP_OK;
}

static esp_err_t stop_recording(void)
{
    ESP_LOGI(TAG, "Stopping recording...");
    cam_status.recording = false;
    
    return ESP_OK;
}

static esp_err_t send_frame_to_backend(camera_fb_t* fb)
{
    if (!fb || fb->len == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    // Create HTTP client configuration
    esp_http_client_config_t config = {
        .url = "http://" BACKEND_SERVER_IP ":" STRINGIFY(BACKEND_SERVER_PORT) BACKEND_STREAM_ENDPOINT,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 5000,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        return ESP_ERR_NO_MEM;
    }

    // Set headers for multipart form data
    esp_http_client_set_header(client, "Content-Type", "multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW");
    
    // Create multipart body
    char boundary[] = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    char header_part[256];
    snprintf(header_part, sizeof(header_part),
        "--%s\r\n"
        "Content-Disposition: form-data; name=\"frame\"; filename=\"frame.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n",
        boundary);
    
    char footer_part[64];
    snprintf(footer_part, sizeof(footer_part), "\r\n--%s--\r\n", boundary);
    
    size_t total_len = strlen(header_part) + fb->len + strlen(footer_part);
    
    esp_http_client_set_header(client, "Content-Length", 
                               itoa(total_len, (char[12]){0}, 10));

    esp_err_t err = esp_http_client_open(client, total_len);
    if (err != ESP_OK) {
        esp_http_client_cleanup(client);
        return err;
    }

    // Send multipart data
    esp_http_client_write(client, header_part, strlen(header_part));
    esp_http_client_write(client, (char*)fb->buf, fb->len);
    esp_http_client_write(client, footer_part, strlen(footer_part));

    // Get response
    int content_length = esp_http_client_fetch_headers(client);
    int status_code = esp_http_client_get_status_code(client);
    
    esp_http_client_cleanup(client);
    
    if (status_code == 200) {
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "HTTP request failed with status %d", status_code);
        return ESP_ERR_INVALID_RESPONSE;
    }
}

static esp_err_t send_status_to_backend(void)
{
    // Create JSON status report
    cJSON *json = cJSON_CreateObject();
    cJSON *device = cJSON_CreateObject();
    cJSON *camera = cJSON_CreateObject();
    
    cJSON_AddNumberToObject(device, "device_id", device_info.device_id);
    cJSON_AddStringToObject(device, "device_name", device_info.device_name);
    cJSON_AddNumberToObject(device, "status", device_info.status);
    cJSON_AddNumberToObject(device, "free_heap", esp_get_free_heap_size());
    cJSON_AddNumberToObject(device, "uptime", esp_timer_get_time() / 1000000);
    
    cJSON_AddBoolToObject(camera, "streaming", cam_status.streaming);
    cJSON_AddBoolToObject(camera, "recording", cam_status.recording);
    cJSON_AddNumberToObject(camera, "frames_captured", cam_status.frames_captured);
    cJSON_AddNumberToObject(camera, "frames_sent", cam_status.frames_sent);
    cJSON_AddNumberToObject(camera, "frames_failed", cam_status.frames_failed);
    cJSON_AddNumberToObject(camera, "current_fps", cam_status.current_fps);
    cJSON_AddNumberToObject(camera, "total_data_sent", cam_status.total_data_sent);
    cJSON_AddNumberToObject(camera, "quality", cam_config.quality);
    
    cJSON_AddItemToObject(json, "device", device);
    cJSON_AddItemToObject(json, "camera", camera);
    
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
    message.header.device_id = CAMERA_DEVICE_ID;
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
    
    ESP_LOGI(TAG, "Heartbeat sent - Streaming: %s, FPS: %.1f", 
             cam_status.streaming ? "ON" : "OFF", cam_status.current_fps);
}

static void fps_monitor_callback(void* arg)
{
    static uint32_t last_frames = 0;
    uint32_t current_frames = cam_status.frames_sent;
    cam_status.current_fps = current_frames - last_frames;
    last_frames = current_frames;
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
