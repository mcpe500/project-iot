// Buzzer, HC-SR04, DHT11, LDR Sensor and LCD Display Control for ESP32
// WITH IoT Backend Integration

#include <Preferences.h>

// Network Libraries
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Persistent storage for configuration
Preferences preferences;

// =================================================================
// --- CONFIGURATION STRUCTURE ---
struct Config {
  char ssid[32];
  char password[64];
  char serverIp[16];
  int serverPort;
  char deviceId[32];
  char deviceName[32];
  char deviceType[32];
};

Config config;

// Default configuration values
const Config defaultConfig = {
  "YOUR_WIFI_SSID",
  "YOUR_WIFI_PASSWORD",
  "203.175.11.145",
  9005,
  "esp32-multi-sensor-1",
  "Lab Sensor Unit",
  "DHT11-LDR-HCSR04"
};

// Timing intervals
const unsigned long sensorInterval = 2000;  // Read sensors every 2 seconds
const unsigned long sendInterval = 15000;   // Send data every 15 seconds
unsigned long lastSendMillis = 0;
bool deviceRegistered = false;
// =================================================================

// Hardware pin definitions
#define BUZZER_PIN 25
#define TRIG_PIN 19
#define ECHO_PIN 18
#define DHT_PIN 23
#define DHT_TYPE DHT11
#define LDR_PIN 32

// LCD Display (Software SPI)
#define LCD_SCK_PIN  2  // E on LCD
#define LCD_MOSI_PIN 4  // R/W on LCD
#define LCD_CS_PIN   5  // RS on LCD
#define LCD_RST_PIN  15 // RST on LCD

#include <DHT.h>  // Include DHT library
#include <U8g2lib.h>  // Include U8g2 library for LCD

// State machine states
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

// Initialize U8g2 for ST7920 in SPI Mode
U8G2_ST7920_128X64_1_SW_SPI u8g2(U8G2_R0, /* clock=*/ LCD_SCK_PIN, /* data=*/ LCD_MOSI_PIN, /* cs=*/ LCD_CS_PIN, /* reset=*/ LCD_RST_PIN);

// Buzzer enable/disable flag (set to false to mute buzzer)
bool buzzerEnabled = false;

// Global sensor variables for display
float distance = 0.0;
float temperature = 0.0;
float humidity = 0.0;
int lightLevel = 0;

// Function declarations (prototypes)
void readSensors();
void updateDisplay();
float readDistanceSensor();


// Configuration functions
void loadConfig() {
  preferences.begin("config", false);
  
  // Load configuration or use defaults
  strlcpy(config.ssid, preferences.getString("ssid", defaultConfig.ssid).c_str(), sizeof(config.ssid));
  strlcpy(config.password, preferences.getString("password", defaultConfig.password).c_str(), sizeof(config.password));
  strlcpy(config.serverIp, preferences.getString("serverIp", defaultConfig.serverIp).c_str(), sizeof(config.serverIp));
  config.serverPort = preferences.getInt("serverPort", defaultConfig.serverPort);
  strlcpy(config.deviceId, preferences.getString("deviceId", defaultConfig.deviceId).c_str(), sizeof(config.deviceId));
  strlcpy(config.deviceName, preferences.getString("deviceName", defaultConfig.deviceName).c_str(), sizeof(config.deviceName));
  strlcpy(config.deviceType, preferences.getString("deviceType", defaultConfig.deviceType).c_str(), sizeof(config.deviceType));
  
  preferences.end();
}

void saveConfig() {
  preferences.begin("config", false);
  
  preferences.putString("ssid", config.ssid);
  preferences.putString("password", config.password);
  preferences.putString("serverIp", config.serverIp);
  preferences.putInt("serverPort", config.serverPort);
  preferences.putString("deviceId", config.deviceId);
  preferences.putString("deviceName", config.deviceName);
  preferences.putString("deviceType", config.deviceType);
  
  preferences.end();
}

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.begin(115200);  // Initialize serial for debugging

  // Load configuration
  loadConfig();
  
  // Start sensors and display
  dht.begin();
  u8g2.begin();

  // Display a startup message
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB10_tr); // Choose a font
  u8g2.drawStr(10, 36, "System Starting...");
  u8g2.sendBuffer();
  
  // Connect to WiFi
  connectToWifi();
  
  // Register device with backend
  registerDevice();
  
  delay(2000);
}

void loop() {
  unsigned long currentMillis = millis();
  
  // Check for configuration updates
  checkForConfigUpdate();
  
  // Handle sensor reading (non-blocking)
  if (currentMillis - lastSensorRead >= sensorInterval) {
    readSensors(); // This will update global sensor variables
    updateDisplay(); // This will use global sensor variables
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

// Read all sensors
void readSensors() {
  // Read and print distance
  distance = readDistanceSensor(); // Assign to global variable
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");
  
  // Read and print temperature and humidity
  temperature = dht.readTemperature(); // Assign to global variable
  humidity = dht.readHumidity();    // Assign to global variable
  
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
  
  // Read and print light level
  lightLevel = analogRead(LDR_PIN); // Assign to global variable
  Serial.print("Light Level: ");
  Serial.println(lightLevel);
}

// Update LCD display with sensor data
void updateDisplay() {
  char buffer[16]; // A small buffer to format strings

  u8g2.clearBuffer();                 // Clear the internal memory
  u8g2.setFont(u8g2_font_ncenB08_tr); // Set a nice, readable font

  // Display Distance
  sprintf(buffer, "Dist: %.1f cm", distance);
  u8g2.drawStr(0, 12, buffer);

  // Display Temperature
  sprintf(buffer, "Temp: %.1f C", temperature);
  u8g2.drawStr(0, 28, buffer);
  
  // Display Humidity
  sprintf(buffer, "Humi: %.1f %%", humidity);
  u8g2.drawStr(0, 44, buffer);

  // Display Light Level
  sprintf(buffer, "Light: %d", lightLevel);
  u8g2.drawStr(0, 60, buffer);
  
  u8g2.sendBuffer(); // Transfer the internal memory to the display
}

// Network functions
void checkForConfigUpdate() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    if (input.startsWith("CONFIG:")) {
      // Example: CONFIG:ssid=MyWiFi,password=secret,serverIp=192.168.1.100
      String configStr = input.substring(7);
      int start = 0;
      int end = configStr.indexOf(',');
      
      while (end != -1) {
        String pair = configStr.substring(start, end);
        int equals = pair.indexOf('=');
        if (equals != -1) {
          String key = pair.substring(0, equals);
          String value = pair.substring(equals + 1);
          
          if (key == "ssid") {
            strlcpy(config.ssid, value.c_str(), sizeof(config.ssid));
          } else if (key == "password") {
            strlcpy(config.password, value.c_str(), sizeof(config.password));
          } else if (key == "serverIp") {
            strlcpy(config.serverIp, value.c_str(), sizeof(config.serverIp));
          } else if (key == "serverPort") {
            config.serverPort = value.toInt();
          } else if (key == "deviceId") {
            strlcpy(config.deviceId, value.c_str(), sizeof(config.deviceId));
          } else if (key == "deviceName") {
            strlcpy(config.deviceName, value.c_str(), sizeof(config.deviceName));
          } else if (key == "deviceType") {
            strlcpy(config.deviceType, value.c_str(), sizeof(config.deviceType));
          }
        }
        start = end + 1;
        end = configStr.indexOf(',', start);
      }
      saveConfig();
      Serial.println("Configuration updated successfully");
    }
  }
}

void connectToWifi() {
  Serial.print("Connecting to WiFi ");
  Serial.print(config.ssid);
  WiFi.begin(config.ssid, config.password);
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
  doc["id"] = deviceId;
  doc["name"] = deviceName;
  doc["type"] = deviceType;
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
  Serial.println("Sending payload: " + jsonPayload);

  // Send HTTP POST request
  HTTPClient http;
  String serverUrl = "http://" + String(serverIp) + ":" + String(serverPort) + "/api/v1/ingest/sensor-data";
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  int httpResponseCode = http.POST(jsonPayload);
  if (httpResponseCode > 0) {
    Serial.printf("Sensor data sent. HTTP Response: %d\n", httpResponseCode);
  } else {
    Serial.printf("Error sending sensor data. Code: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}

// Read distance from HC-SR04 sensor
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