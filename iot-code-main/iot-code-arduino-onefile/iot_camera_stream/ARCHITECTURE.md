# ESP32-S3 Camera - 5-File Modular Architecture

## 📁 **New File Structure**

The ESP32-S3 camera project has been refactored into 5 clean, modular files following best practices:

```
iot_camera_stream/
├── 📄 iot_camera_stream.ino     # Main program logic
├── 📄 config.h                  # Configuration constants
├── 📄 globals.h                 # Global variables & declarations
├── 📄 wifi_manager.h            # WiFi management header
├── 📄 wifi_manager.cpp          # WiFi implementation
├── 📄 camera_manager.h          # Camera operations header
└── 📄 camera_manager.cpp        # Camera implementation
```

## 🎯 **Architecture Benefits**

### ✅ **Separation of Concerns**
- **Configuration**: All constants in one place
- **WiFi Logic**: Isolated network management
- **Camera Logic**: Dedicated camera operations
- **Main Program**: Clean setup/loop logic

### ✅ **Easy to Read & Maintain**
- **Small file sizes** (50-200 lines each)
- **Clear function organization**
- **Proper header/implementation separation**
- **Comprehensive documentation**

### ✅ **Professional Structure**
- **Industry standard** .h/.cpp pattern
- **Proper include guards**
- **Clean extern declarations**
- **Modular compilation**

## 📋 **File Descriptions**

### 1. `config.h` - Configuration Hub
**Purpose**: All configuration constants and compile-time settings
**Size**: ~100 lines
**Contains**:
- WiFi credentials and server URLs
- Pin definitions for ESP32-S3 + OV5640
- Performance settings (FPS, quality, timeouts)
- Debug configuration options

```cpp
#define WIFI_SSID "BIZNET357"
#define TARGET_FPS 30
#define JPEG_QUALITY_PSRAM 6
```

### 2. `globals.h` - Global Declarations
**Purpose**: Global variables and extern declarations
**Size**: ~50 lines
**Contains**:
- HTTP client objects
- Performance tracking variables
- Timing variables
- Function prototypes

```cpp
extern HTTPClient http;
extern uint32_t frameCount;
extern bool deviceRegistered;
```

### 3. `wifi_manager.h/.cpp` - Network Management
**Purpose**: WiFi connection, server communication, device management
**Size**: ~150 lines each
**Functions**:
- `initWiFi()` - Network initialization with scanning
- `checkWiFiConnection()` - Auto-reconnection logic
- `testServerConnectivity()` - Server health checks
- `registerDevice()` / `sendHeartbeat()` - Device lifecycle

### 4. `camera_manager.h/.cpp` - Camera Operations
**Purpose**: Camera initialization, frame capture, and upload
**Size**: ~200 lines each
**Functions**:
- `initCamera()` - OV5640 setup with PSRAM optimization
- `captureAndSendFrame()` - Main capture loop
- `sendFrameWithRetry()` - Upload with retry logic and fallbacks
- `sendFrameToURL()` - HTTP multipart upload

### 5. `iot_camera_stream.ino` - Main Program
**Purpose**: Setup, main loop, and performance monitoring
**Size**: ~150 lines
**Contains**:
- Global variable definitions
- System initialization
- Main event loop
- Performance statistics

## 🔧 **Compilation & Upload**

### Arduino IDE Settings:
```
Board: ESP32S3 Dev Module
CPU Frequency: 240MHz (WiFi/BT)
PSRAM: OPI PSRAM
Partition Scheme: Huge APP (3MB No OTA/1MB SPIFFS)
```

### Build Process:
1. Arduino IDE automatically compiles all .cpp files
2. Headers are included via #include statements
3. No additional configuration needed

## 🚀 **Key Features Maintained**

### ✅ **Performance Optimizations**
- 720p @ 30 FPS target with PSRAM
- Progressive retry logic (5s → 3s → 1s timeouts)
- Fallback server support (httpbin.org)
- Memory-efficient frame handling

### ✅ **Robust Error Handling**
- WiFi auto-reconnection
- Server connectivity testing
- Detailed HTTP error reporting
- Graceful degradation

### ✅ **Real-time Monitoring**
- Performance statistics every 5 seconds
- Frame success/drop tracking
- Memory usage monitoring
- Network quality reporting

## 📊 **Performance Benefits**

| Metric | Before (3 files) | After (5 files) |
|--------|------------------|-----------------|
| **Largest file** | 483 lines | 200 lines |
| **Maintainability** | Moderate | Excellent |
| **Readability** | Good | Excellent |
| **Modularity** | Basic | Professional |
| **Compilation** | Monolithic | Modular |

## 🛠️ **Development Workflow**

### **Adding New Features:**
1. **WiFi features** → Modify `wifi_manager.h/.cpp`
2. **Camera features** → Modify `camera_manager.h/.cpp`
3. **Configuration** → Update `config.h`
4. **Main logic** → Edit `iot_camera_stream.ino`

### **Configuration Changes:**
1. Edit `config.h` for constants
2. No need to touch implementation files
3. Clean separation of settings and logic

### **Debugging:**
1. Enable debug flags in `config.h`
2. Each module has isolated logging
3. Easy to trace issues to specific components

## 🔍 **Code Quality Improvements**

### **Before (Monolithic)**:
```cpp
// Everything mixed together in camera_network.h
void initWiFi() { ... }
void initCamera() { ... }
bool sendFrame() { ... }
bool registerDevice() { ... }
// 483 lines of mixed functionality
```

### **After (Modular)**:
```cpp
// wifi_manager.cpp - WiFi focus
void initWiFi() { ... }
void checkWiFiConnection() { ... }

// camera_manager.cpp - Camera focus  
void initCamera() { ... }
void captureAndSendFrame() { ... }
```

## 📝 **Usage Instructions**

### **Quick Start:**
1. Open `iot_camera_stream.ino` in Arduino IDE
2. Configure WiFi in `config.h`
3. Select ESP32-S3 board settings
4. Compile and upload

### **Customization:**
- **Change servers**: Edit URLs in `config.h`
- **Adjust performance**: Modify FPS/quality in `config.h`
- **Add features**: Extend appropriate manager files

### **Troubleshooting:**
- Check Serial Monitor for detailed error messages
- Each module logs its operations clearly
- Performance stats show exactly what's happening

## ✅ **Verification Checklist**

- ✅ All files compile without errors
- ✅ Proper include dependencies
- ✅ Clean extern declarations
- ✅ No circular dependencies
- ✅ Maintained all original functionality
- ✅ Improved readability and maintainability
- ✅ Professional code organization

The refactored code is now **production-ready** with excellent modularity, maintainability, and follows ESP32 development best practices! 🎉
