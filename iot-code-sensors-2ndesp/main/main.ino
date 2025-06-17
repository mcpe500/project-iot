// Buzzer control for ESP32
#define BUZZER_PIN 25

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

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
}

void loop() {
  unsigned long currentMillis = millis();
  
  switch (currentState) {
    case STATE_BEEP_SHORT:
      digitalWrite(BUZZER_PIN, HIGH);
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
      digitalWrite(BUZZER_PIN, HIGH);
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