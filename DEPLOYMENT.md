# IoT Multi-ESP System Deployment Guide

This guide covers the complete deployment of the IoT system with 3 ESP32 devices, Fastify backend, and React Native frontend.

## System Overview

The system consists of:
- **ESP32-S3 Camera**: Video streaming and capture
- **ESP32 Valve Controller**: Relay control and automation  
- **ESP32 Master Coordinator**: System orchestration and monitoring
- **Fastify Backend**: Central API and WebSocket server
- **React Native Frontend**: Mobile app for monitoring and control

## Prerequisites

### Hardware Requirements
- 3x ESP32 devices (ESP32-S3 for camera, ESP32 for valve and master)
- OV5640 camera module (for ESP32-S3)
- Relay module (for valve controller)
- Power supplies for all devices
- WiFi network access

### Software Requirements
- ESP-IDF v5.0+ or Arduino IDE 2.x
- Node.js 18+ or Bun 1.0+
- Expo CLI for React Native
- Git

## Backend Deployment

### 1. Clone and Setup
```bash
git clone <repository-url>
cd iot-backend

# Install dependencies
bun install

# Or with npm
npm install
```

### 2. Environment Configuration
```bash
cp .env.example .env
```

Edit `.env` file:
```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Security
JWT_SECRET=your-super-secure-jwt-secret-here
API_KEY=your-api-key-here

# Network
CORS_ORIGIN=http://your-frontend-domain.com,http://localhost:19006

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Logging
LOG_LEVEL=info

# Optional: Database (if not using in-memory)
# DATABASE_URL=postgresql://user:pass@localhost:5432/iot_db

# Optional: AI Features
# GEMINI_API_KEY=your-gemini-api-key
```

### 3. Start Backend Server
```bash
# Development
bun run dev

# Production
bun run start

# With PM2 (recommended for production)
pm2 start ecosystem.config.js
```

### 4. Verify Backend
```bash
curl http://localhost:3000/health
# Should return: {"success":true,"data":{"status":"healthy",...}}
```

## ESP32 Firmware Deployment

### Option A: ESP-IDF (Recommended)

#### 1. Install ESP-IDF
```bash
# Follow official ESP-IDF installation guide
# https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/

# Set up environment
. $HOME/esp/esp-idf/export.sh
```

#### 2. Configure and Build ESP32-S3 Camera
```bash
cd iot-code-main/esp32-camera

# Configure for your board
idf.py menuconfig

# Update WiFi and backend settings in main/camera_main.c
# Set your WiFi SSID/password and backend IP

# Build and flash
idf.py build
idf.py -p /dev/ttyUSB0 flash monitor
```

#### 3. Configure and Build ESP32 Valve Controller
```bash
cd ../esp32-valve-controller

# Configure
idf.py menuconfig

# Update settings in main/valve_controller_main.c
# Set WiFi credentials and backend IP

# Build and flash
idf.py build
idf.py -p /dev/ttyUSB1 flash monitor
```

#### 4. Configure and Build ESP32 Master Coordinator
```bash
cd ../esp32-master-coordinator

# Configure
idf.py menuconfig

# Update settings in main/master_coordinator_main.c
# Set WiFi credentials and backend IP

# Build and flash
idf.py build
idf.py -p /dev/ttyUSB2 flash monitor
```

### Option B: Arduino IDE

#### 1. Setup Arduino IDE
- Install ESP32 board support
- Install required libraries:
  - WiFi
  - HTTPClient
  - ArduinoJson
  - ESP32 Camera (for camera device)

#### 2. Upload Firmware
- Open respective `.ino` files from `iot-code-arduino-onefile/`
- Update WiFi credentials and backend IP in each file
- Select correct board and port
- Upload to each ESP32

## React Native Frontend Deployment

### 1. Setup Environment
```bash
cd iot-frontend

# Install dependencies
npm install

# Install Expo CLI if not already installed
npm install -g @expo/cli
```

### 2. Configure Backend Connection
Edit `app/config.ts`:
```typescript
export const CONFIG = {
  // Update with your backend server IP
  BACKEND_URL: 'http://YOUR_BACKEND_IP:3000',
  WS_URL: 'ws://YOUR_BACKEND_IP:3000',
  
  CAMERA_FPS: 10,
  BUFFER_DURATION_SECONDS: 30,
  RECONNECT_DELAY_MS: 3000,
  REFRESH_TIMEOUT_MS: 5000,
};
```

### 3. Start Development Server
```bash
# Start Expo development server
npx expo start

# For production build
npx expo build:android
# or
npx expo build:ios
```

## Network Configuration

### 1. WiFi Setup
Ensure all ESP32 devices are connected to the same network as the backend server.

### 2. Port Configuration
Default ports:
- Backend: 3000
- React Native Dev: 19006
- WebSocket: 3000 (same as HTTP)

### 3. Firewall Rules
Open necessary ports on your backend server:
```bash
# For Ubuntu/Debian
sudo ufw allow 3000
sudo ufw allow 19006

# For CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --permanent --add-port=19006/tcp
sudo firewall-cmd --reload
```

## Device Configuration

### ESP32-S3 Camera Settings
- Device ID: Format `CAM_XXXXXX` (auto-generated from MAC)
- IP: Static recommended (configure in your router)
- Streaming: 10 FPS, VGA resolution
- Memory: Uses PSRAM for frame buffering

### ESP32 Valve Controller Settings  
- Device ID: Format `VALVE_XXXXXX`
- GPIO: Pin 2 for relay control, Pin 0 for emergency stop
- Auto-close: 30 seconds timeout
- Safety: Emergency stop overrides all commands

### ESP32 Master Coordinator Settings
- Device ID: Format `MASTER_XXXXXX`
- Role: Device discovery and command routing
- Monitoring: Heartbeat every 30 seconds
- Integration: Backend synchronization every 60 seconds

## Testing Deployment

### 1. Backend API Tests
```bash
cd iot-backend

# Run integration tests
bun test

# Test specific endpoints
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/v1/dashboard/data
```

### 2. Device Communication Tests
```bash
# Check device registration
curl -H "X-API-Key: your-api-key" http://localhost:3000/api/v1/devices/devices

# Send test command
curl -X POST -H "Content-Type: application/json" -H "X-API-Key: your-api-key" \
     -d '{"deviceId":"CAM_123456","type":"ping","payload":{}}' \
     http://localhost:3000/api/v1/control/command
```

### 3. WebSocket Connection Test
```bash
# Use wscat to test WebSocket
npm install -g wscat
wscat -c ws://localhost:3000/ws
```

## Production Considerations

### Security
- Change default API keys
- Use HTTPS in production
- Implement device certificates
- Set up VPN for device access

### Monitoring
- Use PM2 for backend process management
- Set up log rotation
- Monitor device heartbeats
- Implement alerting for offline devices

### Performance
- Configure Redis for session storage
- Use load balancer for multiple backend instances
- Optimize ESP32 memory usage
- Monitor network bandwidth

### Backup
- Backup device configurations
- Export sensor data regularly
- Document network topology
- Keep firmware versions tracked

## Troubleshooting

### Common Issues

#### Backend Won't Start
- Check environment variables
- Verify port availability
- Check log files for errors

#### ESP32 Won't Connect
- Verify WiFi credentials
- Check network connectivity
- Monitor serial output for errors
- Verify backend IP address

#### Frontend Can't Connect
- Check backend URL in config
- Verify CORS settings
- Test API endpoints manually
- Check network connectivity

#### WebSocket Issues
- Verify WebSocket URL
- Check firewall settings
- Monitor connection logs
- Test with simple WebSocket client

### Log Locations
- Backend logs: Console output or configured log file
- ESP32 logs: Serial monitor output
- Frontend logs: Browser/Expo dev tools console

## Maintenance

### Regular Tasks
- Update ESP32 firmware monthly
- Rotate API keys quarterly
- Check device battery levels
- Monitor disk space usage
- Review system logs weekly

### Updates
- Test updates in development environment first
- Update devices sequentially, not simultaneously
- Keep rollback firmware versions available
- Document all configuration changes

## Support

For issues and questions:
1. Check device serial output
2. Review backend logs
3. Test API endpoints manually
4. Verify network connectivity
5. Check this documentation

## Architecture Diagram

```
[ESP32-S3 Camera] ←→ [WiFi Network] ←→ [Backend Server]
[ESP32 Valve]     ←→               ←→        ↕
[ESP32 Master]    ←→               ←→  [WebSocket/HTTP]
                                          ↕
                                   [React Native App]
```

This completes the deployment guide for the multi-ESP IoT system.
