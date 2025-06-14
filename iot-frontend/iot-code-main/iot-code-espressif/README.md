# ESP32-S3 High-Performance Camera Streaming Project

This project implements a high-performance camera streaming solution for ESP32-S3 using ESP-IDF, optimized for maximum performance and dual-core utilization.

## Features

### Performance Optimizations
- **Dual-Core Architecture**: 
  - Core 0: WiFi, HTTP communication, and system monitoring
  - Core 1: Camera capture, image processing, and frame management
- **Advanced Memory Management**: 
  - PSRAM optimization for large frame buffers
  - Triple buffering for smooth operation
  - Efficient DMA usage
- **Hardware Acceleration**: 
  - Hardware JPEG compression
  - Optimized camera sensor configuration for OV5640
- **Real-time Performance**: 
  - Precise 10 FPS frame rate control
  - Non-blocking frame transmission
  - Advanced performance monitoring

### ESP32-S3 Specific Features
- Full PSRAM utilization (up to 8MB)
- 240MHz CPU frequency
- Optimized cache configuration
- Advanced power management
- Hardware-accelerated image processing

## Hardware Requirements

### ESP32-S3 Module
- ESP32-S3 with PSRAM (recommended: ESP32-S3-DevKitC-1)
- OV5640 camera module
- Stable 3.3V power supply (minimum 1A)

### Pin Configuration (OV5640)
```
Pin Assignment:
- XCLK:  GPIO 15
- SIOD:  GPIO 4  (SDA)
- SIOC:  GPIO 5  (SCL)
- Y9:    GPIO 16 (D7)
- Y8:    GPIO 17 (D6)
- Y7:    GPIO 18 (D5)
- Y6:    GPIO 12 (D4)
- Y5:    GPIO 10 (D3)
- Y4:    GPIO 8  (D2)
- Y3:    GPIO 9  (D1)
- Y2:    GPIO 11 (D0)
- VSYNC: GPIO 6
- HREF:  GPIO 7
- PCLK:  GPIO 13
```

## Software Requirements

### ESP-IDF Setup
1. Install ESP-IDF v5.0 or later
2. Set up the ESP-IDF environment
3. Configure the toolchain for ESP32-S3

### Dependencies
- esp_camera component
- esp_wifi
- esp_http_client
- freertos
- All dependencies are included in ESP-IDF

## Configuration

### WiFi Settings
Edit the following in `main/iot_camera_stream_espressif.c`:
```c
#define WIFI_SSID               "YOUR_WIFI_SSID"
#define WIFI_PASSWORD           "YOUR_WIFI_PASSWORD"
#define SERVER_URL              "http://YOUR_BACKEND_IP:3000/api/v1/stream/stream"
```

### Performance Tuning
Key parameters in the source code:
```c
#define TARGET_FPS              10          // Target frame rate
#define FRAME_BUFFER_COUNT      3           // Triple buffering
#define JPEG_QUALITY            12          // JPEG quality (1-63)
#define HTTP_BUFFER_SIZE        (64 * 1024) // HTTP buffer size
```

## Building and Flashing

### Build Commands
```bash
# Set up ESP-IDF environment
. $IDF_PATH/export.sh

# Configure the project
idf.py set-target esp32s3
idf.py menuconfig

# Build the project
idf.py build

# Flash to device
idf.py -p /dev/ttyUSB0 flash monitor
```

### Windows Commands
```cmd
# Set up ESP-IDF environment
%IDF_PATH%\export.bat

# Configure and build
idf.py set-target esp32s3
idf.py build
idf.py -p COM3 flash monitor
```

## Performance Characteristics

### Expected Performance
- **Frame Rate**: Stable 10 FPS
- **Resolution**: VGA (640x480)
- **Latency**: <100ms end-to-end
- **Memory Usage**: 
  - Heap: ~200KB
  - PSRAM: ~2MB for frame buffers
- **Power Consumption**: ~300mA @ 3.3V

### Monitoring
The system provides real-time monitoring:
- Frame statistics (sent/failed)
- Memory usage (heap/PSRAM)
- Network connectivity status
- Average frame rate
- System uptime

## Troubleshooting

### Common Issues

1. **Camera Initialization Failed**
   - Check pin connections
   - Verify power supply stability
   - Ensure OV5640 is properly connected

2. **WiFi Connection Issues**
   - Verify SSID and password
   - Check signal strength
   - Ensure 2.4GHz network

3. **Low Frame Rate**
   - Check network bandwidth
   - Monitor memory usage
   - Verify backend server performance

4. **Memory Issues**
   - Ensure PSRAM is properly initialized
   - Check for memory leaks
   - Monitor free heap/PSRAM

### Debug Commands
```bash
# Monitor with detailed logging
idf.py monitor --print_filter="*:V"

# Check memory usage
idf.py monitor --print_filter="ESP32S3_CAM:I"

# Network debugging
idf.py monitor --print_filter="wifi:D,esp_netif:D"
```

## Integration with Backend

This ESP-IDF project is designed to work with the Fastify backend server. The camera sends JPEG frames via HTTP POST to the `/api/v1/stream/stream` endpoint using multipart/form-data format.

### Backend Integration
- Frames are sent as multipart form data
- Field name: "image"
- Content-Type: image/jpeg
- Target endpoint: `/api/v1/stream/stream`

## File Structure

```
iot-code-espressif/
├── CMakeLists.txt              # Main CMake configuration
├── sdkconfig.defaults          # Default ESP-IDF configuration
├── README.md                   # This file
└── main/
    ├── CMakeLists.txt          # Main component CMake
    └── iot_camera_stream_espressif.c  # Main application code
```

## License

This project is part of the IoT Video Streaming Application suite.

## Performance Optimization Notes

### Dual-Core Strategy
- **Core 0**: Handles all network operations, HTTP client, WiFi management, and system monitoring
- **Core 1**: Dedicated to camera operations, frame capture, and image processing

### Memory Management
- Uses PSRAM for frame buffers to free up internal RAM
- Implements triple buffering for smooth frame capture
- Efficient HTTP chunked transfer for large images

### Network Optimization
- Disabled WiFi power saving for maximum throughput
- Optimized HTTP client with large buffers
- Non-blocking frame transmission with queue system

### Camera Optimization
- Advanced OV5640 sensor configuration
- Hardware JPEG compression
- Optimized timing and clock settings
- Automatic exposure and white balance tuning
