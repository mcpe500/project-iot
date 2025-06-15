/*
 * Camera Manager Header
 * Camera initialization, frame capture, and upload functions
 */

#ifndef CAMERA_MANAGER_H
#define CAMERA_MANAGER_H

#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"
#include "globals.h"

// ===========================
// Camera Management Functions
// ===========================

/**
 * Initialize OV5640 camera with optimal settings for ESP32-S3
 * Automatically configures for PSRAM if available
 */
void initCamera();

/**
 * Capture frame and send to server with error handling
 * Updates global performance counters
 */
void captureAndSendFrame();

// ===========================
// Frame Upload Functions
// ===========================

/**
 * Send frame to server with retry logic and fallback
 * @param fb Camera frame buffer
 * @return true if upload successful
 */
bool sendFrameWithRetry(camera_fb_t* fb);

/**
 * Send frame to specific URL with timeout
 * @param fb Camera frame buffer
 * @param url Target server URL
 * @param timeout_ms HTTP timeout in milliseconds
 * @return true if upload successful
 */
bool sendFrameToURL(camera_fb_t* fb, const char* url, int timeout_ms);

/**
 * Legacy function - now uses retry logic
 * @param fb Camera frame buffer
 * @return true if upload successful
 */
bool sendFrameToServer(camera_fb_t* fb);

// ===========================
// Thermal Management Functions
// ===========================

/**
 * Get ESP32-S3 internal temperature
 * @return Temperature in Celsius
 */
float getESP32Temperature();

/**
 * Get averaged temperature for stable readings
 * @return Averaged temperature in Celsius
 */
float getAveragedTemperature();

/**
 * Check temperature and adjust camera settings for optimal image quality
 */
void checkThermalConditions();

/**
 * Apply thermal optimizations to camera sensor
 * @param temperature Current temperature
 */
void applyThermalOptimizations(float temperature);

/**
 * Apply proactive optimizations to prevent overheating
 */
void applyProactiveOptimizations();

/**
 * Reset camera sensor to optimal settings when temperature is normal
 */
void resetCameraToOptimalSettings();

#endif // CAMERA_MANAGER_H
