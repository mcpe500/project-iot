# High-Performance IoT Streaming System

## Performance Optimizations Implemented

### 🚀 System Architecture
- **Dual Service Setup**: Main backend (Express.js) + Image processing service (FastAPI)
- **Non-blocking Operations**: All image processing happens asynchronously
- **High-Speed Endpoints**: Dedicated fast streaming endpoint for ESP32-CAM
- **WebSocket Broadcasting**: Real-time frame updates to frontend

### 📊 Expected Performance
- **Target FPS**: 10 FPS from ESP32-CAM
- **Response Time**: < 100ms for frame upload
- **Recognition**: Background processing, doesn't block streaming

## 🛠️ Setup Instructions

### 1. Start Services
```bash
# Windows
start-high-performance.bat

# Linux/Mac
chmod +x start-high-performance.sh
./start-high-performance.sh
```

### 2. ESP32-CAM Configuration
- Uses optimized endpoint: `/api/v1/stream/fast`
- Reduced HTTP timeout: 3 seconds
- Target FPS: 10 FPS
- Success rate monitoring

### 3. Backend Configuration
```javascript
// Key optimizations in routes.js:
- Immediate response after file save
- Background device registration
- Async face recognition (30% sampling)
- WebSocket broadcasting
```

### 4. Python Service Optimizations
```python
# Key optimizations in data_store.py:
- HOG face detection (faster than CNN)
- Single face processing
- Reduced confidence threshold
- Fast image decoding
```

## 📈 Monitoring

### Performance Metrics
- Visit: `http://localhost:9003/api/v1/system/performance`
- Memory usage, device counts, WebSocket connections

### Health Checks
- Backend: `http://localhost:9003/health`
- Python Service: `http://localhost:9001/health`

## 🔧 Troubleshooting

### Low FPS Issues
1. Check ESP32-CAM serial output for success rate
2. Verify server response times
3. Monitor memory usage on backend
4. Check WebSocket connection in frontend

### Performance Tuning
- Adjust `FACE_RECOGNITION_TIMEOUT` in Python service
- Modify frame sampling rate in `/api/v1/stream/fast`
- Increase `MAX_WORKERS` for Python service if needed

## 🎯 Key Optimizations Summary

1. **Non-blocking uploads**: ESP32 gets immediate response
2. **Background processing**: Face recognition doesn't block streaming
3. **Selective recognition**: Only 30% of frames processed for AI
4. **Fast endpoints**: Dedicated high-speed routes
5. **Memory optimization**: Efficient image handling
6. **Concurrent processing**: Parallel device management and streaming

## 🔗 Service Endpoints

### Main Backend (Port 9003)
- `/api/v1/stream/fast` - High-speed frame upload
- `/api/v1/stream/stream` - Standard upload with full processing
- `/api/v1/devices` - Device management
- `/api/v1/system/performance` - Performance metrics

### Python Image Service (Port 9001)
- `/api/v1/recognize` - Face recognition
- `/api/v1/recognition/add-permitted-face` - Add known faces
- `/health` - Service health check

This setup should achieve the target 10 FPS streaming from ESP32-CAM to the frontend!
