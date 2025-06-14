/*
 * ESP32-S3 OV5640 Camera Video Streaming - ESP-IDF VERSION
 * MAXIMUM QUALITY OPTIMIZATION FOR IMAGE RECOGNITION
 * 720p resolution at up to 30 FPS with dual-core processing
 */

#include <stdio.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_camera.h"
#include "esp_http_client.h"
#include "esp_heap_caps.h"
#include "esp_pm.h"
#include "esp_psram.h"
#include "nvs_flash.h"
#include "cjson/cJSON.h"  // Updated include path for ESP-IDF v5.3+

static const char *TAG = "HD_CAMERA";

// ===========================
// Configuration Section
// ===========================
#define WIFI_SSID "SSID"
#define WIFI_PASS "PASSWD"
#define SERVER_URL "http://203.175.11.145:9003/api/v1/stream/stream"
#define REGISTER_URL "http://203.175.11.145:9003/api/v1/devices/register"
#define HEARTBEAT_URL "http://203.175.11.145:9003/api/v1/devices/heartbeat"
#define API_KEY "dev-api-key-change-in-production"
#define DEVICE_ID "ESP32-CAM-001-IDF"
#define DEVICE_NAME "Camera #1 - IDF HD Optimized"

// ===========================
// ESP32-S3 Camera Pin Configuration
// ===========================
#define CAM_PIN_PWDN    -1
#define CAM_PIN_RESET   -1
#define CAM_PIN_XCLK    15
#define CAM_PIN_SIOD    4
#define CAM_PIN_SIOC    5
#define CAM_PIN_Y9      16
#define CAM_PIN_Y8      17
#define CAM_PIN_Y7      18
#define CAM_PIN_Y6      12
#define CAM_PIN_Y5      10
#define CAM_PIN_Y4      8
#define CAM_PIN_Y3      9
#define CAM_PIN_Y2      11
#define CAM_PIN_VSYNC   6
#define CAM_PIN_HREF    7
#define CAM_PIN_PCLK    13

// ===========================
// Performance Configuration
// ===========================
#define TARGET_FPS             30
#define FRAME_INTERVAL_MS      (1000 / TARGET_FPS)
#define XCLK_FREQ_HZ           24000000
#define JPEG_QUALITY           4
#define FRAME_QUEUE_SIZE       4
#define CAMERA_TASK_STACK      10240
#define NETWORK_TASK_STACK     10240
#define CAMERA_TASK_PRIORITY   5
#define NETWORK_TASK_PRIORITY  4

// WiFi Event Group Bits
static EventGroupHandle_t s_wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define WIFI_MAX_RETRY     10

// Frame data structure for the queue
typedef struct {
    uint8_t *buffer;
    size_t length;
} frame_data_t;

// Global variables
static QueueHandle_t frame_queue = NULL;
static bool device_registered = false;
static uint32_t frame_count = 0;
static uint32_t network_errors = 0;
static uint32_t capture_fails = 0;
static int s_retry_num = 0;

static esp_err_t http_event_handler(esp_http_client_event_t *evt) {
    return ESP_OK;
}

static void wifi_event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < WIFI_MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "retrying to connect to the AP");
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

void wifi_init(void) {
    s_wifi_event_group = xEventGroupCreate();
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wifi_config = {
        .sta = { .ssid = WIFI_SSID, .password = WIFI_PASS },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    ESP_ERROR_CHECK(esp_wifi_set_max_tx_power(78));

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);
    if (!(bits & WIFI_CONNECTED_BIT)) {
        ESP_LOGE(TAG, "Failed to connect to WiFi!");
        return;
    }
}

esp_err_t camera_init() {
    camera_config_t config = {
        .pin_pwdn = CAM_PIN_PWDN, .pin_reset = CAM_PIN_RESET, .pin_xclk = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD, .pin_sccb_scl = CAM_PIN_SIOC,
        .pin_d7 = CAM_PIN_Y9, .pin_d6 = CAM_PIN_Y8, .pin_d5 = CAM_PIN_Y7, .pin_d4 = CAM_PIN_Y6,
        .pin_d3 = CAM_PIN_Y5, .pin_d2 = CAM_PIN_Y4, .pin_d1 = CAM_PIN_Y3, .pin_d0 = CAM_PIN_Y2,
        .pin_vsync = CAM_PIN_VSYNC, .pin_href = CAM_PIN_HREF, .pin_pclk = CAM_PIN_PCLK,
        .xclk_freq_hz = XCLK_FREQ_HZ, .ledc_timer = LEDC_TIMER_0, .ledc_channel = LEDC_CHANNEL_0,
        .pixel_format = PIXFORMAT_JPEG, .frame_size = FRAMESIZE_HD, .jpeg_quality = JPEG_QUALITY,
        .fb_count = 3, .fb_location = CAMERA_FB_IN_PSRAM, .grab_mode = CAMERA_GRAB_LATEST,
    };

    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed with error 0x%x", err);
        return err;
    }

    sensor_t *s = esp_camera_sensor_get();
    s->set_framesize(s, FRAMESIZE_HD);
    s->set_brightness(s, 1); s->set_contrast(s, 1); s->set_saturation(s, 0);
    s->set_whitebal(s, 1); s->set_awb_gain(s, 1); s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1); s->set_gain_ctrl(s, 1); s->set_agc_gain(s, 0);
    s->set_gainceiling(s, (gainceiling_t)6); s->set_bpc(s, 1); s->set_wpc(s, 1);
    s->set_raw_gma(s, 1); s->set_lenc(s, 1);
    
    ESP_LOGI(TAG, "Camera initialized and sensor optimized for quality.");
    return ESP_OK;
}

void camera_task(void *pvParameters) {
    while (1) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            capture_fails++;
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        uint8_t *frame_buffer = heap_caps_malloc(fb->len, MALLOC_CAP_SPIRAM);
        if (!frame_buffer) {
            ESP_LOGE(TAG, "PSRAM malloc failed");
            esp_camera_fb_return(fb);
            capture_fails++;
            continue;
        }
        memcpy(frame_buffer, fb->buf, fb->len);
        size_t frame_len = fb->len;  // Store length before returning fb
        esp_camera_fb_return(fb);

        frame_data_t frame = { .buffer = frame_buffer, .length = frame_len };
        if (xQueueSend(frame_queue, &frame, 0) != pdTRUE) {
            heap_caps_free(frame_buffer); // Free if queue is full
        }
        vTaskDelay(pdMS_TO_TICKS(FRAME_INTERVAL_MS));
    }
}

void network_task(void *pvParameters) {
    frame_data_t frame;
    while (1) {
        if (xQueueReceive(frame_queue, &frame, portMAX_DELAY) == pdTRUE) {
            char boundary[64];
            snprintf(boundary, sizeof(boundary), "----ESP32CAMBoundary%lld", esp_timer_get_time());
            
            char content_type[100];
            snprintf(content_type, sizeof(content_type), "multipart/form-data; boundary=%s", boundary);

            esp_http_client_config_t config = { .url = SERVER_URL, .event_handler = http_event_handler, .timeout_ms = 15000 };
            esp_http_client_handle_t client = esp_http_client_init(&config);
            
            esp_http_client_set_header(client, "X-API-Key", API_KEY);
            esp_http_client_set_header(client, "Content-Type", content_type);

            char header[256];
            int header_len = snprintf(header, sizeof(header), "--%s\r\nContent-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n", boundary);
            
            char footer[128];
            int footer_len = snprintf(footer, sizeof(footer), "\r\n--%s--\r\n", boundary);

            size_t total_len = header_len + frame.length + footer_len;
            esp_http_client_set_post_field(client, NULL, total_len);

            esp_http_client_write(client, header, header_len);
            esp_http_client_write(client, (const char *)frame.buffer, frame.length);
            esp_http_client_write(client, footer, footer_len);
            
            esp_err_t err = esp_http_client_perform(client);
            if (err == ESP_OK && esp_http_client_get_status_code(client) == 200) {
                frame_count++;
            } else {
                network_errors++;
            }
            
            esp_http_client_cleanup(client);
            heap_caps_free(frame.buffer);
        }
    }
}

void send_generic_post(const char* url, const char* payload) {
    esp_http_client_config_t config = { .url = url, .event_handler = http_event_handler };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_http_client_set_method(client, HTTP_METHOD_POST);
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-API-Key", API_KEY);
    esp_http_client_set_post_field(client, payload, strlen(payload));
    esp_err_t err = esp_http_client_perform(client);
    if (err == ESP_OK && esp_http_client_get_status_code(client) == 200) {
        if (strcmp(url, REGISTER_URL) == 0) device_registered = true;
    }
    esp_http_client_cleanup(client);
}

void utility_task(void *pvParameters) {
    // Register device once at the beginning
    cJSON *reg_root = cJSON_CreateObject();
    cJSON_AddStringToObject(reg_root, "deviceId", DEVICE_ID);
    cJSON_AddStringToObject(reg_root, "deviceName", DEVICE_NAME);
    cJSON_AddStringToObject(reg_root, "deviceType", "camera");
    cJSON_AddStringToObject(reg_root, "capabilities", "[\"720p\", \"high_quality\"]");
    char* reg_payload = cJSON_PrintUnformatted(reg_root);
    send_generic_post(REGISTER_URL, reg_payload);
    cJSON_Delete(reg_root);
    free(reg_payload);

    while(1) {
        vTaskDelay(pdMS_TO_TICKS(30000)); // Run every 30 seconds
        
        // Heartbeat
        cJSON *hb_root = cJSON_CreateObject();
        cJSON_AddStringToObject(hb_root, "deviceId", DEVICE_ID);
        cJSON_AddNumberToObject(hb_root, "uptime", esp_timer_get_time() / 1000000);
        cJSON_AddNumberToObject(hb_root, "freeHeap", esp_get_free_heap_size());
        cJSON_AddNumberToObject(hb_root, "freePsram", heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
        cJSON_AddNumberToObject(hb_root, "framesSent", frame_count);
        cJSON_AddNumberToObject(hb_root, "captureFails", capture_fails);
        cJSON_AddNumberToObject(hb_root, "networkErrors", network_errors);
        cJSON_AddStringToObject(hb_root, "status", "streaming_hd");
        char* hb_payload = cJSON_PrintUnformatted(hb_root);
        send_generic_post(HEARTBEAT_URL, hb_payload);
        cJSON_Delete(hb_root);
        free(hb_payload);

        // Stats
        ESP_LOGI(TAG, "STATS | Sent: %lu, Capture Fails: %lu, Net Fails: %lu | Heap: %d, PSRAM: %d",
            frame_count, capture_fails, network_errors, esp_get_free_heap_size(), heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    }
}

void app_main(void) {
    // Set CPU to max performance
    esp_pm_config_esp32s3_t pm_config = { .max_freq_mhz = 240, .min_freq_mhz = 240, .light_sleep_enable = false };
    ESP_ERROR_CHECK(esp_pm_configure(&pm_config));

    ESP_ERROR_CHECK(nvs_flash_init());
    wifi_init();
    ESP_ERROR_CHECK(camera_init());

    frame_queue = xQueueCreate(FRAME_QUEUE_SIZE, sizeof(frame_data_t));

    xTaskCreatePinnedToCore(camera_task, "CameraTask", CAMERA_TASK_STACK, NULL, CAMERA_TASK_PRIORITY, NULL, 1);
    xTaskCreatePinnedToCore(network_task, "NetworkTask", NETWORK_TASK_STACK, NULL, NETWORK_TASK_PRIORITY, NULL, 0);
    xTaskCreate(utility_task, "UtilityTask", 4096, NULL, 3, NULL);

    ESP_LOGI(TAG, "System initialized. HD streaming started.");
}