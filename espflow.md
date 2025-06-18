# ESPFlow Architecture and Data Flow

## System Components
1. **Sensor Device** (iot-code-sensors-2ndesp/main/main.ino)
   - Measures: 
     - Temperature (DHT11 sensor, °C)
     - Humidity (DHT11 sensor, %)
     - Distance (HC-SR04 ultrasonic sensor, cm) 
     - Light Level (LDR sensor, 0-4095)
   - Sends data every 15 seconds
   - Registers with backend on startup
   - Sample payload:
     ```json
     {
       "deviceId": "esp32-sensor-1",
       "timestamp": 1718707200000,
       "temperature": 25.3,
       "humidity": 60.5,
       "distance": 12.7,
       "lightLevel": 1023
     }
     ```

2. **Camera Device** (iot-code-main/iot-code-arduino-onefile/iot_camera_stream/iot_camera_stream.ino)
   - ESP32-S3 with OV5640 camera
   - Captures and streams 720p video at 30 FPS
   - Sends frames to backend for processing
   - Registers with backend on startup
   - Sample headers:
     ```
     Content-Type: application/octet-stream
     X-Device-ID: esp32-camera-1
     X-Frame-Width: 1280
     X-Frame-Height: 720
     ```

3. **Backend Server** (iot-backend-express)
   - Receives and stores sensor data
   - Processes camera frames asynchronously
   - Provides API endpoints for frontend
   - Manages device registration and status
   - Implements non-blocking operations:
     - Sensor data ingestion
     - Camera frame processing
     - Face recognition (via Python GPU service)

## Data Flow Diagram
```
[Sensor Device] --> [Backend API] --> [Database]
[Camera Device] --> [Backend API] --> [Face Recognition] --> [Database]
[Frontend] <--> [Backend API]
```

## API Endpoints

### Device Registration
- **POST /api/v1/devices/register**
  - Registers new devices
  - Required fields: deviceId, deviceName, deviceType
  - Example request:
    ```json
    {
      "id": "esp32-sensor-1",
      "name": "Lab Sensor Unit", 
      "type": "DHT11-LDR-HCSR04",
      "ipAddress": "192.168.1.100",
      "capabilities": ["temperature", "humidity", "distance", "lightLevel"]
    }
    ```

### Sensor Data Ingestion
- **POST /api/v1/ingest/sensor-data**
  - Accepts sensor readings
  - Required fields: deviceId, timestamp, temperature, humidity, distance, lightLevel
  - Example request:
    ```json
    {
      "deviceId": "esp32-sensor-1",
      "timestamp": 1718707200000,
      "temperature": 25.3,
      "humidity": 60.5,
      "distance": 12.7,
      "lightLevel": 1023
    }
    ```

### Camera Stream Processing
- **POST /api/v1/stream/stream**
  - Accepts camera frames
  - Supports both raw binary and multipart formats
  - Performs face recognition asynchronously
  - Example headers:
    ```
    Content-Type: application/octet-stream
    X-Device-ID: esp32-camera-1
    X-Frame-Width: 1280
    X-Frame-Height: 720
    ```

### Data Retrieval
- **GET /api/v1/devices**
  - Returns all registered devices
  - Example response:
    ```json
    {
      "devices": [
        {
          "id": "esp32-sensor-1",
          "name": "Lab Sensor Unit",
          "type": "DHT11-LDR-HCSR04",
          "status": "online",
          "lastSeen": 1718707200000
        }
      ]
    }
    ```

- **GET /api/v1/sensor-data?deviceId=esp32-sensor-1**
  - Returns sensor data for specific device
  - Example response:
    ```json
    {
      "data": [
        {
          "timestamp": 1718707200000,
          "temperature": 25.3,
          "humidity": 60.5,
          "distance": 12.7,
          "lightLevel": 1023
        }
      ]
    }
    ```

## Database Schema
```sql
CREATE TABLE devices (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(64),
    type VARCHAR(32),
    ip_address VARCHAR(15),
    status VARCHAR(16),
    last_seen BIGINT,
    capabilities TEXT
);

CREATE TABLE sensor_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(32),
    timestamp BIGINT,
    temperature FLOAT,
    humidity FLOAT,
    distance FLOAT,
    light_level INT,
    FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE camera_frames (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    device_id VARCHAR(32),
    timestamp BIGINT,
    file_path VARCHAR(255),
    recognition_status VARCHAR(32),
    recognized_as VARCHAR(64),
    confidence FLOAT,
    FOREIGN KEY (device_id) REFERENCES devices(id)
);
```

## Non-Blocking Operations
1. **Sensor Data Ingestion**
   - Data received via HTTP POST
   - Immediately stored in database
   - WebSocket broadcast to connected clients

2. **Camera Frame Processing**
   - Frames received via HTTP POST
   - Stored in filesystem
   - Recognition queued for background processing
   - WebSocket updates sent when recognition completes

3. **Face Recognition**
   - Offloaded to Python GPU service
   - Runs in background via promises
   - Results stored in database
   - WebSocket notifications sent to clients