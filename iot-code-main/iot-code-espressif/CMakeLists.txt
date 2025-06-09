# ESP32-S3 High-Performance Camera Streaming Project

cmake_minimum_required(VERSION 3.16)

# Set project name and supported languages
set(PROJECT_NAME "esp32s3_camera_streaming")
project(${PROJECT_NAME} C CXX ASM)

# Set the ESP-IDF target
set(IDF_TARGET "esp32s3")

# Include ESP-IDF build system
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Set component requirements
set(COMPONENTS 
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
    esp_heap_caps
)

# Project configuration
project(${PROJECT_NAME})
