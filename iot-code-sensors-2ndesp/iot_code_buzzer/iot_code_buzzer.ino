/*
 * ESP32 Buzzer Control
 * Connection:
 * - GND = GND (Ground)
 * - IO = D25 (Signal/Control pin)
 * - VCC = D23 (Power pin)
 */

// Pin definitions
#define BUZZER_VCC_PIN 23   // Power pin for the buzzer
#define BUZZER_IO_PIN 25    // Signal/Control pin for the buzzer

// Buzzer control variables
bool buzzerEnabled = false;
unsigned long lastBuzzerTime = 0;
int buzzerPattern = 0; // 0=off, 1=single beep, 2=double beep, 3=continuous, 4=alarm pattern

void setup() {
  // Initialize serial communication
  Serial.begin(921600);  // Initialize serial for debugging
  Serial.println("ESP32 Buzzer Controller Starting...");
  
  // Configure buzzer pins
  pinMode(BUZZER_VCC_PIN, OUTPUT);
  pinMode(BUZZER_IO_PIN, OUTPUT);
  
  // Initialize buzzer to OFF state
  buzzerOff();
  
  Serial.println("Buzzer initialized. Send commands:");
  Serial.println("1 - Single beep");
  Serial.println("2 - Double beep");
  Serial.println("3 - Start continuous buzzer");
  Serial.println("4 - Alarm pattern");
  Serial.println("0 - Turn off buzzer");
}

void loop() {
  // Check for serial commands
  if (Serial.available()) {
    char command = Serial.read();
    handleSerialCommand(command);
  }
  
  // Handle buzzer patterns
  handleBuzzerPatterns();
  
  delay(10); // Small delay to prevent excessive CPU usage
}

void handleSerialCommand(char command) {
  switch (command) {
    case '0':
      buzzerOff();
      Serial.println("Buzzer turned OFF");
      break;
    case '1':
      singleBeep();
      Serial.println("Single beep");
      break;
    case '2':
      doubleBeep();
      Serial.println("Double beep");
      break;
    case '3':
      continuousBuzzer();
      Serial.println("Continuous buzzer ON");
      break;
    case '4':
      alarmPattern();
      Serial.println("Alarm pattern started");
      break;
    default:
      Serial.println("Invalid command. Use 0-4");
      break;
  }
}

void buzzerOn() {
  digitalWrite(BUZZER_VCC_PIN, HIGH);  // Power on
  digitalWrite(BUZZER_IO_PIN, HIGH);   // Signal on
  buzzerEnabled = true;
}

void buzzerOff() {
  digitalWrite(BUZZER_VCC_PIN, LOW);   // Power off
  digitalWrite(BUZZER_IO_PIN, LOW);    // Signal off
  buzzerEnabled = false;
  buzzerPattern = 0;
}

void singleBeep() {
  buzzerOn();
  delay(200);
  buzzerOff();
}

void doubleBeep() {
  buzzerOn();
  delay(150);
  buzzerOff();
  delay(100);
  buzzerOn();
  delay(150);
  buzzerOff();
}

void continuousBuzzer() {
  buzzerPattern = 3;
  buzzerOn();
}

void alarmPattern() {
  buzzerPattern = 4;
  lastBuzzerTime = millis();
}

void handleBuzzerPatterns() {
  unsigned long currentTime = millis();
  
  switch (buzzerPattern) {
    case 3: // Continuous buzzer - already handled by keeping it on
      break;
      
    case 4: // Alarm pattern - intermittent beeping
      if (currentTime - lastBuzzerTime >= 500) {
        if (buzzerEnabled) {
          buzzerOff();
        } else {
          buzzerOn();
        }
        lastBuzzerTime = currentTime;
      }
      break;
  }
}

// Additional utility functions for specific use cases
void shortBeep() {
  buzzerOn();
  delay(100);
  buzzerOff();
}

void longBeep() {
  buzzerOn();
  delay(500);
  buzzerOff();
}

void warningBeeps(int count) {
  for (int i = 0; i < count; i++) {
    buzzerOn();
    delay(100);
    buzzerOff();
    delay(100);
  }
}

// Function to create custom tones (if buzzer supports frequency control)
void playTone(int frequency, int duration) {
  digitalWrite(BUZZER_VCC_PIN, HIGH);  // Power on
  tone(BUZZER_IO_PIN, frequency, duration);
  delay(duration);
  noTone(BUZZER_IO_PIN);
  digitalWrite(BUZZER_VCC_PIN, LOW);   // Power off
}

// Play a simple melody
void playMelody() {
  digitalWrite(BUZZER_VCC_PIN, HIGH);  // Power on
  
  // Simple melody notes (frequency, duration)
  int melody[][2] = {
    {262, 200}, // C4
    {294, 200}, // D4
    {330, 200}, // E4
    {349, 200}, // F4
    {392, 400}, // G4
    {0, 0}      // End marker
  };
  
  for (int i = 0; melody[i][0] != 0; i++) {
    tone(BUZZER_IO_PIN, melody[i][0], melody[i][1]);
    delay(melody[i][1] + 50); // Small pause between notes
    noTone(BUZZER_IO_PIN);
  }
  
  digitalWrite(BUZZER_VCC_PIN, LOW);   // Power off
}