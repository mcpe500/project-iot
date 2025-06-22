#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// Pin definitions
#define BUZZER_PIN 25
#define TRIG_PIN 19
#define ECHO_PIN 18
#define DHT_PIN 23
#define DHT_TYPE DHT11
#define LDR_PIN 32

// Timing constants
#define BUZZER_POLL_INTERVAL 150
#define SENSOR_INTERVAL 2000
#define SEND_INTERVAL 1000
#define BEEP_DURATION 250

// Configuration structure
struct Config {
  const char* wifiSsid = "WIFI_SSID";
  const char* wifiPassword = "WIFI_PASSWORD";
  const char* serverIp = "SERVER_IP";
  int serverPort = 9003;
  const char* deviceId = "esp32-multi-sensor-1";
  const char* deviceName = "Lab Sensor Unit";
  const char* deviceType = "DHT11-LDR-HCSR04";
} config;

// Global state
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSensorRead = 0, lastSendMillis = 0, lastBuzzerPoll = 0;
bool deviceRegistered = false, buzzerActive = false, buzzerEnabled = true;
String buzzerRequestId = "";
float distance = 0.0, temperature = 0.0, humidity = 0.0;
int lightLevel = 0;

// Utility functions
void printTimestamp() {
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] ");
}

String buildUrl(const char* endpoint) {
  return "http://" + String(config.serverIp) + ":" + String(config.serverPort) + endpoint;
}

bool isWifiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

// Configuration functions
void printConfig() {
  Serial.println("=== Configuration ===");
  Serial.printf("WIFI_SSID=%s\n", config.wifiSsid);
  Serial.printf("WIFI_PASSWORD=%s\n", config.wifiPassword);
  Serial.printf("SERVER_IP=%s\n", config.serverIp);
  Serial.printf("SERVER_PORT=%d\n", config.serverPort);
  Serial.printf("DEVICE_ID=%s\n", config.deviceId);
  Serial.printf("DEVICE_NAME=%s\n", config.deviceName);
  Serial.printf("DEVICE_TYPE=%s\n", config.deviceType);
  Serial.println("====================");
}

void handleSerialCommand(String cmd) {
  if (cmd == "CONFIG") {
    printConfig();
  } else if (cmd == "RESET" || cmd == "RESTART") {
    Serial.println("Restarting ESP32...");
    delay(1000);
    ESP.restart();
  } else if (cmd.startsWith("SET ")) {
    Serial.println("Configuration changes are temporary (no persistent storage)!");
  }
}

void checkForConfigUpdate() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    handleSerialCommand(input);
  }
}

// Sensor functions
float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  long duration = pulseIn(ECHO_PIN, HIGH);
  return duration * 0.034 / 2;
}

void readSensors() {
  distance = readDistance();
  temperature = dht.readTemperature();
  humidity = dht.readHumidity();
  lightLevel = analogRead(LDR_PIN);
  
  printTimestamp();
  Serial.printf("Distance: %.1f cm\n", distance);
  
  printTimestamp();
  if (!isnan(temperature)) Serial.printf("Temperature: %.1f °C\n", temperature);
  if (!isnan(humidity)) Serial.printf("Humidity: %.1f %%\n", humidity);
  
  printTimestamp();
  Serial.printf("Light Level: %d\n", lightLevel);
}

// Network functions
void connectToWifi() {
  Serial.printf("Connecting to WiFi %s", config.wifiSsid);
  WiFi.begin(config.wifiSsid, config.wifiPassword);
  
  int retries = 0;
  while (!isWifiConnected() && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  
  if (isWifiConnected()) {
    Serial.printf("\nWiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\nFailed to connect. Check credentials and restart.");
  }
}

void registerDevice() {
  if (!isWifiConnected()) return;
  
  HTTPClient http;
  http.begin(buildUrl("/api/v1/devices/register"));
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["deviceId"] = config.deviceId;
  doc["deviceName"] = config.deviceName;
  doc["deviceType"] = config.deviceType;
  doc["ipAddress"] = WiFi.localIP().toString();
  
  JsonArray caps = doc["capabilities"].to<JsonArray>();
  caps.add("temperature");
  caps.add("humidity");
  caps.add("distance");
  caps.add("lightLevel");

  String payload;
  serializeJson(doc, payload);
  
  int httpCode = http.POST(payload);
  Serial.printf("Registering device... Response: %d\n", httpCode);
  deviceRegistered = (httpCode >= 200 && httpCode < 300);
  http.end();
}

void sendSensorData() {
  if (!isWifiConnected() || !deviceRegistered) return;

  JsonDocument doc;
  doc["deviceId"] = config.deviceId;
  doc["timestamp"] = millis();
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["distance"] = distance;
  doc["lightLevel"] = lightLevel;

  String payload;
  serializeJson(doc, payload);
  
  printTimestamp();
  Serial.printf("Sending payload: %s\n", payload.c_str());

  HTTPClient http;
  http.begin(buildUrl("/api/v1/ingest/sensor-data"));
  http.addHeader("Content-Type", "application/json");

  int httpCode = http.POST(payload);
  printTimestamp();
  if (httpCode > 0) {
    Serial.printf("Sensor data sent. HTTP Response: %d\n", httpCode);
    String response = http.getString();
    if (response.length() > 0) {
      printTimestamp();
      Serial.printf("Server response: %s\n", response.c_str());
    }
  } else {
    Serial.printf("Error sending sensor data. Code: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

// Buzzer functions
void performBeep() {
  if (buzzerEnabled) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(BEEP_DURATION);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void sendBuzzerCompletion(String requestId) {
  HTTPClient http;
  http.begin(buildUrl(("/api/v1/buzzer/complete/" + requestId).c_str()));
  http.addHeader("Content-Type", "application/json");
  
  JsonDocument doc;
  doc["completedAt"] = millis();
  String payload;
  serializeJson(doc, payload);
  
  int httpCode = http.PATCH(payload);
  Serial.printf("Buzzer completion sent for %s. Response: %d\n", requestId.c_str(), httpCode);
  http.end();
}

void activateBuzzer(String requestId) {
  buzzerActive = true;
  buzzerRequestId = requestId;
  
  printTimestamp();
  Serial.printf("Buzzer activated by request: %s\n", requestId.c_str());
  
  performBeep();
  sendBuzzerCompletion(requestId);
}

void deactivateBuzzer() {
  buzzerActive = false;
  buzzerRequestId = "";
  digitalWrite(BUZZER_PIN, LOW);
  
  printTimestamp();
  Serial.println("Buzzer state reset. Ready for next request.");
}

void pollBuzzerStatus() {
  if (!isWifiConnected()) return;

  HTTPClient http;
  http.begin(buildUrl(("/api/v1/buzzer/status/" + String(config.deviceId)).c_str()));
  
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    JsonDocument doc;
    deserializeJson(doc, http.getString());
    
    String status = doc["status"];
    String requestId = doc["requestId"];
    
    if (status == "pending" && !buzzerActive) {
      activateBuzzer(requestId);
    } else if (status != "pending" && buzzerActive) {
      deactivateBuzzer();
    }
  } else {
    printTimestamp();
    Serial.printf("Buzzer status polling failed. Error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

// Main functions
void setup() {
  // Initialize pins
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.begin(921600);
  
  Serial.println("\n=== ESP32 IoT Sensor System ===");
  Serial.println("Send 'CONFIG' to see current settings");
  Serial.println("Send 'SET WIFI_SSID=YourWiFi' to update settings");
  Serial.println("Send 'RESET' to restore defaults");
  Serial.println("===============================\n");
  
  printConfig();
  dht.begin();
  connectToWifi();
  registerDevice();
  
  Serial.println("System ready!");
}

void loop() {
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastBuzzerPoll >= BUZZER_POLL_INTERVAL) {
    pollBuzzerStatus();
    lastBuzzerPoll = currentMillis;
  }
  
  checkForConfigUpdate();
  
  if (currentMillis - lastSensorRead >= SENSOR_INTERVAL) {
    readSensors();
    lastSensorRead = currentMillis;
  }
  
  if (currentMillis - lastSendMillis >= SEND_INTERVAL) {
    sendSensorData();
    lastSendMillis = currentMillis;
  }
}