# ESP32-S3 Camera Streaming Project - CMakeLists.txt for ESP-IDF

cmake_minimum_required(VERSION 3.16)

# Set the components to include
set(EXTRA_COMPONENT_DIRS $ENV{IDF_PATH}/examples/common_components/protocol_examples_common)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Project name
project(esp32s3_camera_stream)

# Compiler optimizations for maximum performance
target_compile_options(${COMPONENT_LIB} PRIVATE
    -O3                    # Maximum optimization
    -funroll-loops         # Unroll loops for speed
    -ffast-math           # Fast math operations
    -march=native         # Use native CPU features
)

# Additional compile definitions
target_compile_definitions(${COMPONENT_LIB} PRIVATE
    CONFIG_CAMERA_MODULE_ESP_EYE=1
    CONFIG_ESP32S3_SPIRAM_SUPPORT=1
    CONFIG_SPIRAM_CACHE_WORKAROUND=1
)
