# ESP32-S3 OV5640 Camera High-Performance Video Streaming

## Overview

This project provides a highly optimized, modular ESP32-S3 camera streaming solution designed for **720p @ 30 FPS** video streaming with maximum performance and efficiency. The codebase has been carefully split into three modular files for maintainability, efficiency, and best practices.

## 🚀 Key Features

- **High Performance**: Optimized for 720p @ 30 FPS streaming
- **Modular Architecture**: Clean separation of concerns across 3 files
- **PSRAM Optimization**: Automatic detection and optimization for PSRAM
- **Real-time Monitoring**: Comprehensive performance statistics
- **Robust WiFi Management**: Auto-reconnection and signal monitoring
- **Memory Efficient**: Advanced garbage collection and memory management
- **Production Ready**: Device registration, heartbeat, and error handling

## 📁 Project Structure

### Arduino Version (Recommended)
```
iot_camera_stream/
├── iot_camera_stream.ino    # Main program logic and performance monitoring
├── config.h                 # Configuration constants and pin definitions
└── camera_network.h         # Camera and network function implementations
```

### MicroPython Alternative
```
iot-upycraft/iot-camera/
└── main.py                  # Complete MicroPython implementation
```

## 🔧 Hardware Requirements

- **ESP32-S3** development board
- **OV5640** camera module
- **PSRAM** (recommended for 720p streaming)
- Stable 5V power supply (minimum 2A)

## 📋 File Descriptions

### 1. `config.h` - Configuration Management
Contains all configuration constants, pin definitions, and performance settings:

- **Network Configuration**: WiFi credentials and server URLs
- **Camera Pin Mapping**: ESP32-S3 to OV5640 pin assignments
- **Performance Tuning**: FPS targets, quality settings, buffer configurations
- **Debug Settings**: Logging intervals and serial communication settings

**Key Constants:**
```cpp
#define TARGET_FPS 30
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)
#define JPEG_QUALITY_PSRAM 6
#define JPEG_QUALITY_DRAM 12
#define MAX_CPU_FREQ_MHZ 240
```

### 2. `camera_network.h` - Core Functionality
Contains all camera initialization, WiFi management, and HTTP communication functions:

**WiFi Management:**
- `initWiFi()` - Network initialization with diagnostics
- `getWiFiStatusString()` - Human-readable WiFi status

**Camera Functions:**
- `initCamera()` - OV5640 initialization with PSRAM optimization
- `captureAndSendFrame()` - Frame capture and transmission
- `sendFrameToServer()` - HTTP multipart upload with fallback methods

**Device Management:**
- `registerDevice()` - Server registration with capabilities
- `sendHeartbeat()` - Keep-alive and status reporting

### 3. `iot_camera_stream.ino` - Main Program
The streamlined main program containing:

- **Setup Logic**: System initialization and subsystem startup
- **Main Loop**: Frame processing, heartbeat, and monitoring
- **Performance Monitoring**: Real-time statistics and FPS calculation
- **Memory Management**: Garbage collection and watchdog feeding

## ⚙️ Configuration

### WiFi Settings
Edit `config.h`:
```cpp
const char* WIFI_SSID = "Your_WiFi_Name";
const char* WIFI_PASSWORD = "Your_WiFi_Password";
```

### Server Configuration
```cpp
const char* SERVER_URL = "http://your-server.com:9005/api/v1/stream/stream";
const char* API_KEY = "your-api-key-here";
```

### Performance Tuning
For different hardware configurations:

**With PSRAM (Recommended):**
- Frame Size: 720p (HD)
- JPEG Quality: 6 (high quality)
- Frame Buffers: 2 (double buffering)

**Without PSRAM:**
- Frame Size: VGA (640x480)
- JPEG Quality: 12 (moderate quality)
- Frame Buffers: 1 (single buffering)

## 🚀 Quick Start

### Arduino IDE Setup

1. **Install ESP32 Board Package:**
   - Add `https://dl.espressif.com/dl/package_esp32_index.json` to Board Manager URLs
   - Install "ESP32 by Espressif Systems"

2. **Required Libraries:**
   - ESP32 Camera library (usually included)
   - WiFi library (built-in)
   - HTTPClient library (built-in)

3. **Board Configuration:**
   - Board: "ESP32S3 Dev Module"
   - CPU Frequency: "240MHz (WiFi/BT)"
   - PSRAM: "OPI PSRAM" (if available)
   - Partition Scheme: "Huge APP (3MB No OTA/1MB SPIFFS)"

4. **Upload:**
   - Configure your WiFi credentials in `config.h`
   - Select correct COM port
   - Upload the sketch

### MicroPython Setup

1. **Flash MicroPython:**
   ```bash
   esptool.py --chip esp32s3 erase_flash
   esptool.py --chip esp32s3 write_flash -z 0x0 esp32s3-micropython.bin
   ```

2. **Upload Code:**
   - Use Thonny, uPyCraft, or similar IDE
   - Upload `main.py` to the device
   - Configure WiFi credentials in the file

3. **Run:**
   ```python
   import main
   ```

## 📊 Performance Monitoring

The system provides real-time performance statistics every 5 seconds:

```
📊 PERFORMANCE STATISTICS
==================================================
Runtime: 45.123 seconds
FPS: 28.4 (Target: 30)
Frames: Total=1284, Success=1267, Dropped=17
Success Rate: 98.7%
Frame Size: 23.4 KB avg
Throughput: 592.1 KB/s
Memory: Free=234567, PSRAM=4194304 bytes
Network: RSSI=-42 dBm, CPU=240 MHz
🟢 Performance: EXCELLENT
==================================================
```

**Performance Ratings:**
- 🟢 **EXCELLENT**: ≥25 FPS
- 🟡 **GOOD**: 15-24 FPS
- 🟠 **MODERATE**: 8-14 FPS
- 🔴 **NEEDS OPTIMIZATION**: <8 FPS

## 🔧 Troubleshooting

### Common Issues

**Low FPS Performance:**
- Check PSRAM availability and configuration
- Verify stable power supply (2A minimum)
- Reduce JPEG quality if needed
- Check WiFi signal strength (RSSI > -70 dBm)

**Memory Issues:**
- Enable PSRAM in board configuration
- Reduce frame buffer count for DRAM-only systems
- Monitor garbage collection frequency

**Network Problems:**
- Verify WiFi credentials and server accessibility
- Check firewall settings on server
- Monitor network latency and bandwidth

**Camera Initialization Failures:**
- Verify pin connections match `config.h` definitions
- Check camera module power requirements
- Ensure proper grounding and signal integrity

### Debug Mode

Enable verbose logging by modifying intervals in `config.h`:
```cpp
#define FRAME_LOG_INTERVAL 1        // Log every frame
#define FAILURE_LOG_INTERVAL 1      // Log every failure
```

## 🔒 Security Considerations

- Change default API key in production
- Use HTTPS endpoints when possible
- Implement proper authentication on server side
- Consider VPN for sensitive deployments

## 📈 Optimization Tips

### Hardware Optimization:
- Use quality USB-C power supply
- Minimize wire lengths for camera connections
- Ensure adequate cooling for continuous operation
- Use shielded cables in RF-noisy environments

### Software Optimization:
- Fine-tune JPEG quality vs. file size
- Adjust frame buffer count based on available memory
- Optimize network chunk size for your connection
- Balance CPU frequency vs. power consumption

## 📝 API Endpoints

The system communicates with these server endpoints:

**Device Registration:**
```
POST /api/v1/devices/register
Content-Type: application/json
X-API-Key: your-api-key

{
  "deviceId": "ESP32-CAM-001",
  "deviceName": "Camera #1",
  "deviceType": "camera",
  "ipAddress": "192.168.1.100",
  "capabilities": ["streaming", "recording", "capture"]
}
```

**Frame Upload:**
```
POST /api/v1/stream/stream
Content-Type: multipart/form-data
X-API-Key: your-api-key

[Binary JPEG data]
```

**Heartbeat:**
```
POST /api/v1/devices/heartbeat
Content-Type: application/json
X-API-Key: your-api-key

{
  "deviceId": "ESP32-CAM-001",
  "uptime": 45123,
  "freeHeap": 234567,
  "wifiRssi": -42,
  "status": "online"
}
```

## 🤝 Contributing

This modular architecture makes it easy to extend and modify:

- **Add new features**: Extend `camera_network.h` with new functions
- **Modify performance**: Adjust constants in `config.h`
- **Add protocols**: Implement new communication methods
- **Enhance monitoring**: Extend performance statistics

## 📄 License

This project is designed for educational and development purposes. Modify and use according to your needs.

## 🔗 Related Resources

- [ESP32-S3 Technical Reference](https://www.espressif.com/sites/default/files/documentation/esp32-s3_technical_reference_manual_en.pdf)
- [OV5640 Datasheet](https://cdn.sparkfun.com/datasheets/Sensors/LightImaging/OV5640_datasheet.pdf)
- [ESP32 Camera Library Documentation](https://github.com/espressif/esp32-camera)

---

**Author**: Generated for high-performance ESP32-S3 camera streaming  
**Version**: 1.0.0  
**Last Updated**: 2024
