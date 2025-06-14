# ESP32-S3 Camera Module

This firmware implements a high-performance camera streaming system optimized for ESP32-S3 dual-core architecture. It captures video frames and streams them to the backend server while communicating with the master coordinator.

## Features

- **High-Performance Streaming**: Optimized for ESP32-S3 dual-core architecture
- **Multi-Format Support**: JPEG compression with adjustable quality
- **Real-time Communication**: UDP communication with master coordinator
- **Backend Integration**: HTTP streaming to backend server
- **Advanced Controls**: Remote camera control and configuration
- **Status Monitoring**: Real-time performance metrics and health monitoring
- **PSRAM Optimization**: Utilizes external PSRAM for frame buffering

## Hardware Requirements

- ESP32-S3 DevKit with PSRAM (8MB recommended)
- OV5640 Camera Module
- MicroSD card (optional, for local recording)
- Status LEDs (optional)

## Pin Configuration (OV5640)

The firmware uses the standard OV5640 pin configuration:

- **XCLK**: GPIO15 (Camera clock)
- **SIOD**: GPIO4 (I2C data)
- **SIOC**: GPIO5 (I2C clock)
- **VSYNC**: GPIO6 (Vertical sync)
- **HREF**: GPIO7 (Horizontal reference)
- **PCLK**: GPIO13 (Pixel clock)
- **Data pins**: GPIO8-12, GPIO16-18

## Building and Flashing

1. Install ESP-IDF v4.4 or later
2. Update WiFi credentials in `../common/iot_system_config.h`
3. Configure camera settings if needed
4. Build and flash:

```bash
cd esp32-camera
idf.py build
idf.py flash monitor
```

## Performance Optimization

### Dual-Core Architecture
- **Core 0**: Network communication and command processing
- **Core 1**: Camera capture, image processing, and streaming

### Memory Management
- **PSRAM**: Frame buffers stored in external PSRAM
- **Triple Buffering**: Reduces frame drops and improves performance
- **Dynamic Quality**: Adjusts JPEG quality based on network conditions

### Network Optimization
- **Async HTTP**: Non-blocking HTTP requests for frame streaming
- **UDP Communication**: Low-latency command communication
- **Frame Queue**: Buffered frame transmission

## Camera Configuration

### Image Settings
- **Resolution**: VGA (640x480) default, configurable up to UXGA
- **Frame Rate**: 10 FPS default, adjustable 1-30 FPS
- **JPEG Quality**: 12 default (1-63, lower = better quality)
- **Pixel Format**: JPEG compression for optimal bandwidth

### Advanced Settings
- **Auto Exposure**: Automatic exposure control
- **Auto White Balance**: Automatic color correction
- **Brightness/Contrast/Saturation**: Manual adjustment support

## Communication Protocol

### Supported Commands

- `CMD_CAM_START_STREAM`: Start video streaming
- `CMD_CAM_STOP_STREAM`: Stop video streaming
- `CMD_CAM_TAKE_PHOTO`: Capture single photo
- `CMD_CAM_RECORD_START`: Start recording session
- `CMD_CAM_RECORD_STOP`: Stop recording session
- `CMD_CAM_ADJUST_QUALITY`: Change JPEG quality
- `CMD_PING`: Heartbeat/status ping
- `CMD_STATUS_REQUEST`: Request detailed status
- `CMD_REBOOT`: Remote device restart

### Status Reporting

The camera reports comprehensive status in JSON format:

```json
{
  "device": {
    "device_id": 1,
    "device_name": "ESP32S3-Camera",
    "status": 1,
    "free_heap": 123456,
    "uptime": 3600
  },
  "camera": {
    "streaming": true,
    "recording": false,
    "frames_captured": 36000,
    "frames_sent": 35950,
    "frames_failed": 50,
    "current_fps": 9.8,
    "total_data_sent": 52428800,
    "quality": 12
  }
}
```

## Network Configuration

### Backend Streaming
- **Protocol**: HTTP POST multipart/form-data
- **Endpoint**: `/api/v1/stream/stream`
- **Format**: JPEG frames with metadata
- **Retry Logic**: Automatic retry on failures

### Master Communication
- **Protocol**: UDP
- **Port**: 8002 (camera), 8001 (master)
- **Format**: Custom IoT protocol with headers
- **Heartbeat**: 30-second intervals

## Monitoring and Diagnostics

### Performance Metrics
- **Frame Rate**: Real-time FPS calculation
- **Success Rate**: Frame capture/transmission success ratio
- **Data Throughput**: Total bytes transmitted
- **Memory Usage**: Heap and PSRAM utilization

### Health Monitoring
- **Sensor Temperature**: Camera sensor temperature monitoring
- **Network Connectivity**: WiFi signal strength and stability
- **Error Tracking**: Comprehensive error logging and recovery

### Debug Features
- **Serial Logging**: Detailed operation logs
- **Frame Statistics**: Per-frame timing and size metrics
- **Network Analysis**: Connection status and latency monitoring

## Error Handling and Recovery

### Automatic Recovery
- **Network Reconnection**: Automatic WiFi reconnection
- **Camera Reset**: Sensor reset on capture failures
- **Buffer Management**: Automatic buffer cleanup and recovery
- **Watchdog Protection**: System restart on critical failures

### Error Codes
- **Camera Errors**: Sensor initialization and capture failures
- **Network Errors**: Communication timeouts and connection issues
- **Memory Errors**: Buffer allocation and PSRAM failures
- **Protocol Errors**: Message validation and parsing errors

## Power Management

### Optimization Features
- **Dynamic Clock Scaling**: Adjusts CPU frequency based on load
- **Sleep Modes**: Enters light sleep during idle periods
- **Power Monitoring**: Tracks current consumption and efficiency

### Battery Operation
- **Low Power Mode**: Reduced frame rate and quality for battery operation
- **Sleep Scheduling**: Configurable sleep periods for power conservation
- **Voltage Monitoring**: Battery level tracking and alerts

## Security Features

### Data Protection
- **Frame Encryption**: Optional JPEG frame encryption
- **Secure Communication**: TLS support for backend communication
- **Device Authentication**: Certificate-based device authentication

### Access Control
- **Command Validation**: Validates incoming commands and parameters
- **Rate Limiting**: Prevents command flooding and abuse
- **Secure Boot**: Optional secure boot for firmware integrity

## Integration with Backend

The camera seamlessly integrates with the Fastify backend:

- **Live Streaming**: Real-time frame transmission for live viewing
- **Recording Sessions**: Coordinated recording with metadata
- **Remote Control**: Full camera control via backend API
- **Status Synchronization**: Real-time status updates and monitoring

## Development and Testing

### Local Development
```bash
# Monitor serial output
idf.py monitor

# Flash and monitor in one command
idf.py flash monitor

# Clean build
idf.py fullclean build
```

### Performance Testing
```bash
# Test frame rate
curl -X POST http://192.168.1.101:3000/api/v1/control/command \
  -H "Content-Type: application/json" \
  -d '{"device_id": 1, "command": 16}'

# Monitor network traffic
wireshark -i wlan0 -f "host 192.168.1.101"
```

### Troubleshooting

Common issues and solutions:

1. **Camera initialization fails**: Check pin connections and power supply
2. **Low frame rate**: Verify WiFi signal strength and backend performance
3. **Memory errors**: Ensure PSRAM is properly configured and connected
4. **Network timeouts**: Check firewall settings and network connectivity
