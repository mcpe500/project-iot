// Buzzer, HC-SR04, DHT11, LDR Sensor and LCD Display Control for ESP32
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


void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.begin(115200);  // Initialize serial for debugging
  
  // Start sensors and display
  dht.begin();
  u8g2.begin();

  // Display a startup message
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB10_tr); // Choose a font
  u8g2.drawStr(10, 36, "System Starting...");
  u8g2.sendBuffer();
  delay(2000);
}

void loop() {
  unsigned long currentMillis = millis();
  
  // Handle sensor reading (non-blocking)
  if (currentMillis - lastSensorRead >= sensorInterval) {
    readSensors(); // This will update global sensor variables
    updateDisplay(); // This will use global sensor variables
    lastSensorRead = currentMillis;
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