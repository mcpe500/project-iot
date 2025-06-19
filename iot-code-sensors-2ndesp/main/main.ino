// Buzzer, HC-SR04, DHT11, and LDR Sensor Control for ESP32
// WITH IoT Backend Integration using .env configuration

// --- LIBRARIES ---
#include <Ticker.h>
#include <Preferences.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// --- HARDWARE PIN DEFINITIONS ---
#define BUZZER_PIN 25
#define BUZZER_POLL_INTERVAL 150  // Poll every 150ms
#define TRIG_PIN 19
#define ECHO_PIN 18
#define DHT_PIN 23
#define DHT_TYPE DHT11
#define LDR_PIN 32

// --- GLOBAL OBJECTS AND VARIABLES ---

// Persistent storage for configuration
Preferences preferences;

// Configuration Structure (.env compatible)
struct Config {
  char wifiSsid[64];
  char wifiPassword[64];
  char serverIp[16];
  int serverPort;
  char deviceId[32];
  char deviceName[64];
  char deviceType[32];
};

Config config;

// Default configuration values (matching .env.example)
const Config defaultConfig = {
  "BIZNET357",           // WIFI_SSID
  "ivan4321",       // WIFI_PASSWORD  
  "203.175.11.145",           // SERVER_IP
  9004,                      // SERVER_PORT
  "esp32-multi-sensor-1",    // DEVICE_ID
  "Lab Sensor Unit",         // DEVICE_NAME
  "DHT11-LDR-HCSR04"        // DEVICE_TYPE
};

// State machine states for buzzer
enum BuzzerState {
  STATE_BEEP_SHORT,
  STATE_PAUSE_1,
  STATE_BEEP_LONG,
  STATE_PAUSE_3
};

BuzzerState currentState = STATE_BEEP_SHORT;
unsigned long previousMillis = 0;
const unsigned long beepShortDuration = 200;
const unsigned long pause1Duration = 1000;
const unsigned long beepLongDuration = 500;
const unsigned long pause3Duration = 3000;

// Sensor variables
unsigned long lastSensorRead = 0;
const unsigned long sensorInterval = 2000;  // Read sensors every 2 seconds
DHT dht(DHT_PIN, DHT_TYPE);  // Initialize DHT sensor

// Timing for backend communication
unsigned long lastSendMillis = 0;
const unsigned long sendInterval = 1000;   // Send data every 250 miliseconds
bool deviceRegistered = false;

// Buzzer enable/disable flag (set to false to mute buzzer)
bool buzzerEnabled = true;

// Buzzer control variables
bool buzzerActive = false;
String buzzerRequestId = "";
unsigned long lastBuzzerPoll = 0;

// Global sensor variables for backend sending
float distance = 0.0;
float temperature = 0.0;
float humidity = 0.0;
int lightLevel = 0;

// --- FUNCTION PROTOTYPES (Forward Declarations) ---
void pollBuzzerStatus();
void activateBuzzer(String requestId);
void deactivateBuzzer();
void loadConfig();
void saveConfig();
void checkForConfigUpdate();
void connectToWifi();
void registerDevice();
void sendSensorData();
void readSensors();
float readDistanceSensor();


// =================================================================
// --- SETUP FUNCTION ---
// =================================================================
void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.begin(921600);  // Initialize serial for debugging
  
  Serial.println("\n=== ESP32 IoT Sensor System ===");
  Serial.println("Send 'CONFIG' to see current settings");
  Serial.println("Send 'SET WIFI_SSID=YourWiFi' to update settings");
  Serial.println("Send 'RESET' to restore defaults");
  Serial.println("===============================\n");
  
  // Load configuration from flash memory
  loadConfig();
  
  dht.begin();  // Start DHT sensor
  
  // Connect to WiFi
  connectToWifi();
  
  // Register device with backend
  registerDevice();
  
  Serial.println("System ready!");
}

// =================================================================
// --- MAIN LOOP ---
// =================================================================
void loop() {
  unsigned long currentMillis = millis();
  
  // Handle buzzer status polling
  if (currentMillis - lastBuzzerPoll >= BUZZER_POLL_INTERVAL) {
    pollBuzzerStatus();
    lastBuzzerPoll = currentMillis;
  }
  
  // Handle configuration updates via Serial
  checkForConfigUpdate();
  
  // Handle sensor reading (non-blocking)
  if (currentMillis - lastSensorRead >= sensorInterval) {
    readSensors(); // This will update global sensor variables
    lastSensorRead = currentMillis;
  }
  
  // Handle data sending (non-blocking)
  if (currentMillis - lastSendMillis >= sendInterval) {
    sendSensorData();
    lastSendMillis = currentMillis;
  }
  
  // Handle buzzer state machine
  switch (currentState) {
    case STATE_BEEP_SHORT:
      if (buzzerEnabled) digitalWrite(BUZZER_PIN, HIGH);
      if (currentMillis - previousMillis >= beepShortDuration) {
        digitalWrite(BUZZER_PIN, LOW);
        previousMillis = currentMillis;
        currentState = STATE_PAUSE_1;
      }
      break;
      
    case STATE_PAUSE_1:
      if (currentMillis - previousMillis >= pause1Duration) {
        previousMillis = currentMillis;
        currentState = STATE_BEEP_LONG;
      }
      break;
      
    case STATE_BEEP_LONG:
      if (buzzerEnabled) digitalWrite(BUZZER_PIN, HIGH);
      if (currentMillis - previousMillis >= beepLongDuration) {
        digitalWrite(BUZZER_PIN, LOW);
        previousMillis = currentMillis;
        currentState = STATE_PAUSE_3;
      }
      break;
      
    case STATE_PAUSE_3:
      if (currentMillis - previousMillis >= pause3Duration) {
        previousMillis = currentMillis;
        currentState = STATE_BEEP_SHORT;
      }
      break;
  }
}

// =================================================================
// --- HELPER FUNCTIONS ---
// =================================================================

// --- Configuration Functions ---
void loadConfig() {
  preferences.begin("config", false);
  
  // Load configuration or use defaults (.env style)
  strlcpy(config.wifiSsid, preferences.getString("WIFI_SSID", defaultConfig.wifiSsid).c_str(), sizeof(config.wifiSsid));
  strlcpy(config.wifiPassword, preferences.getString("WIFI_PASSWORD", defaultConfig.wifiPassword).c_str(), sizeof(config.wifiPassword));
  strlcpy(config.serverIp, preferences.getString("SERVER_IP", defaultConfig.serverIp).c_str(), sizeof(config.serverIp));
  config.serverPort = preferences.getInt("SERVER_PORT", defaultConfig.serverPort);
  strlcpy(config.deviceId, preferences.getString("DEVICE_ID", defaultConfig.deviceId).c_str(), sizeof(config.deviceId));
  strlcpy(config.deviceName, preferences.getString("DEVICE_NAME", defaultConfig.deviceName).c_str(), sizeof(config.deviceName));
  strlcpy(config.deviceType, preferences.getString("DEVICE_TYPE", defaultConfig.deviceType).c_str(), sizeof(config.deviceType));
  
  preferences.end();
  
  // Print loaded configuration
  Serial.println("=== Configuration Loaded ===");
  Serial.printf("WIFI_SSID=%s\n", config.wifiSsid);
  Serial.printf("WIFI_PASSWORD=%s\n", config.wifiPassword);
  Serial.printf("SERVER_IP=%s\n", config.serverIp);
  Serial.printf("SERVER_PORT=%d\n", config.serverPort);
  Serial.printf("DEVICE_ID=%s\n", config.deviceId);
  Serial.printf("DEVICE_NAME=%s\n", config.deviceName);
  Serial.printf("DEVICE_TYPE=%s\n", config.deviceType);
  Serial.println("============================");
}

void saveConfig() {
  preferences.begin("config", false);
  
  preferences.putString("WIFI_SSID", config.wifiSsid);
  preferences.putString("WIFI_PASSWORD", config.wifiPassword);
  preferences.putString("SERVER_IP", config.serverIp);
  preferences.putInt("SERVER_PORT", config.serverPort);
  preferences.putString("DEVICE_ID", config.deviceId);
  preferences.putString("DEVICE_NAME", config.deviceName);
  preferences.putString("DEVICE_TYPE", config.deviceType);
  
  preferences.end();
  Serial.println("Configuration saved to flash memory!");
}

void checkForConfigUpdate() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    
    if (input == "CONFIG") {
      // Display current configuration
      Serial.println("\n=== Current Configuration ===");
      Serial.printf("WIFI_SSID=%s\n", config.wifiSsid);
      Serial.printf("WIFI_PASSWORD=%s\n", config.wifiPassword);
      Serial.printf("SERVER_IP=%s\n", config.serverIp);
      Serial.printf("SERVER_PORT=%d\n", config.serverPort);
      Serial.printf("DEVICE_ID=%s\n", config.deviceId);
      Serial.printf("DEVICE_NAME=%s\n", config.deviceName);
      Serial.printf("DEVICE_TYPE=%s\n", config.deviceType);
      Serial.println("============================\n");
      
    } else if (input == "RESET") {
      // Reset to defaults
      memcpy(&config, &defaultConfig, sizeof(Config));
      saveConfig();
      Serial.println("Configuration reset to defaults. Restarting...");
      delay(1000);
      ESP.restart();
      
    } else if (input.startsWith("SET ")) {
      // Parse SET command: SET WIFI_SSID=MyWiFi
      String command = input.substring(4);
      int equals = command.indexOf('=');
      if (equals != -1) {
        String key = command.substring(0, equals);
        String value = command.substring(equals + 1);
        
        bool updated = false;
        if (key == "WIFI_SSID") {
          strlcpy(config.wifiSsid, value.c_str(), sizeof(config.wifiSsid));
          updated = true;
        } else if (key == "WIFI_PASSWORD") {
          strlcpy(config.wifiPassword, value.c_str(), sizeof(config.wifiPassword));
          updated = true;
        } else if (key == "SERVER_IP") {
          strlcpy(config.serverIp, value.c_str(), sizeof(config.serverIp));
          updated = true;
        } else if (key == "SERVER_PORT") {
          config.serverPort = value.toInt();
          updated = true;
        } else if (key == "DEVICE_ID") {
          strlcpy(config.deviceId, value.c_str(), sizeof(config.deviceId));
          updated = true;
        } else if (key == "DEVICE_NAME") {
          strlcpy(config.deviceName, value.c_str(), sizeof(config.deviceName));
          updated = true;
        } else if (key == "DEVICE_TYPE") {
          strlcpy(config.deviceType, value.c_str(), sizeof(config.deviceType));
          updated = true;
        }
        
        if (updated) {
          saveConfig();
          Serial.printf("Updated %s=%s\n", key.c_str(), value.c_str());
          Serial.println("Send 'RESTART' to apply WiFi changes or they will apply on next boot.");
        } else {
          Serial.printf("Unknown configuration key: %s\n", key.c_str());
        }
      }
    } else if (input == "RESTART") {
      Serial.println("Restarting ESP32...");
      delay(1000);
      ESP.restart();
    }
  }
}

// --- Sensor Functions ---
void readSensors() {
  // Read and print distance with timestamp
  distance = readDistanceSensor(); // Assign to global variable
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] Distance: ");
  Serial.print(distance);
  Serial.println(" cm");
  
  // Read and print temperature and humidity with timestamp
  temperature = dht.readTemperature(); // Assign to global variable
  humidity = dht.readHumidity();    // Assign to global variable
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] ");
  
  if (!isnan(temperature)) {
    Serial.print("Temperature: ");
    Serial.print(temperature);
    Serial.println(" °C");
  }
  
  if (!isnan(humidity)) {
    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");
  }
  
  // Read and print light level with timestamp
  lightLevel = analogRead(LDR_PIN); // Assign to global variable
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] Light Level: ");
  Serial.println(lightLevel);
}

float readDistanceSensor() {
  // Clear the trigger
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  
  // Send 10µs pulse to trigger
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  
  // Measure pulse duration on echo pin
  long duration = pulseIn(ECHO_PIN, HIGH);
  
  // Calculate distance in cm (speed of sound = 0.034 cm/µs)
  return duration * 0.034 / 2;
}

// --- Buzzer Control Functions ---
void pollBuzzerStatus() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + String(config.serverIp) + ":" + String(config.serverPort) +
               "/api/v1/buzzer/status/" + String(config.deviceId);
  http.begin(url);
  
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    JsonDocument doc;
    deserializeJson(doc, payload);
    
    String status = doc["status"];
    String requestId = doc["requestId"];
    
    if (status == "pending" && !buzzerActive) {
      activateBuzzer(requestId);
    } else if (status != "pending" && buzzerActive) {
      deactivateBuzzer();
    }
  } else {
    Serial.print("[");
    Serial.print(millis());
    Serial.print("] Buzzer status polling failed. Error: ");
    Serial.println(http.errorToString(httpCode).c_str());
  }
  http.end();
}

void activateBuzzer(String requestId) {
  buzzerActive = true;
  buzzerRequestId = requestId;
  digitalWrite(BUZZER_PIN, HIGH);
  
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] Buzzer activated for request: ");
  Serial.println(requestId);
  
  // Send completion notification
  HTTPClient http;
  String url = "http://" + String(config.serverIp) + ":" + String(config.serverPort) +
               "/api/v1/buzzer/complete/" + requestId;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  
  JsonDocument doc;
  doc["completedAt"] = millis();
  String jsonPayload;
  serializeJson(doc, jsonPayload);
  
  int httpCode = http.PATCH(jsonPayload);
  if (httpCode > 0) {
    Serial.print("[");
    Serial.print(millis());
    Serial.print("] Buzzer completion sent. Response: ");
    Serial.println(httpCode);
  } else {
    Serial.print("[");
    Serial.print(millis());
    Serial.print("] Buzzer completion failed. Error: ");
    Serial.println(http.errorToString(httpCode).c_str());
  }
  http.end();
}

void deactivateBuzzer() {
  buzzerActive = false;
  buzzerRequestId = "";
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.print("[");
  Serial.print(millis());
  Serial.println("] Buzzer deactivated");
}

// --- Network Functions ---
void connectToWifi() {
  Serial.print("Connecting to WiFi ");
  Serial.print(config.wifiSsid);
  WiFi.begin(config.wifiSsid, config.wifiPassword);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 30) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nFailed to connect. Please check credentials and restart.");
  }
}

void registerDevice() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String serverUrl = "http://" + String(config.serverIp) + ":" + String(config.serverPort) + "/api/v1/devices/register";
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["id"] = config.deviceId;
  doc["name"] = config.deviceName;
  doc["type"] = config.deviceType;
  doc["ipAddress"] = WiFi.localIP().toString();

  JsonArray caps = doc["capabilities"].to<JsonArray>();
  caps.add("temperature");
  caps.add("humidity");
  caps.add("distance");
  caps.add("lightLevel");

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  int httpCode = http.POST(jsonPayload);
  Serial.print("Registering device... ");
  if (httpCode > 0) {
    Serial.printf("Response: %d\n", httpCode);
    deviceRegistered = true;
  } else {
    Serial.printf("Error: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED || !deviceRegistered) return;

  // Create JSON payload
  JsonDocument doc;
  doc["deviceId"] = config.deviceId;
  doc["timestamp"] = millis();
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["distance"] = distance;
  doc["lightLevel"] = lightLevel;

  String jsonPayload;
  serializeJson(doc, jsonPayload);
  Serial.print("[");
  Serial.print(millis());
  Serial.print("] Sending payload: ");
  Serial.println(jsonPayload);

  // Send HTTP POST request
  HTTPClient http;
  String serverUrl = "http://" + String(config.serverIp) + ":" + String(config.serverPort) + "/api/v1/ingest/sensor-data";
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonPayload);
  if (httpResponseCode > 0) {
    Serial.print("[");
    Serial.print(millis());
    Serial.print("] Sensor data sent. HTTP Response: ");
    Serial.println(httpResponseCode);
    
    // Log response payload if available
    String responsePayload = http.getString();
    if (responsePayload.length() > 0) {
      Serial.print("[");
      Serial.print(millis());
      Serial.print("] Server response: ");
      Serial.println(responsePayload);
    }
  } else {
    Serial.print("[");
    Serial.print(millis());
    Serial.print("] Error sending sensor data. Code: ");
    Serial.println(http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}