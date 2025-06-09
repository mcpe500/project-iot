# ESP32 Master Coordinator

This firmware implements the central coordinator for the IoT video streaming system. It manages communication between all devices, orchestrates system operations, and interfaces with the backend server.

## Features

- **Device Management**: Monitor and control camera and valve devices
- **System Orchestration**: Coordinate operations between devices
- **Backend Integration**: Sync status and receive commands from backend
- **Health Monitoring**: Track device status and system health
- **Command Routing**: Route commands between devices and backend
- **Audio Alerts**: Buzzer notifications for system events
- **Status Indicators**: LED indicators for system and error status
- **Emergency Controls**: Reset button for system recovery

## Hardware Requirements

- ESP32 DevKit (any variant)
- Status LED (green)
- Error LED (red)
- Buzzer/Speaker (passive)
- Reset button (normally open)

## Pin Configuration

- GPIO2: System status LED (green)
- GPIO4: Error status LED (red)
- GPIO5: Buzzer/Speaker output
- GPIO0: Reset button input (with pull-up)

## Building and Flashing

1. Install ESP-IDF v4.4 or later
2. Update WiFi credentials in `../common/iot_system_config.h`
3. Build and flash:

```bash
cd esp32-master-coordinator
idf.py build
idf.py flash monitor
```

## System Architecture

The master coordinator acts as the central hub for the IoT system:

```
Backend Server
     ↕
Master Coordinator ←→ ESP32-S3 Camera
     ↕
ESP32 Valve Controller
```

## Communication Protocol

### Device Discovery
- Broadcasts ping commands to discover devices
- Maintains device registry with status and capabilities
- Monitors device heartbeats and timeouts

### Command Routing
- Receives commands from backend via HTTP/WebSocket
- Routes commands to appropriate devices via UDP
- Aggregates responses and forwards to backend

### Status Monitoring
- Collects status from all devices
- Generates comprehensive system status reports
- Sends periodic updates to backend server

## Supported Commands

### System Commands
- `CMD_PING`: Device discovery and heartbeat
- `CMD_STATUS_REQUEST`: Request comprehensive status
- `CMD_REBOOT`: System restart

### Camera Commands (routed to camera device)
- `CMD_CAM_START_STREAM`: Start video streaming
- `CMD_CAM_STOP_STREAM`: Stop video streaming
- `CMD_CAM_TAKE_PHOTO`: Capture single photo
- `CMD_CAM_RECORD_START`: Start recording
- `CMD_CAM_RECORD_STOP`: Stop recording

### Valve Commands (routed to valve device)
- `CMD_VALVE_OPEN`: Open valve
- `CMD_VALVE_CLOSE`: Close valve
- `CMD_VALVE_TOGGLE`: Toggle valve state
- `CMD_VALVE_SET_POSITION`: Set valve position
- `CMD_VALVE_EMERGENCY_STOP`: Emergency valve closure

## Status Reporting

The coordinator generates comprehensive status reports in JSON format:

```json
{
  "master": {
    "device_id": 3,
    "device_name": "ESP32-Master",
    "status": 1,
    "ip_address": "192.168.1.103",
    "free_heap": 98765,
    "uptime": 7200
  },
  "camera": {
    "device_id": 1,
    "device_name": "ESP32S3-Camera",
    "status": 1,
    "ip_address": "192.168.1.101",
    "last_heartbeat": 1234567890
  },
  "valve": {
    "device_id": 2,
    "device_name": "ESP32-Valve",
    "status": 1,
    "ip_address": "192.168.1.102",
    "last_heartbeat": 1234567890
  },
  "system": {
    "devices_online": 2,
    "devices_total": 3,
    "system_uptime": 7200,
    "total_commands_sent": 1547,
    "total_commands_failed": 3,
    "backend_connected": true,
    "system_load": 25
  }
}
```

## LED Status Indicators

### Status LED (Green)
- **Solid ON**: All devices online and operational
- **Slow Blink**: Some devices offline or connecting
- **OFF**: System startup or critical error

### Error LED (Red)
- **Fast Blink**: Communication errors or device failures
- **Solid ON**: Critical system error
- **OFF**: Normal operation

## Audio Alerts

- **Single Beep**: System startup
- **Double Beep**: Device connected
- **Triple Beep**: Device disconnected
- **Long Beep**: System error or reset

## Configuration

The coordinator uses shared configuration from `../common/iot_system_config.h`:

- **Network Settings**: WiFi credentials and IP addresses
- **Communication Ports**: UDP ports for device communication
- **Timeouts**: Device heartbeat and command timeouts
- **Backend URLs**: API endpoints for backend communication

## Monitoring and Diagnostics

### Device Health Monitoring
- Continuous heartbeat monitoring
- Device timeout detection
- Network connectivity status
- System resource monitoring

### Performance Metrics
- Command success/failure rates
- Response time monitoring
- Memory usage tracking
- Network bandwidth utilization

### Error Handling
- Automatic device rediscovery
- Command retry mechanisms
- Graceful degradation
- System recovery procedures

## Integration with Backend

The coordinator maintains constant communication with the backend server:

- **Status Updates**: Periodic system status reports
- **Command Reception**: Real-time command processing
- **Event Notifications**: Immediate alerts for critical events
- **Configuration Sync**: Dynamic configuration updates

## Security Features

- **Device Authentication**: Verify device identity
- **Command Validation**: Validate incoming commands
- **Rate Limiting**: Prevent command flooding
- **Secure Communication**: Encrypted communication channels

## Development and Debugging

### Serial Logging
Enable detailed logging by setting log level in menuconfig:
```bash
idf.py menuconfig
Component config → Log output → Default log verbosity → Verbose
```

### Network Debugging
Monitor UDP traffic:
```bash
# Linux/Mac
sudo tcpdump -i any udp port 8001

# Windows
netsh trace start capture=yes
```

### Device Discovery
Test device discovery manually:
```bash
# Send UDP broadcast to discover devices
echo -n "PING" | nc -u -b 255.255.255.255 8002
```
