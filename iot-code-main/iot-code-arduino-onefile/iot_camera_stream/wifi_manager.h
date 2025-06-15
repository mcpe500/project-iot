/*
 * WiFi Manager Header
 * WiFi connection, management, and network testing functions
 */

#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <WiFi.h>
#include <HTTPClient.h>
#include "config.h"
#include "globals.h"

// ===========================
// WiFi Management Functions
// ===========================

/**
 * Initialize WiFi connection with network scanning and diagnostics
 */
void initWiFi();

/**
 * Convert WiFi status code to human-readable string
 * @param status WiFi status code
 * @return String representation of status
 */
String getWiFiStatusString(wl_status_t status);

/**
 * Check and maintain WiFi connection, attempt reconnection if needed
 */
void checkWiFiConnection();

// ===========================
// Network Testing Functions
// ===========================

/**
 * Test basic server connectivity with GET request
 * @return true if server is reachable
 */
bool testServerConnectivity();

/**
 * Test simple HTTP POST with JSON payload
 * @return true if POST request succeeds
 */
bool testSimpleUpload();

// ===========================
// Device Management Functions
// ===========================

/**
 * Register device with backend server
 * @return true if registration successful
 */
bool registerDevice();

/**
 * Send heartbeat to maintain device status
 * @return true if heartbeat sent successfully
 */
bool sendHeartbeat();

#endif // WIFI_MANAGER_H
