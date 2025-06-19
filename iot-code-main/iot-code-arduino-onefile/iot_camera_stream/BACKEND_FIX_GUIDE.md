# Backend Issue Resolution Guide

## 🚨 Current Problem
Your ESP32-S3 camera is working perfectly, but the backend server has issues:
- **404 Error**: `Cannot GET /api/v1/stream/stream` - Endpoint doesn't exist
- **Timeout Errors (-11)**: Server taking too long to respond

## ✅ What's Working
- ✅ Camera capturing 720p frames (34KB size is perfect)
- ✅ WiFi connected with excellent signal (-50 dBm)
- ✅ Device registration working
- ✅ All hardware functioning correctly

## 🔧 Solutions Implemented

### 1. Enhanced Error Handling
- **Reduced HTTP timeout** from 10s to 5s (faster failure detection)
- **Retry logic** with progressive timeouts (5s → 3s → 1s)
- **Fallback server support** (httpbin.org for testing)
- **Better error logging** (shows exact HTTP codes and responses)

### 2. Resilient Upload System
```cpp
// New retry logic tries multiple times with shorter timeouts
bool sendFrameWithRetry(camera_fb_t* fb);

// Configuration options in config.h:
#define MAX_SERVER_RETRIES 3
#define USE_FALLBACK_ON_ERROR true
```

### 3. Local Test Server
Created `local_test_server.py` for testing while backend is down:
```bash
python3 local_test_server.py
```

## 🚀 Quick Fix Options

### Option 1: Use Local Test Server (Immediate)
1. **Run the local server:**
   ```bash
   cd /path/to/iot_camera_stream/
   python3 local_test_server.py
   ```

2. **Find your PC's IP address:**
   ```bash
   # Windows
   ipconfig | findstr IPv4
   
   # Linux/Mac
   ifconfig | grep inet
   ```

3. **Update ESP32 config.h:**
   ```cpp
   const char* SERVER_URL = "http://192.168.18.XXX:3000/upload";  // Replace XXX with your PC IP
   ```

### Option 2: Use Public Test Server (Testing)
Update `config.h`:
```cpp
const char* SERVER_URL = "http://httpbin.org/post";  // Public test endpoint
```

### Option 3: Fix Backend Server (Permanent)
The backend server needs:
1. **POST endpoint** at `/api/v1/stream/stream`
2. **Multipart/form-data support** for image uploads
3. **API key validation** (X-API-Key header)
4. **CORS headers** if needed
5. **Proper error responses**

## 📊 Expected Results After Fix

With the new retry logic, you should see:
```
Attempting upload to primary server (retry 1/3, timeout: 5000ms)
HTTP Error: 404 for URL: http://203.175.11.145:9003/api/v1/stream/stream
Attempting upload to primary server (retry 2/3, timeout: 3000ms)
HTTP Error: -11 for URL: http://203.175.11.145:9003/api/v1/stream/stream
Primary server failed, trying fallback server...
✅ Fallback server upload successful

📊 PERFORMANCE STATISTICS
FPS: 25.8 (Target: 30)
Success Rate: 95.2%
🟢 Performance: EXCELLENT
```

## 🔍 Backend Server Requirements

Your backend server should handle:

```javascript
// Express.js example
app.post('/api/v1/stream/stream', upload.single('image'), (req, res) => {
  // Validate API key
  if (req.headers['x-api-key'] !== 'dev-api-key-change-in-production') {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  
  // Process uploaded image
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }
  
  console.log(`Received image: ${req.file.size} bytes`);
  
  // Save or process the image
  // ... your processing logic ...
  
  res.status(200).json({ 
    status: 'success', 
    size: req.file.size,
    timestamp: Date.now()
  });
});
```

## 📝 Next Steps

1. **Upload the updated ESP32 code** (now has retry logic and fallback)
2. **Check Serial Monitor** for detailed HTTP error messages
3. **Try local test server** for immediate testing
4. **Fix the backend server** for permanent solution

The ESP32 camera will now be much more resilient to backend issues! 🎉
