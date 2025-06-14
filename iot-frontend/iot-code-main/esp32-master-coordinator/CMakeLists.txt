# ESP32 Master Coordinator - CMakeLists.txt
cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Set project name
project(esp32_master_coordinator)

# Set the main component directory
set(MAIN_SRCS "main/master_coordinator_main.c")

# Add include directories
target_include_directories(main PRIVATE "../common")
