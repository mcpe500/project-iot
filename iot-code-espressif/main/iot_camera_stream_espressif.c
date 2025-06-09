/*
 * ESP32-S3 OV5640 Camera Video Streaming to Backend - ESP-IDF Version
 * Optimized for dual-core performance with maximum S3 utilization
 * 
 * Core 0: WiFi, HTTP communication, and system tasks
 * Core 1: Camera capture, image processing, and frame management
 * 
 * Features:
 * - Dual-core task distribution for maximum performance
 * - PSRAM optimization for large frame buffers
 * - Hardware-accelerated JPEG compression
 * - Advanced camera sensor tuning for OV5640
 * - Efficient memory management with DMA
 * - Real-time frame rate control (10 FPS)
 * - Robust error handling and recovery
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "esp_psram.h"
#include "nvs_flash.h"
#include "esp_netif.h"
#include "esp_http_client.h"
#include "esp_camera.h"
#include "driver/gpio.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ===========================
// Configuration Section
// ===========================
#define WIFI_SSID               "YOUR_WIFI_SSID"
#define WIFI_PASSWORD           "YOUR_WIFI_PASSWORD"
#define SERVER_URL              "http://YOUR_BACKEND_IP:3000/api/v1/stream/stream"

// Camera Configuration
#define CAM_PIN_PWDN            -1
#define CAM_PIN_RESET           -1
#define CAM_PIN_XCLK            15
#define CAM_PIN_SIOD            4
#define CAM_PIN_SIOC            5
#define CAM_PIN_D7              16
#define CAM_PIN_D6              17
#define CAM_PIN_D5              18
#define CAM_PIN_D4              12
#define CAM_PIN_D3              10
#define CAM_PIN_D2              8
#define CAM_PIN_D1              9
#define CAM_PIN_D0              11
#define CAM_PIN_VSYNC           6
#define CAM_PIN_HREF            7
#define CAM_PIN_PCLK            13

// Performance Configuration
#define FRAME_BUFFER_COUNT      3           // Triple buffering for smooth operation
#define TARGET_FPS              10          // 10 FPS target
#define FRAME_INTERVAL_MS       (1000/TARGET_FPS)
#define HTTP_BUFFER_SIZE        (64 * 1024) // 64KB HTTP buffer
#define TASK_STACK_SIZE         (8 * 1024)  // 8KB stack for tasks
#define JPEG_QUALITY            12          // JPEG quality (1-63, lower = better)

// Task Priorities (higher number = higher priority)
#define CAMERA_TASK_PRIORITY    (configMAX_PRIORITIES - 1)
#define WIFI_TASK_PRIORITY      (configMAX_PRIORITIES - 2)
#define HTTP_TASK_PRIORITY      (configMAX_PRIORITIES - 3)

// WiFi Event Bits
#define WIFI_CONNECTED_BIT      BIT0
#define WIFI_FAIL_BIT           BIT1

// ===========================
// Global Variables
// ===========================
static const char *TAG = "ESP32S3_CAM";
static EventGroupHandle_t s_wifi_event_group;
static QueueHandle_t frame_queue;
static SemaphoreHandle_t wifi_mutex;
static esp_timer_handle_t frame_timer;
static camera_fb_t *current_frame = NULL;
static uint32_t frame_counter = 0;
static uint32_t frames_sent = 0;
static uint32_t frames_failed = 0;

// Performance monitoring
static int64_t last_frame_time = 0;
static float avg_frame_rate = 0.0;

// ===========================
// WiFi Event Handler
// ===========================
static void wifi_event_handler(void* arg, esp_event_base_t event_base,
                                int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "WiFi disconnected, attempting reconnect...");
        esp_wifi_connect();
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

// ===========================
// WiFi Initialization
// ===========================
static esp_err_t wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();
    wifi_mutex = xSemaphoreCreateMutex();

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
            .pmf_cfg = {
                .capable = true,
                .required = false
            },
        },
    };

    // Optimize WiFi for high throughput
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE)); // Disable power saving
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi initialization complete");

    // Wait for connection
    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
            WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
            pdFALSE,
            pdFALSE,
            portMAX_DELAY);

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to WiFi SSID: %s", WIFI_SSID);
        return ESP_OK;
    } else {
        ESP_LOGE(TAG, "Failed to connect to WiFi");
        return ESP_FAIL;
    }
}

// ===========================
// Camera Initialization with S3 Optimizations
// ===========================
static esp_err_t camera_init(void)
{
    ESP_LOGI(TAG, "Initializing camera with S3 optimizations...");

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

        // Clock and timing optimization
        .xclk_freq_hz = 20000000,          // 20MHz for stable operation
        .ledc_timer = LEDC_TIMER_0,
        .ledc_channel = LEDC_CHANNEL_0,

        // Image format and quality
        .pixel_format = PIXFORMAT_JPEG,
        .frame_size = FRAMESIZE_VGA,       // 640x480 for balanced performance
        .jpeg_quality = JPEG_QUALITY,      // Optimized quality setting
        .fb_count = FRAME_BUFFER_COUNT,    // Triple buffering

        // Memory optimization for S3
        .fb_location = CAMERA_FB_IN_PSRAM, // Use PSRAM for frame buffers
        .grab_mode = CAMERA_GRAB_LATEST,   // Always get the latest frame
    };

    // Optimize settings based on PSRAM availability
    if (esp_psram_is_initialized()) {
        ESP_LOGI(TAG, "PSRAM available: %d bytes", esp_psram_get_size());
        config.fb_count = FRAME_BUFFER_COUNT;
        config.jpeg_quality = 10;          // Higher quality with PSRAM
        config.grab_mode = CAMERA_GRAB_LATEST;
    } else {
        ESP_LOGW(TAG, "PSRAM not available, using conservative settings");
        config.fb_location = CAMERA_FB_IN_DRAM;
        config.fb_count = 1;
        config.jpeg_quality = 15;
    }

    // Initialize camera
    esp_err_t err = esp_camera_init(&config);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Camera init failed with error 0x%x", err);
        return err;
    }

    // Advanced sensor configuration for OV5640
    sensor_t *s = esp_camera_sensor_get();
    if (s != NULL) {
        ESP_LOGI(TAG, "Optimizing OV5640 sensor settings...");
        
        // Image quality settings
        s->set_framesize(s, FRAMESIZE_VGA);
        s->set_quality(s, JPEG_QUALITY);
        
        // Auto exposure and gain control
        s->set_exposure_ctrl(s, 1);        // Enable auto exposure
        s->set_aec2(s, 1);                 // Enable AEC DSP
        s->set_ae_level(s, 0);             // Auto exposure level
        s->set_aec_value(s, 300);          // Manual exposure value
        
        // Auto white balance
        s->set_whitebal(s, 1);             // Enable auto white balance
        s->set_awb_gain(s, 1);             // Enable AWB gain
        s->set_wb_mode(s, 0);              // Auto WB mode
        
        // Gain control
        s->set_gain_ctrl(s, 1);            // Enable auto gain
        s->set_agc_gain(s, 0);             // Auto gain value
        s->set_gainceiling(s, GAINCEILING_2X); // Limit gain ceiling
        
        // Image enhancement
        s->set_brightness(s, 0);           // Neutral brightness
        s->set_contrast(s, 0);             // Neutral contrast
        s->set_saturation(s, 0);           // Neutral saturation
        s->set_sharpness(s, 0);            // Neutral sharpness
        
        // Noise reduction and lens correction
        s->set_bpc(s, 1);                  // Enable black pixel cancel
        s->set_wpc(s, 1);                  // Enable white pixel cancel
        s->set_raw_gma(s, 1);              // Enable gamma correction
        s->set_lenc(s, 1);                 // Enable lens correction
        
        // Disable special effects and test patterns
        s->set_special_effect(s, 0);       // No special effects
        s->set_colorbar(s, 0);             // Disable color bar test
        
        // Mirror and flip settings
        s->set_hmirror(s, 0);              // No horizontal mirror
        s->set_vflip(s, 0);                // No vertical flip
        
        // Enable downscale for performance
        s->set_dcw(s, 1);                  // Enable downscale
        
        ESP_LOGI(TAG, "Camera sensor optimization complete");
    }

    ESP_LOGI(TAG, "Camera initialized successfully");
    return ESP_OK;
}

// ===========================
// HTTP Response Handler
// ===========================
static esp_err_t http_event_handler(esp_http_client_event_t *evt)
{
    switch(evt->event_id) {
        case HTTP_EVENT_ERROR:
            ESP_LOGE(TAG, "HTTP_EVENT_ERROR");
            break;
        case HTTP_EVENT_ON_CONNECTED:
            ESP_LOGD(TAG, "HTTP_EVENT_ON_CONNECTED");
            break;
        case HTTP_EVENT_HEADER_SENT:
            ESP_LOGD(TAG, "HTTP_EVENT_HEADER_SENT");
            break;
        case HTTP_EVENT_ON_HEADER:
            ESP_LOGD(TAG, "HTTP_EVENT_ON_HEADER, key=%s, value=%s", evt->header_key, evt->header_value);
            break;
        case HTTP_EVENT_ON_DATA:
            ESP_LOGD(TAG, "HTTP_EVENT_ON_DATA, len=%d", evt->data_len);
            break;
        case HTTP_EVENT_ON_FINISH:
            ESP_LOGD(TAG, "HTTP_EVENT_ON_FINISH");
            break;
        case HTTP_EVENT_DISCONNECTED:
            ESP_LOGD(TAG, "HTTP_EVENT_DISCONNECTED");
            break;
        case HTTP_EVENT_REDIRECT:
            ESP_LOGD(TAG, "HTTP_EVENT_REDIRECT");
            break;
    }
    return ESP_OK;
}

// ===========================
// Frame Transmission Task (Core 0)
// ===========================
static void http_task(void *pvParameters)
{
    ESP_LOGI(TAG, "HTTP task started on core %d", xPortGetCoreID());
    
    // HTTP client configuration
    esp_http_client_config_t config = {
        .url = SERVER_URL,
        .event_handler = http_event_handler,
        .timeout_ms = 5000,
        .buffer_size = HTTP_BUFFER_SIZE,
        .buffer_size_tx = HTTP_BUFFER_SIZE,
    };
    
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "Failed to initialize HTTP client");
        vTaskDelete(NULL);
        return;
    }

    camera_fb_t *fb = NULL;
    char *boundary = "ESP32S3CAMBoundary";
    char *content_type = NULL;
    
    // Pre-allocate boundary strings
    asprintf(&content_type, "multipart/form-data; boundary=%s", boundary);
    
    while (1) {
        // Wait for frame from camera task
        if (xQueueReceive(frame_queue, &fb, pdMS_TO_TICKS(1000)) == pdTRUE) {
            if (!fb || fb->len == 0) {
                ESP_LOGW(TAG, "Invalid frame received");
                if (fb) esp_camera_fb_return(fb);
                continue;
            }

            // Check WiFi connection
            EventBits_t bits = xEventGroupGetBits(s_wifi_event_group);
            if (!(bits & WIFI_CONNECTED_BIT)) {
                ESP_LOGW(TAG, "WiFi not connected, dropping frame");
                esp_camera_fb_return(fb);
                frames_failed++;
                continue;
            }

            // Prepare multipart form data
            char *header = NULL;
            char *footer = NULL;
            
            asprintf(&header, 
                "--%s\r\n"
                "Content-Disposition: form-data; name=\"image\"; filename=\"frame.jpg\"\r\n"
                "Content-Type: image/jpeg\r\n\r\n", 
                boundary);
            
            asprintf(&footer, "\r\n--%s--\r\n", boundary);
            
            if (!header || !footer) {
                ESP_LOGE(TAG, "Failed to allocate HTTP headers");
                if (header) free(header);
                if (footer) free(footer);
                esp_camera_fb_return(fb);
                frames_failed++;
                continue;
            }

            // Calculate total content length
            int content_length = strlen(header) + fb->len + strlen(footer);
            
            // Set HTTP headers
            esp_http_client_set_method(client, HTTP_METHOD_POST);
            esp_http_client_set_header(client, "Content-Type", content_type);
            esp_http_client_set_post_field(client, NULL, content_length);

            // Perform HTTP request
            esp_err_t err = esp_http_client_open(client, content_length);
            if (err == ESP_OK) {
                // Send header
                int header_len = esp_http_client_write(client, header, strlen(header));
                
                // Send image data in chunks for memory efficiency
                int bytes_written = 0;
                const int chunk_size = 4096; // 4KB chunks
                while (bytes_written < fb->len) {
                    int bytes_to_write = (fb->len - bytes_written) > chunk_size ? 
                                        chunk_size : (fb->len - bytes_written);
                    int written = esp_http_client_write(client, 
                                                       (const char*)(fb->buf + bytes_written), 
                                                       bytes_to_write);
                    if (written < 0) {
                        ESP_LOGE(TAG, "Failed to write image data");
                        break;
                    }
                    bytes_written += written;
                }
                
                // Send footer
                int footer_len = esp_http_client_write(client, footer, strlen(footer));
                
                // Get response
                int content_len = esp_http_client_fetch_headers(client);
                int status_code = esp_http_client_get_status_code(client);
                
                if (status_code == 200) {
                    frames_sent++;
                    ESP_LOGD(TAG, "Frame sent successfully (Size: %d bytes)", fb->len);
                } else {
                    frames_failed++;
                    ESP_LOGW(TAG, "HTTP error: %d", status_code);
                }
                
                esp_http_client_close(client);
            } else {
                frames_failed++;
                ESP_LOGE(TAG, "Failed to open HTTP connection: %s", esp_err_to_name(err));
            }

            // Cleanup
            free(header);
            free(footer);
            esp_camera_fb_return(fb);
            
        } else {
            // Timeout waiting for frame
            ESP_LOGD(TAG, "No frame received, continuing...");
        }
        
        // Small delay to prevent task starvation
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    
    // Cleanup
    free(content_type);
    esp_http_client_cleanup(client);
    vTaskDelete(NULL);
}

// ===========================
// Camera Capture Task (Core 1)
// ===========================
static void camera_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Camera task started on core %d", xPortGetCoreID());
    
    TickType_t last_wake_time = xTaskGetTickCount();
    
    while (1) {
        // Maintain precise timing for target FPS
        vTaskDelayUntil(&last_wake_time, pdMS_TO_TICKS(FRAME_INTERVAL_MS));
        
        // Capture frame
        camera_fb_t *fb = esp_camera_fb_get();
        if (!fb) {
            ESP_LOGW(TAG, "Camera capture failed");
            frames_failed++;
            continue;
        }
        
        // Performance monitoring
        int64_t current_time = esp_timer_get_time();
        if (last_frame_time > 0) {
            float frame_interval = (current_time - last_frame_time) / 1000.0; // ms
            float current_fps = 1000.0 / frame_interval;
            avg_frame_rate = (avg_frame_rate * 0.9) + (current_fps * 0.1); // Moving average
        }
        last_frame_time = current_time;
        frame_counter++;
        
        // Send frame to HTTP task (non-blocking)
        if (xQueueSend(frame_queue, &fb, 0) != pdTRUE) {
            // Queue full, drop frame
            ESP_LOGW(TAG, "Frame queue full, dropping frame");
            esp_camera_fb_return(fb);
            frames_failed++;
        }
        
        // Log statistics every 100 frames
        if (frame_counter % 100 == 0) {
            ESP_LOGI(TAG, "Stats - Frames: %lu, Sent: %lu, Failed: %lu, FPS: %.1f", 
                     frame_counter, frames_sent, frames_failed, avg_frame_rate);
            
            // Memory usage monitoring
            ESP_LOGI(TAG, "Free heap: %lu bytes, Free PSRAM: %lu bytes", 
                     esp_get_free_heap_size(), esp_psram_get_free_size());
        }
    }
    
    vTaskDelete(NULL);
}

// ===========================
// System Monitoring Task
// ===========================
static void monitor_task(void *pvParameters)
{
    ESP_LOGI(TAG, "Monitor task started on core %d", xPortGetCoreID());
    
    while (1) {
        // Monitor system health every 30 seconds
        vTaskDelay(pdMS_TO_TICKS(30000));
        
        // Check WiFi status
        EventBits_t bits = xEventGroupGetBits(s_wifi_event_group);
        bool wifi_connected = (bits & WIFI_CONNECTED_BIT) != 0;
        
        // Get system information
        uint32_t free_heap = esp_get_free_heap_size();
        uint32_t free_psram = esp_psram_get_free_size();
        uint32_t min_free_heap = esp_get_minimum_free_heap_size();
        
        ESP_LOGI(TAG, "=== System Status ===");
        ESP_LOGI(TAG, "WiFi: %s", wifi_connected ? "Connected" : "Disconnected");
        ESP_LOGI(TAG, "Uptime: %lld seconds", esp_timer_get_time() / 1000000);
        ESP_LOGI(TAG, "Free Heap: %lu bytes (Min: %lu)", free_heap, min_free_heap);
        ESP_LOGI(TAG, "Free PSRAM: %lu bytes", free_psram);
        ESP_LOGI(TAG, "Average FPS: %.1f", avg_frame_rate);
        ESP_LOGI(TAG, "Success Rate: %.1f%%", 
                 frames_sent > 0 ? (float)frames_sent / (frames_sent + frames_failed) * 100.0 : 0.0);
        
        // Check for low memory conditions
        if (free_heap < 50000) { // Less than 50KB
            ESP_LOGW(TAG, "Low heap memory warning!");
        }
        
        if (free_psram < 100000) { // Less than 100KB
            ESP_LOGW(TAG, "Low PSRAM warning!");
        }
    }
    
    vTaskDelete(NULL);
}

// ===========================
// Main Application Entry Point
// ===========================
void app_main(void)
{
    ESP_LOGI(TAG, "ESP32-S3 High-Performance Camera Streaming Starting...");
    ESP_LOGI(TAG, "Running on Core: %d", xPortGetCoreID());
    
    // Disable brownout detector for stable operation
    WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
    
    // Initialize NVS
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    
    // Initialize PSRAM
    if (esp_psram_is_initialized()) {
        ESP_LOGI(TAG, "PSRAM initialized successfully - Size: %d MB", 
                 esp_psram_get_size() / (1024 * 1024));
    } else {
        ESP_LOGW(TAG, "PSRAM not available");
    }
    
    // Create frame queue for inter-task communication
    frame_queue = xQueueCreate(2, sizeof(camera_fb_t*));
    if (!frame_queue) {
        ESP_LOGE(TAG, "Failed to create frame queue");
        return;
    }
    
    // Initialize WiFi
    if (wifi_init_sta() != ESP_OK) {
        ESP_LOGE(TAG, "WiFi initialization failed");
        return;
    }
    
    // Initialize camera
    if (camera_init() != ESP_OK) {
        ESP_LOGE(TAG, "Camera initialization failed");
        return;
    }
    
    ESP_LOGI(TAG, "All systems initialized successfully");
    ESP_LOGI(TAG, "Creating high-performance tasks...");
    
    // Create camera task on Core 1 (dedicated to camera operations)
    BaseType_t camera_result = xTaskCreatePinnedToCore(
        camera_task,
        "camera_task",
        TASK_STACK_SIZE,
        NULL,
        CAMERA_TASK_PRIORITY,
        NULL,
        1  // Pin to Core 1
    );
    
    // Create HTTP task on Core 0 (with WiFi and networking)
    BaseType_t http_result = xTaskCreatePinnedToCore(
        http_task,
        "http_task", 
        TASK_STACK_SIZE,
        NULL,
        HTTP_TASK_PRIORITY,
        NULL,
        0  // Pin to Core 0
    );
    
    // Create monitoring task on Core 0
    BaseType_t monitor_result = xTaskCreatePinnedToCore(
        monitor_task,
        "monitor_task",
        4096,
        NULL,
        1, // Low priority
        NULL,
        0  // Pin to Core 0
    );
    
    if (camera_result != pdPASS || http_result != pdPASS || monitor_result != pdPASS) {
        ESP_LOGE(TAG, "Failed to create tasks");
        return;
    }
    
    ESP_LOGI(TAG, "High-performance camera streaming system started!");
    ESP_LOGI(TAG, "Target FPS: %d", TARGET_FPS);
    ESP_LOGI(TAG, "Frame buffer count: %d", FRAME_BUFFER_COUNT);
    ESP_LOGI(TAG, "JPEG quality: %d", JPEG_QUALITY);
    ESP_LOGI(TAG, "Camera task on Core 1, HTTP/WiFi tasks on Core 0");
    
    // Main task can now delete itself as all work is done by other tasks
    vTaskDelete(NULL);
}
