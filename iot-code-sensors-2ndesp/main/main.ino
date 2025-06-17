// Buzzer, HC-SR04, and DHT11 Sensor Control for ESP32
#define BUZZER_PIN 25
#define TRIG_PIN 19
#define ECHO_PIN 18
#define DHT_PIN 23
#define DHT_TYPE DHT11

#include <DHT.h>  // Include DHT library

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

// Buzzer enable/disable flag (set to false to mute buzzer)
bool buzzerEnabled = false;

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(BUZZER_PIN, LOW);
  Serial.begin(115200);  // Initialize serial for debugging
  
  dht.begin();  // Start DHT sensor
}

void loop() {
  unsigned long currentMillis = millis();
  
  // Handle sensor reading (non-blocking)
  if (currentMillis - lastSensorRead >= sensorInterval) {
    readSensors();
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
  float distance = readDistanceSensor();
  Serial.print("Distance: ");
  Serial.print(distance);
  Serial.println(" cm");
  
  // Read and print temperature and humidity
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();
  
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