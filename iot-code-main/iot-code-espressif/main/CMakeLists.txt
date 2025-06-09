# Main component CMake file for ESP32-S3 Camera Streaming

set(COMPONENT_SRCS 
    "iot_camera_stream_espressif.c"
)

set(COMPONENT_ADD_INCLUDEDIRS ".")

set(COMPONENT_REQUIRES 
    esp_camera
    esp_wifi
    esp_netif
    esp_event
    esp_http_client
    esp_timer
    nvs_flash
    freertos
    driver
    esp_psram
    heap
    soc
)

register_component()
