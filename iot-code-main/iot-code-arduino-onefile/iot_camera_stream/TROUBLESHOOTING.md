# ESP32-S3 Camera Troubleshooting Guide

## Current Issue: 0% Success Rate with Frame Uploads

### 🔍 **Diagnostic Information**
- ✅ Camera is working (capturing 34KB frames)
- ✅ WiFi is connected (RSSI: -50 dBm - excellent signal)
- ✅ Device registration successful
- ❌ All frame uploads failing (0% success rate)

### 🛠️ **Enhanced Debugging Added**

The code has been updated with enhanced error reporting to help identify the root cause:

1. **HTTP Response Codes**: Now shows detailed HTTP error codes and responses
2. **Server Connectivity Test**: Tests basic connection to server
3. **Simple Upload Test**: Tests HTTP POST with JSON payload
4. **Enhanced Error Logging**: Shows detailed error messages

### 📋 **Troubleshooting Steps**

#### Step 1: Check Server Endpoint
Verify the server URL is correct and accessible:
```
Server URL: http://203.175.11.145:9003/api/v1/stream/stream
```

**Common Issues:**
- Server might be down or unreachable
- Port 9003 might be blocked by firewall
- API endpoint might have changed
- Server might not accept multipart/form-data

#### Step 2: Test Server Manually
Test the server endpoint manually using curl:

```bash
# Test basic connectivity
curl -v http://203.175.11.145:9003/api/v1/stream/stream

# Test with API key
curl -v -H "X-API-Key: dev-api-key-change-in-production" http://203.175.11.145:9003/api/v1/stream/stream

# Test POST with file upload
curl -v -X POST -H "X-API-Key: dev-api-key-change-in-production" \
  -F "image=@test.jpg" \
  http://203.175.11.145:9003/api/v1/stream/stream
```

#### Step 3: Check Network Configuration
- Verify WiFi network allows outbound connections on port 9003
- Check if corporate firewall blocks HTTP traffic
- Try using a mobile hotspot to test

#### Step 4: Server-side Issues
**Possible server problems:**
- Server expecting different content type
- API key validation failing
- Server overloaded or rate limiting
- Incorrect multipart boundary format
- Server expecting different field names

#### Step 5: Arduino IDE Debugging
1. Open Serial Monitor at 115200 baud
2. Look for new detailed HTTP error messages:
   - "HTTP Response Code: XXX"
   - "HTTP Error Details: ..."
   - "Server connectivity test result: XXX"

### 🔧 **Common HTTP Error Codes**

| Code | Meaning | Solution |
|------|---------|----------|
| 200 | Success | No issue |
| 400 | Bad Request | Check payload format |
| 401 | Unauthorized | Verify API key |
| 403 | Forbidden | Check server permissions |
| 404 | Not Found | Verify URL endpoint |
| 405 | Method Not Allowed | Server doesn't accept POST |
| 413 | Payload Too Large | Reduce image quality/size |
| 500 | Server Error | Server-side issue |
| 503 | Service Unavailable | Server overloaded |

### 🎯 **Quick Fixes to Try**

#### Fix 1: Reduce Image Quality
Edit `config.h`:
```cpp
#define JPEG_QUALITY_PSRAM 10  // Increase number = lower quality = smaller files
#define JPEG_QUALITY_DRAM 15
```

#### Fix 2: Alternative Server Test
Try using a simple HTTP test service like httpbin.org:
```cpp
const char* SERVER_URL = "http://httpbin.org/post";  // Temporary test
```

#### Fix 3: Disable HTTPS (if applicable)
Ensure you're using HTTP, not HTTPS:
```cpp
const char* SERVER_URL = "http://203.175.11.145:9003/api/v1/stream/stream";  // HTTP not HTTPS
```

#### Fix 4: Check API Key Format
Verify the API key doesn't have special characters or spaces:
```cpp
const char* API_KEY = "dev-api-key-change-in-production";  // No spaces or special chars
```

### 📊 **Expected Debug Output**

After the updates, you should see output like:
```
Testing server connectivity...
Server connectivity test result: 200
✅ Server is reachable
Testing simple HTTP POST...
Simple POST test result: 400
Simple POST response: {"error":"Invalid format"}
Registering device...
Device registered successfully!
...
Sending frame of size: 34359 bytes
Total payload size: 34515 bytes
Using complete payload method
HTTP Response Code: 413
HTTP Error Details: {"error":"Payload too large"}
```

### 🚨 **If All Else Fails**

1. **Use a simple test server** (like Python Flask locally)
2. **Capture network traffic** with Wireshark to see actual HTTP requests
3. **Test with smaller images** (reduce resolution to VGA temporarily)
4. **Check server logs** to see what's being received

### 📞 **Next Steps**

Upload the updated code and check the Serial Monitor for the new detailed error messages. This will help pinpoint exactly why the uploads are failing.

---

**Updated**: 2024-06-15  
**Status**: Enhanced debugging implemented
