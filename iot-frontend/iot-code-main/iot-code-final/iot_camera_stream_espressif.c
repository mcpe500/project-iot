/*
 * ESP32-S3 OV5640 Camera Video Streaming to Backend - ESP-IDF Version
 * Optimized for dual-core performance with FreeRTOS tasks
 * Captures frames at 10+ FPS and sends them via HTTP POST to backend server
 * 
 * Core 0 (PRO_CPU): Camera capture and image processing
 * Core 1 (APP_CPU): WiFi communication and HTTP transmission
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_camera.h"
#include "lwip/err.h"
#include "lwip/sys.h"

// ===========================
// Configuration Section
// ===========================
#define WIFI_SSID           "YOUR_WIFI_SSID"
#define WIFI_PASS           "YOUR_WIFI_PASSWORD"
#define SERVER_URL          "http://YOUR_BACKEND_IP:PORT/api/v1/stream/stream"
#define MAX_RETRY           10

// Performance Configuration
#define FRAME_QUEUE_SIZE    5
#define CAPTURE_TASK_STACK  8192
#define NETWORK_TASK_STACK  8192
#define FRAME_BUFFER_SIZE   (200 * 1024)  // 200KB for JPEG frames
#define TARGET_FPS          10
#define FRAME_INTERVAL_MS   (1000 / TARGET_FPS)

// Task Priorities (Higher number = Higher priority)
#define CAPTURE_TASK_PRIORITY   (tskIDLE_PRIORITY + 3)
#define NETWORK_TASK_PRIORITY   (tskIDLE_PRIORITY + 2)
#define MONITOR_TASK_PRIORITY   (tskIDLE_PRIORITY + 1)

// ===========================
// ESP32-S3 Camera Pin Configuration for OV5640
// ===========================
#define CAM_PIN_PWDN        -1
#define CAM_PIN_RESET       -1
#define CAM_PIN_XCLK        15
#define CAM_PIN_SIOD        4
#define CAM_PIN_SIOC        5
#define CAM_PIN_D7          16
#define CAM_PIN_D6          17
#define CAM_PIN_D5          18
#define CAM_PIN_D4          12
#define CAM_PIN_D3          10
#define CAM_PIN_D2          8
#define CAM_PIN_D1          9
#define CAM_PIN_D0          11
#define CAM_PIN_VSYNC       6
#define CAM_PIN_HREF        7
#define CAM_PIN_PCLK        13

// ===========================
// Global Variables and Structures
// ===========================
static const char *TAG = "ESP32S3_CAM_STREAM";

typedef struct {
    uint8_t *buffer;
    size_t length;
    int64_t timestamp;
} frame_data_t;

typedef struct {
    uint32_t frames_captured;
    uint32_t frames_sent;
    uint32_t frames_dropped;
    uint32_t network_errors;
    uint32_t capture_errors;
    int64_t avg_capture_time;
    int64_t avg_send_time;
} performance_stats_t;

// FreeRTOS Objects
static QueueHandle_t frame_queue = NULL;
static SemaphoreHandle_t stats_mutex = NULL;
static EventGroupHandle_t wifi_event_group = NULL;
static TaskHandle_t capture_task_handle = NULL;
static TaskHandle_t network_task_handle = NULL;
static TaskHandle_t monitor_task_handle = NULL;

// Global Statistics
static performance_stats_t stats = {0};

// WiFi Event Bits
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

// ===========================
// Function Declarations
// ===========================
static void wifi_init_sta(void);
static void event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data);
static esp_err_t camera_init(void);
static void camera_capture_task(void *pvParameters);
static void network_send_task(void *pvParameters);
static void performance_monitor_task(void *pvParameters);
static esp_err_t http_send_frame(frame_data_t *frame);
static void update_stats(const char* operation, int64_t duration, bool success);

// ===========================
// WiFi Event Handler
// ===========================
static void event_handler(void* arg, esp_event_base_t event_base, int32_t event_id, void* event_data)
{
    static int s_retry_num = 0;
    
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < MAX_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "Retry to connect to the AP");
        } else {
            xEventGroupSetBits(wifi_event_group, WIFI_FAIL_BIT);
        }
        ESP_LOGI(TAG,"Connect to the AP fail");
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "Got IP:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

// ===========================
// WiFi Initialization
// ===========================
static void wifi_init_sta(void)
{
    wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    // Optimize WiFi for high throughput
    cfg.ampdu_rx_enable = true;
    cfg.ampdu_tx_enable = true;
    cfg.amsdu_tx_enable = true;
    cfg.nvs_enable = false;  // Disable NVS for better performance
    
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
            .pmf_cfg = {
                .capable = true,
                .required = false
            },
        },
    };
    
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    
    // Optimize WiFi performance
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));  // Disable power saving
    ESP_ERROR_CHECK(esp_wifi_set_bandwidth(WIFI_IF_STA, WIFI_BW_HT40));  // Use 40MHz bandwidth
    
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi initialization finished.");

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to AP SSID:%s", WIFI_SSID);
    } else if (bits & WIFI_FAIL_BIT) {
        ESP_LOGI(TAG, "Failed to connect to SSID:%s", WIFI_SSID);
        esp_restart();
    } else {
        ESP_LOGE(TAG, "UNEXPECTED EVENT");
        esp_restart();
    }
}

// ===========================
// Camera Initialization - Optimized for ESP32-S3
// ===========================
static esp_err_t camera_init(void)
{
    ESP_LOGI(TAG, "Initializing OV5640 camera for ESP32-S3...");
    
    camera_config_t config = {
        .pin_pwdn = CAM_PIN_PWDN,
        .pin_reset = CAM_PIN_RESET,
        .pin_xclk = CAM_PIN_XCLK,
        .pin_sccb_sda = CAM_PIN_SIOD,
        .pin_sccb_scl = CAM_PIN_SIOC,
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

        // High performance configuration for ESP32-S3
        .xclk_freq_hz = 24000000,  // Increased clock frequency
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,

        .pixel_format = PIXFORMAT_JPEG,
        .frame_size = FRAMESIZE_VGA,  // 640x480 for optimal balance
        .jpeg_quality = 8,  // Higher quality (lower number = better quality)
        .fb_count = 3,      // Triple buffering for smooth capture
        .grab_mode = CAMERA_GRAB_LATEST,  // Always get latest frame
    };

    // Optimize for PSRAM usage on ESP32-S3
    if (esp_psram_is_initialized()) {
        ESP_LOGI(TAG, "PSRAM detected, using PSRAM for frame buffers");
        config.fb_location = CAMERA_FB_IN_PSRAM;
        config.jpeg_quality = 6;  // Even better quality with PSRAM
        config.fb_count = 4;      // Quad buffering with PSRAM
    } else {
        ESP_LOGW(TAG, "PSRAM not detected, using internal DRAM");
        config.fb_location = CAMERA_FB_IN_DRAM;
        config.jpeg_quality = 10;
        config.fb_count = 2;
    }

    // Initialize camera
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera Init Failed: %s", esp_err_to_name(err));
        return err;
    }

    // Optimize sensor settings for OV5640
    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
        // Set frame size
        s->set_framesize(s, FRAMESIZE_VGA);
        
        // Optimize for streaming performance
        s->set_brightness(s, 0);     // -2 to 2
        s->set_contrast(s, 1);       // -2 to 2 (slightly increased)
        s->set_saturation(s, 0);     // -2 to 2
        s->set_special_effect(s, 0); // 0 - No Effect
        s->set_whitebal(s, 1);       // Enable white balance
        s->set_awb_gain(s, 1);       // Enable AWB gain
        s->set_wb_mode(s, 0);        // Auto white balance mode
        s->set_exposure_ctrl(s, 1);  // Enable exposure control
        s->set_aec2(s, 0);           // Disable AEC2
        s->set_ae_level(s, 0);       // Auto exposure level
        s->set_aec_value(s, 250);    // Lower AEC value for faster response
        s->set_gain_ctrl(s, 1);      // Enable gain control
        s->set_agc_gain(s, 0);       // Auto gain
        s->set_gainceiling(s, (gainceiling_t)2);  // Gain ceiling
        s->set_bpc(s, 1);            // Enable black pixel correct
        s->set_wpc(s, 1);            // Enable white pixel correct
        s->set_raw_gma(s, 1);        // Enable gamma
        s->set_lenc(s, 1);           // Enable lens correction
        s->set_hmirror(s, 0);        // Disable horizontal mirror
        s->set_vflip(s, 0);          // Disable vertical flip
        s->set_dcw(s, 1);            // Enable downsize
        s->set_colorbar(s, 0);       // Disable color bar
        
        ESP_LOGI(TAG, "Camera sensor optimized for high-performance streaming");
    }

    ESP_LOGI(TAG, "Camera initialization complete");
    return ESP_OK;
}

// ===========================
// Camera Capture Task - Runs on Core 0 (PRO_CPU)
// ===========================
static void camera_capture_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Camera capture task started on Core %d", xPortGetCoreID());
    
    TickType_t last_capture_time = xTaskGetTickCount();
    
    while (1) {
        int64_t start_time = esp_timer_get_time();
        
        // Capture frame
        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            ESP_LOGE(TAG, "Camera capture failed");
            update_stats("capture", 0, false);
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }

        // Check frame quality
        if (fb->len == 0 || fb->len > FRAME_BUFFER_SIZE) {
            ESP_LOGW(TAG, "Invalid frame size: %d bytes", fb->len);
            esp_camera_fb_return(fb);
            update_stats("capture", 0, false);
            continue;
        }

        // Allocate memory for frame data in PSRAM if available
        frame_data_t *frame = heap_caps_malloc(sizeof(frame_data_t), 
                                              esp_psram_is_initialized() ? MALLOC_CAP_SPIRAM : MALLOC_CAP_DEFAULT);
        if (!frame) {
            ESP_LOGE(TAG, "Failed to allocate memory for frame structure");
            esp_camera_fb_return(fb);
            update_stats("capture", 0, false);
            continue;
        }

        // Allocate buffer for frame data
        frame->buffer = heap_caps_malloc(fb->len, 
                                        esp_psram_is_initialized() ? MALLOC_CAP_SPIRAM : MALLOC_CAP_DEFAULT);
        if (!frame->buffer) {
            ESP_LOGE(TAG, "Failed to allocate memory for frame buffer");
            free(frame);
            esp_camera_fb_return(fb);
            update_stats("capture", 0, false);
            continue;
        }

        // Copy frame data
        memcpy(frame->buffer, fb->buf, fb->len);
        frame->length = fb->len;
        frame->timestamp = esp_timer_get_time();

        // Return camera frame buffer immediately
        esp_camera_fb_return(fb);

        // Try to send frame to queue (non-blocking)
        if (xQueueSend(frame_queue, &frame, 0) != pdTRUE) {
            // Queue is full, drop oldest frame and try again
            frame_data_t *old_frame;
            if (xQueueReceive(frame_queue, &old_frame, 0) == pdTRUE) {
                free(old_frame->buffer);
                free(old_frame);
                xSemaphoreTake(stats_mutex, portMAX_DELAY);
                stats.frames_dropped++;
                xSemaphoreGive(stats_mutex);
            }
            
            if (xQueueSend(frame_queue, &frame, 0) != pdTRUE) {
                // Still can't send, drop this frame
                free(frame->buffer);
                free(frame);
                update_stats("capture", 0, false);
                ESP_LOGW(TAG, "Frame queue still full, dropping frame");
            } else {
                int64_t capture_time = esp_timer_get_time() - start_time;
                update_stats("capture", capture_time, true);
            }
        } else {
            int64_t capture_time = esp_timer_get_time() - start_time;
            update_stats("capture", capture_time, true);
        }

        // Maintain target frame rate
        TickType_t current_time = xTaskGetTickCount();
        TickType_t elapsed = current_time - last_capture_time;
        TickType_t target_interval = pdMS_TO_TICKS(FRAME_INTERVAL_MS);
        
        if (elapsed < target_interval) {
            vTaskDelay(target_interval - elapsed);
        }
        
        last_capture_time = xTaskGetTickCount();
    }
}

// ===========================
// Network Send Task - Runs on Core 1 (APP_CPU)
// ===========================
static void network_send_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Network send task started on Core %d", xPortGetCoreID());
    
    frame_data_t *frame;
    
    while (1) {
        // Wait for frame from capture task
        if (xQueueReceive(frame_queue, &frame, portMAX_DELAY) == pdTRUE) {
            int64_t start_time = esp_timer_get_time();
            
            // Send frame via HTTP
            esp_err_t result = http_send_frame(frame);
            
            int64_t send_time = esp_timer_get_time() - start_time;
            
            if (result == ESP_OK) {
                update_stats("send", send_time, true);
                ESP_LOGD(TAG, "Frame sent successfully (%d bytes, %lld μs)", 
                        frame->length, send_time);
            } else {
                update_stats("send", send_time, false);
                ESP_LOGW(TAG, "Failed to send frame: %s", esp_err_to_name(result));
            }
            
            // Free frame memory
            free(frame->buffer);
            free(frame);
        }
    }
}

// ===========================
// HTTP Frame Transmission
// ===========================
static esp_err_t http_send_frame(frame_data_t *frame)
{
    if (!frame || !frame->buffer || frame->length == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_http_client_config_t config = {
        .url = SERVER_URL,
        .method = HTTP_METHOD_POST,
        .timeout_ms = 5000,
        .buffer_size = 8192,
        .buffer_size_tx = 8192,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "Failed to initialize HTTP client");
        return ESP_FAIL;
    }

    // Set headers for multipart form data
    char boundary[] = "ESP32S3CAMBoundary";
    char content_type[128];
    snprintf(content_type, sizeof(content_type), "multipart/form-data; boundary=%s", boundary);
    
    esp_http_client_set_header(client, "Content-Type", content_type);

    // Build multipart body
    char header[512];
    int header_len = snprintf(header, sizeof(header),
        "--%s\r\n"
        "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
        "Content-Type: image/jpeg\r\n\r\n",
        boundary);

    char footer[128];
    int footer_len = snprintf(footer, sizeof(footer), "\r\n--%s--\r\n", boundary);

    int total_len = header_len + frame->length + footer_len;
    esp_http_client_set_header(client, "Content-Length", "");

    // Start HTTP request
    esp_err_t err = esp_http_client_open(client, total_len);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open HTTP connection: %s", esp_err_to_name(err));
        esp_http_client_cleanup(client);
        return err;
    }

    // Send header
    int written = esp_http_client_write(client, header, header_len);
    if (written < 0) {
        ESP_LOGE(TAG, "Failed to write header");
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return ESP_FAIL;
    }

    // Send image data in chunks to prevent timeout
    const int chunk_size = 4096;
    int bytes_written = 0;
    
    while (bytes_written < frame->length) {
        int bytes_to_write = (frame->length - bytes_written) > chunk_size ? 
                            chunk_size : (frame->length - bytes_written);
        
        int result = esp_http_client_write(client, 
                                          (char*)(frame->buffer + bytes_written), 
                                          bytes_to_write);
        if (result < 0) {
            ESP_LOGE(TAG, "Failed to write image data at offset %d", bytes_written);
            esp_http_client_close(client);
            esp_http_client_cleanup(client);
            return ESP_FAIL;
        }
        bytes_written += result;
    }

    // Send footer
    written = esp_http_client_write(client, footer, footer_len);
    if (written < 0) {
        ESP_LOGE(TAG, "Failed to write footer");
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return ESP_FAIL;
    }

    // Get response
    int content_length = esp_http_client_fetch_headers(client);
    int status_code = esp_http_client_get_status_code(client);
    
    if (status_code == 200) {
        ESP_LOGD(TAG, "HTTP POST successful, content length: %d", content_length);
        err = ESP_OK;
    } else {
        ESP_LOGW(TAG, "HTTP POST failed with status: %d", status_code);
        err = ESP_FAIL;
    }

    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    
    return err;
}

// ===========================
// Performance Monitor Task
// ===========================
static void performance_monitor_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Performance monitor task started on Core %d", xPortGetCoreID());
    
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));  // Print stats every 10 seconds
        
        xSemaphoreTake(stats_mutex, portMAX_DELAY);
        
        ESP_LOGI(TAG, "=== Performance Statistics ===");
        ESP_LOGI(TAG, "Frames Captured: %lu", stats.frames_captured);
        ESP_LOGI(TAG, "Frames Sent: %lu", stats.frames_sent);
        ESP_LOGI(TAG, "Frames Dropped: %lu", stats.frames_dropped);
        ESP_LOGI(TAG, "Network Errors: %lu", stats.network_errors);
        ESP_LOGI(TAG, "Capture Errors: %lu", stats.capture_errors);
        
        if (stats.frames_captured > 0) {
            ESP_LOGI(TAG, "Avg Capture Time: %lld μs", stats.avg_capture_time);
        }
        if (stats.frames_sent > 0) {
            ESP_LOGI(TAG, "Avg Send Time: %lld μs", stats.avg_send_time);
        }
        
        float success_rate = stats.frames_captured > 0 ? 
                           (float)stats.frames_sent / stats.frames_captured * 100.0f : 0.0f;
        ESP_LOGI(TAG, "Success Rate: %.1f%%", success_rate);
        
        // Memory info
        ESP_LOGI(TAG, "Free Heap: %lu bytes", esp_get_free_heap_size());
        if (esp_psram_is_initialized()) {
            ESP_LOGI(TAG, "Free PSRAM: %lu bytes", heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
        }
        ESP_LOGI(TAG, "===============================");
        
        xSemaphoreGive(stats_mutex);
    }
}

// ===========================
// Statistics Update Function
// ===========================
static void update_stats(const char* operation, int64_t duration, bool success)
{
    xSemaphoreTake(stats_mutex, portMAX_DELAY);
    
    if (strcmp(operation, "capture") == 0) {
        if (success) {
            stats.frames_captured++;
            stats.avg_capture_time = (stats.avg_capture_time + duration) / 2;
        } else {
            stats.capture_errors++;
        }
    } else if (strcmp(operation, "send") == 0) {
        if (success) {
            stats.frames_sent++;
            stats.avg_send_time = (stats.avg_send_time + duration) / 2;
        } else {
            stats.network_errors++;
        }
    }
    
    xSemaphoreGive(stats_mutex);
}

// ===========================
// Main Application Entry Point
// ===========================
void app_main(void)
{
    ESP_LOGI(TAG, "ESP32-S3 High-Performance Camera Streaming Starting...");
    ESP_LOGI(TAG, "Free memory: %lu bytes", esp_get_free_heap_size());
    
    if (esp_psram_is_initialized()) {
        ESP_LOGI(TAG, "PSRAM initialized. Free PSRAM: %lu bytes", 
                heap_caps_get_free_size(MALLOC_CAP_SPIRAM));
    } else {
        ESP_LOGW(TAG, "PSRAM not detected. Performance may be limited.");
    }

    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Create synchronization objects
    frame_queue = xQueueCreate(FRAME_QUEUE_SIZE, sizeof(frame_data_t*));
    if (!frame_queue) {
        ESP_LOGE(TAG, "Failed to create frame queue");
        esp_restart();
    }

    stats_mutex = xSemaphoreCreateMutex();
    if (!stats_mutex) {
        ESP_LOGE(TAG, "Failed to create stats mutex");
        esp_restart();
    }

    // Initialize WiFi
    wifi_init_sta();

    // Initialize Camera
    ESP_ERROR_CHECK(camera_init());

    // Create tasks with core affinity for optimal performance
    
    // Camera capture task on Core 0 (PRO_CPU) - dedicated to camera operations
    BaseType_t result = xTaskCreatePinnedToCore(
        camera_capture_task,
        "cam_capture",
        CAPTURE_TASK_STACK,
        NULL,
        CAPTURE_TASK_PRIORITY,
        &capture_task_handle,
        0  // Core 0
    );
    if (result != pdPASS) {
        ESP_LOGE(TAG, "Failed to create camera capture task");
        esp_restart();
    }

    // Network send task on Core 1 (APP_CPU) - dedicated to WiFi/HTTP operations
    result = xTaskCreatePinnedToCore(
        network_send_task,
        "net_send",
        NETWORK_TASK_STACK,
        NULL,
        NETWORK_TASK_PRIORITY,
        &network_task_handle,
        1  // Core 1
    );
    if (result != pdPASS) {
        ESP_LOGE(TAG, "Failed to create network send task");
        esp_restart();
    }

    // Performance monitor task on Core 1 (APP_CPU) - low priority monitoring
    result = xTaskCreatePinnedToCore(
        performance_monitor_task,
        "perf_monitor",
        4096,
        NULL,
        MONITOR_TASK_PRIORITY,
        &monitor_task_handle,
        1  // Core 1
    );
    if (result != pdPASS) {
        ESP_LOGE(TAG, "Failed to create performance monitor task");
        esp_restart();
    }

    ESP_LOGI(TAG, "All tasks created successfully. System running...");
    ESP_LOGI(TAG, "Target FPS: %d, Frame Interval: %d ms", TARGET_FPS, FRAME_INTERVAL_MS);
}
