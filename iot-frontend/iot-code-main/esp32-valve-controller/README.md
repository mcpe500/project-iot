# ESP32 Valve Controller

This firmware implements a valve controller for the IoT video streaming system. It controls a solenoid valve via relay and communicates with the master coordinator and backend server.

## Features

- **Valve Control**: Open/close valve operations with relay control
- **Position Feedback**: Optional position sensor support
- **Auto-close**: Automatic valve closing after configurable timeout
- **Emergency Stop**: Hardware emergency button for immediate valve closure
- **Status Monitoring**: Real-time status reporting and LED indicators
- **Network Communication**: UDP communication with master coordinator
- **Backend Integration**: HTTP status reporting to backend server

## Hardware Requirements

- ESP32 DevKit (any variant)
- Relay module (5V/12V compatible)
- Solenoid valve
- Status LED
- Emergency button (normally open)
- Optional: Position feedback sensor

## Pin Configuration

- GPIO2: Relay control output
- GPIO4: Position feedback input (optional)
- GPIO5: Status LED output
- GPIO0: Emergency button input (with pull-up)

## Building and Flashing

1. Install ESP-IDF v4.4 or later
2. Update WiFi credentials in `../common/iot_system_config.h`
3. Build and flash:

```bash
cd esp32-valve-controller
idf.py build
idf.py flash monitor
```

## Configuration

The valve controller can be configured through the common configuration file:

- **Auto-close timeout**: Configure automatic valve closing
- **Operation timing**: Set open/close operation durations
- **Communication ports**: UDP ports for device communication
- **Backend endpoints**: HTTP endpoints for status reporting

## Communication Protocol

The device communicates using the IoT system protocol defined in `iot_system_config.h`:

### Supported Commands

- `CMD_VALVE_OPEN`: Open the valve
- `CMD_VALVE_CLOSE`: Close the valve
- `CMD_VALVE_TOGGLE`: Toggle valve state
- `CMD_VALVE_SET_POSITION`: Set valve position (0-100%)
- `CMD_VALVE_GET_STATUS`: Request current status
- `CMD_VALVE_EMERGENCY_STOP`: Emergency stop activation
- `CMD_PING`: Heartbeat/ping command
- `CMD_STATUS_REQUEST`: Request full status report
- `CMD_REBOOT`: Remote reboot command

### Status Reporting

The device reports status in JSON format:

```json
{
  "device": {
    "device_id": 2,
    "device_name": "ESP32-Valve",
    "status": 1,
    "free_heap": 12345,
    "uptime": 3600
  },
  "valve": {
    "state": 1,
    "position": 100,
    "target_position": 100,
    "operation_count": 42,
    "emergency_stop": false
  }
}
```

## Safety Features

- **Emergency Stop**: Hardware button for immediate valve closure
- **Auto-close**: Prevents valve from staying open indefinitely
- **State Monitoring**: Continuous monitoring of valve state
- **Error Handling**: Graceful error handling and recovery
- **Watchdog Protection**: System restart on critical failures

## LED Status Indicators

- **Solid ON**: Valve is open
- **Solid OFF**: Valve is closed
- **Slow Blink**: Valve operating (opening/closing)
- **Fast Blink**: Error condition

## Power Requirements

- Input voltage: 3.3V (ESP32) + relay voltage (5V/12V)
- Current consumption: ~200mA (ESP32) + relay current
- Recommended power supply: 12V/2A for valve operations
