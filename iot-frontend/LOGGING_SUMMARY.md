# Enhanced Logging Summary

## Logging Improvements Added

The frontend now includes comprehensive logging to help debug connection and authentication issues. Here's what was added:

### 🚀 Application Startup Logging
- **App initialization**: Logs backend URL, WebSocket URL, API key status, and timestamp
- **Component cleanup**: Logs when the app is cleaning up resources

### 🔐 API Authentication Logging
- **Request logging**: Every API request logs method, URL, headers, and timeout
- **Response logging**: Success responses log status, URL, data type, and size
- **Error logging**: Detailed error information including status codes, messages, and authentication failures
- **401 errors**: Specific logging for authentication failures with API key comparison

### 🌐 WebSocket Connection Logging
- **Connection setup**: Logs WebSocket URL construction with API key
- **Connection states**: Logs successful connections, errors, and disconnections
- **Message handling**: Logs incoming message types, sizes, and frame counts
- **Authentication**: Logs WebSocket auth messages and responses
- **Close codes**: Explains WebSocket close codes with human-readable meanings
- **Ready states**: Logs WebSocket ready states during errors

### 📱 Device Management Logging
- **Device loading**: Logs API calls, response data, and device processing
- **Camera selection**: Logs available cameras and auto-selection logic
- **Device status**: Logs real-time device updates

### 📊 Stream Statistics Logging
- **FPS tracking**: Periodic logging of stream performance metrics
- **Frame reception**: Logs individual frame arrivals with sizes
- **Quality assessment**: Logs connection quality changes

### 🎥 Recording & Commands Logging
- **Recording operations**: Logs save attempts, responses, and success/failure
- **Camera commands**: Logs command sending with device IDs and responses
- **Error handling**: Detailed error logging for all operations

## Log Message Format

All log messages use emojis for easy visual scanning:
- 🚀 Application lifecycle
- 🔐 Authentication and security
- 🌐 Network connections
- 📱 Device management
- 📊 Statistics and performance
- 🎥 Media operations
- ✅ Success operations
- ❌ Error conditions
- ⚠️ Warning conditions
- 🔄 Retry operations

## Viewing Logs

In development, you can view logs in:
- **Metro Bundler**: Real-time logs in the terminal
- **Browser DevTools**: When running in web mode
- **React Native Debugger**: For detailed debugging
- **Device logs**: Using platform-specific tools

## Production Considerations

For production builds, consider:
1. **Log levels**: Implement different log levels (DEBUG, INFO, WARN, ERROR)
2. **Remote logging**: Send logs to a remote service for monitoring
3. **Performance**: Reduce verbose logging in production
4. **Privacy**: Ensure no sensitive data is logged

## Common Error Patterns to Look For

1. **401 Authentication**: Check if API key is being sent correctly
2. **Network errors**: Check backend server availability
3. **WebSocket 1006**: Usually indicates server connection issues
4. **Empty device list**: Backend may not be returning devices
5. **No frames received**: Check camera streaming status

## Example Log Output

```
🚀 Live Stream App Starting... {backendUrl: "http://203.175.11.145:9005", wsUrl: "ws://203.175.11.145:9005", apiKey: "SET"}
🔐 API Request: GET /api/v1/devices/devices with API key
📊 Devices API response: {success: true, deviceCount: 1, status: 200}
📹 Found 1 online cameras
🎯 Auto-selecting camera: ESP32-CAM-001
🔌 Starting WebSocket connection...
🌐 WebSocket connection details: {...}
✅ WebSocket connected successfully!
🔐 Sending WebSocket auth message: {...}
📨 WebSocket message received: {dataLength: 1024}
🎥 Frame received #1, size: 2048 chars
📊 Stream Stats Update: {fps: 9.8, totalFrames: 98, quality: "excellent"}
```

This enhanced logging will help you quickly identify where connection or authentication issues are occurring.
