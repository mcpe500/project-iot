/*
 * WiFi Manager Implementation
 * WiFi connection, management, and network testing functions
 */

#include "wifi_manager.h"

// ===========================
// WiFi Management Functions
// ===========================

void initWiFi() {
  Serial.println("Initializing WiFi...");
  
  WiFi.disconnect(true);
  delay(1000);
  
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  
  // Quick network scan for diagnostics
  Serial.println("Scanning for WiFi networks...");
  int networkCount = WiFi.scanNetworks();
  Serial.printf("Found %d networks\n", networkCount);
  
  bool targetFound = false;
  for (int i = 0; i < networkCount; i++) {
    String foundSSID = WiFi.SSID(i);
    if (foundSSID == WIFI_SSID) {
      targetFound = true;
      int32_t rssi = WiFi.RSSI(i);
      Serial.printf("✓ Target network '%s' found (RSSI: %d dBm)\n", WIFI_SSID, rssi);
      if (rssi < -80) Serial.println("⚠️ Weak signal strength");
      break;
    }
  }
  
  if (!targetFound) {
    Serial.printf("❌ Network '%s' not found!\n", WIFI_SSID);
    return;
  }
  
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < WIFI_RETRY_COUNT) {
    delay(1000);
    if (++retryCount % 5 == 0) {
      Serial.printf("WiFi connecting... %d/%d\n", retryCount, WIFI_RETRY_COUNT);
      if (retryCount == 15) {
        WiFi.disconnect();
        delay(1000);
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    }
    yield();
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("✅ WiFi connected!");
    Serial.printf("IP: %s | RSSI: %d dBm\n", WiFi.localIP().toString().c_str(), WiFi.RSSI());
    WiFi.setAutoReconnect(true);
  } else {
    Serial.printf("❌ WiFi failed after %d attempts\n", retryCount);
  }
}

String getWiFiStatusString(wl_status_t status) {
  switch (status) {
    case WL_CONNECTED: return "Connected";
    case WL_NO_SSID_AVAIL: return "No SSID";
    case WL_CONNECT_FAILED: return "Failed";
    case WL_CONNECTION_LOST: return "Lost";
    case WL_DISCONNECTED: return "Disconnected";
    default: return "Unknown";
  }
}

void checkWiFiConnection() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastWiFiCheck >= WIFI_CHECK_INTERVAL_MS) {
    if (WiFi.status() != WL_CONNECTED) {
      if (currentTime - lastReconnectAttempt >= WIFI_RECONNECT_INTERVAL_MS) {
        Serial.printf("WiFi disconnected (%s) - reconnecting...\n", 
                      getWiFiStatusString(WiFi.status()).c_str());
        initWiFi();
        lastReconnectAttempt = currentTime;
      }
    } else {
      lastReconnectAttempt = 0; // Reset reconnect timer
    }
    lastWiFiCheck = currentTime;
  }
}

// ===========================
// Network Testing Functions
// ===========================

bool testServerConnectivity() {
  Serial.println("Testing server connectivity...");
  
  http.begin(client, SERVER_URL);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(3000);
  
  int httpCode = http.GET();
  
  Serial.printf("Server connectivity test result: %d\n", httpCode);
  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("Server response: %s\n", response.substring(0, 100).c_str());
    
    if (httpCode == 200 || httpCode == 404 || httpCode == 405) {
      Serial.println("✅ Server is reachable (endpoint may need configuration)");
      http.end();
      return true;
    } else {
      Serial.printf("⚠️ Server returned code: %d\n", httpCode);
    }
  } else {
    Serial.printf("❌ Server connection failed: %s\n", http.errorToString(httpCode).c_str());
  }
  
  http.end();
  return false;
}

bool testSimpleUpload() {
  Serial.println("Testing simple HTTP POST...");
  
  http.begin(client, SERVER_URL);
  http.addHeader("X-API-Key", API_KEY);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String testPayload = "{\"test\":\"ESP32-camera-connectivity\",\"timestamp\":" + String(millis()) + "}";
  
  int httpCode = http.POST(testPayload);
  Serial.printf("Simple POST test result: %d\n", httpCode);
  
  if (httpCode > 0) {
    String response = http.getString();
    Serial.printf("Simple POST response: %s\n", response.substring(0, 200).c_str());
    http.end();
    return (httpCode == 200 || httpCode == 400);
  } else {
    Serial.printf("Simple POST failed: %s\n", http.errorToString(httpCode).c_str());
    http.end();
    return false;
  }
}

// ===========================
// Device Management Functions
// ===========================

bool registerDevice() {
  Serial.println("Registering device...");
  
  http.begin(client, REGISTER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String payload = "{\"deviceId\":\"" + String(DEVICE_ID) + 
                  "\",\"deviceName\":\"" + String(DEVICE_NAME) + 
                  "\",\"deviceType\":\"camera\",\"ipAddress\":\"" + 
                  WiFi.localIP().toString() + 
                  "\",\"capabilities\":[\"streaming\",\"recording\",\"capture\"]}";
  
  int httpCode = http.POST(payload);
  bool success = (httpCode == 200);
  
  if (success) {
    Serial.println("Device registered successfully!");
    deviceRegistered = true;
  } else {
    Serial.printf("Registration failed: %d\n", httpCode);
  }
  
  http.end();
  return success;
}

bool sendHeartbeat() {
  if (!deviceRegistered) {
    return registerDevice();
  }
  
  http.begin(client, HEARTBEAT_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);
  
  String payload = "{\"deviceId\":\"" + String(DEVICE_ID) + 
                  "\",\"uptime\":" + String(millis()) + 
                  ",\"freeHeap\":" + String(ESP.getFreeHeap()) + 
                  ",\"wifiRssi\":" + String(WiFi.RSSI()) + 
                  ",\"status\":\"online\"}";
  
  int httpCode = http.POST(payload);
  bool success = (httpCode == 200);
  
  if (success) {
    Serial.println("Heartbeat sent");
  } else {
    Serial.printf("Heartbeat failed: %d\n", httpCode);
    deviceRegistered = false;
  }
  
  http.end();
  return success;
}
