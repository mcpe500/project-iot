/*
 * Global Variables and External Declarations
 * Contains all global variables, extern declarations, and shared objects
 */

#ifndef GLOBALS_H
#define GLOBALS_H

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_camera.h"
#include "config.h"

// ===========================
// Global HTTP Objects
// ===========================
extern HTTPClient http;
extern WiFiClient client;

// ===========================
// Timing Variables
// ===========================
extern unsigned long lastFrameTime;
extern unsigned long lastHeartbeatTime;
extern unsigned long lastStatsTime;
extern unsigned long streamStartTime;

// ===========================
// Performance Tracking Variables
// ===========================
extern uint32_t frameCount;
extern uint32_t successCount;
extern uint32_t dropCount;
extern uint32_t totalBytes;
extern bool deviceRegistered;

// ===========================
// WiFi Management Variables
// ===========================
extern unsigned long lastWiFiCheck;
extern unsigned long lastReconnectAttempt;

// ===========================
// Thermal Management Variables
// ===========================
extern unsigned long lastTemperatureCheck;
extern float currentTemperature;
extern float temperatureHistory[TEMPERATURE_AVERAGING_SAMPLES]; // Temperature averaging array
extern int temperatureHistoryIndex;
extern bool thermalThrottling;
extern float thermalAdjustedFPS;
extern int thermalAdjustedQuality;
extern bool proactiveCoolingActive;         // New: Proactive cooling state
extern bool startupCoolingPhase;           // New: Startup conservative phase
extern unsigned long startupPhaseEndTime;  // New: When to end startup phase

// ===========================
// Performance Monitoring Function
// ===========================
void printPerformanceStats();

#endif // GLOBALS_H
