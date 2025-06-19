const express = require('express');
const multer = require('multer');
const WebSocket = require('ws');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const { dataDir, recordingsDir } = require('./dataStore');
const { BuzzerRequest } = require('./database');

// Multer configurations (still needed for other uploads)
const permittedFaceUpload = multer({ storage: multer.memoryStorage() });

// High-performance middleware for caching and compression
function addCacheHeaders(res, maxAge = 300) {
  res.set({
    'Cache-Control': `public, max-age=${maxAge}`,
    'ETag': `W/"${Date.now()}"`,
    'Vary': 'Accept-Encoding'
  });
}

function addNoCacheHeaders(res) {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
}

function setupRoutes(app, dataStore, wss) {

  // =========================================================================
  // --- ENHANCED STREAMING ENDPOINT WITH DEVICE REGISTRATION ---
  // This endpoint handles raw JPEG image uploads from ESP32-CAM devices
  // and automatically registers/updates device information in the database.
  // =========================================================================
  app.post('/api/v1/stream/stream', express.raw({
    type: 'image/jpeg', // Only apply this middleware for JPEG content type
    limit: '10mb'       // Set a reasonable limit for frame size
  }), async (req, res) => {
    // Get all device information from headers
    const deviceInfo = {
      id: req.headers['device-id'] || 'unknown_device',
      name: req.headers['device-name'] || 'Unnamed Device',
      type: req.headers['device-type'] || 'unknown',
      ipAddress: req.headers['device-ip'] || '0.0.0.0',
      status: req.headers['device-status'] || 'online',
      uptime: parseInt(req.headers['device-uptime']) || 0,
      freeHeap: parseInt(req.headers['device-freeheap']) || 0,
      wifiRssi: parseInt(req.headers['device-wifirssi']) || 0,
      capabilities: req.headers['device-capabilities'] ? JSON.parse(req.headers['device-capabilities']) : ['camera', 'image_capture']
    };

    // Check if the body parser ran and if the body has content
    if (!req.body || req.body.length === 0) {
      console.warn(`[Stream API] Empty or invalid JPEG body received from ${deviceInfo.id}`);
      return res.status(400).json({ error: 'Empty image buffer received.' });
    }

    const timestamp = Date.now();
    const filename = `${deviceInfo.id}_${timestamp}.jpg`;
    const filePath = path.join(dataDir, filename);

    try {
      // Register/update device in database with current status
      console.log(`[Stream API] Registering/updating device: ${deviceInfo.id}`);
      const registeredDevice = await dataStore.registerDevice({
        id: deviceInfo.id,
        name: deviceInfo.name,
        type: deviceInfo.type,
        ipAddress: deviceInfo.ipAddress,
        status: deviceInfo.status,
        uptime: deviceInfo.uptime,
        freeHeap: deviceInfo.freeHeap,
        wifiRssi: deviceInfo.wifiRssi,
        capabilities: deviceInfo.capabilities
      });
      console.log(`[Stream API] Device ${deviceInfo.id} updated with status: ${registeredDevice.status}`);

      // req.body is now the complete image buffer, thanks to express.raw()
      await fsp.writeFile(filePath, req.body);

      // --- Immediate broadcast for real-time streaming ---
      const newFrameMessage = {
        type: 'new_frame',
        deviceId: deviceInfo.id,
        timestamp,
        filename,
        url: `/data/${filename}`,
        recognition: { status: 'pending' }
      };
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(newFrameMessage));
        }
      });

      // Respond immediately for high FPS performance
      res.status(200).json({
        success: true,
        message: 'Frame received successfully.',
        filename,
        timestamp,
        size: req.body.length,
        deviceStatus: registeredDevice ? registeredDevice.status : 'unknown'
      });

      // Perform face recognition in the background (non-blocking)
      setImmediate(() => {
        dataStore.performFaceRecognition(req.body)
          .then(recognitionResult => {
            const recognitionCompleteMessage = {
              type: 'recognition_complete',
              filename: filename,
              deviceId: deviceInfo.id,
              timestamp,
              recognition: recognitionResult
            };
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(recognitionCompleteMessage));
              }
            });
          })
          .catch(recogErr => console.error(`[Recognition BG] Error for ${filename}:`, recogErr));
      });

    } catch (procErr) {
      console.error('[Stream API] Error processing raw JPEG frame:', procErr);

      // Try to update device status to error if device registration was successful
      try {
        if (deviceInfo.id !== 'unknown_device') {
          await dataStore.updateDevice(deviceInfo.id, { status: 'error' });
        }
      } catch (deviceUpdateErr) {
        console.error('[Stream API] Failed to update device error status:', deviceUpdateErr);
      }

      res.status(500).json({
        success: false,
        error: 'Failed to process JPEG frame',
        details: procErr.message
      });
    }
  });


  // High-performance streaming endpoint for maximum FPS
  app.post('/api/v1/stream/fast', express.raw({
    type: 'image/jpeg',
    limit: '10mb'
  }), async (req, res) => {
    const deviceId = req.headers['device-id'] || 'unknown_device';
    const timestamp = Date.now();
    const filename = `${deviceId}_${timestamp}.jpg`;

    // Quick validation
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty image' });
    }

    // Respond immediately for maximum FPS
    res.status(200).json({
      success: true,
      filename,
      timestamp,
      fps_optimized: true
    });

    // Handle everything else asynchronously
    setImmediate(async () => {
      try {
        // Save file
        const filePath = path.join(dataDir, filename);
        await fsp.writeFile(filePath, req.body);

        // Broadcast frame immediately
        const frameMessage = {
          type: 'new_frame',
          deviceId,
          timestamp,
          filename,
          url: `/data/${filename}`,
          recognition: { status: 'pending' }
        };

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(frameMessage));
          }
        });

        // Update device status in background
        if (deviceId !== 'unknown_device') {
          const deviceInfo = {
            id: deviceId,
            name: req.headers['device-name'] || 'Fast Device',
            type: req.headers['device-type'] || 'ESP32-CAM',
            ipAddress: req.headers['device-ip'] || '0.0.0.0',
            status: 'online',
            uptime: parseInt(req.headers['device-uptime']) || 0,
            freeHeap: parseInt(req.headers['device-freeheap']) || 0,
            wifiRssi: parseInt(req.headers['device-wifirssi']) || 0,
            capabilities: ['camera', 'image_capture', 'high_fps']
          };

          await dataStore.registerDevice(deviceInfo);
        }

        // Background face recognition (optional)
        if (Math.random() < 0.3) { // Only process 30% of frames for face recognition
          dataStore.performFaceRecognition(req.body)
            .then(recognitionResult => {
              const recogMessage = {
                type: 'recognition_complete',
                filename,
                deviceId,
                timestamp,
                recognition: recognitionResult
              };
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify(recogMessage));
                }
              });
            })
            .catch(err => console.error(`[FastStream] Recognition error:`, err.message));
        }
      } catch (error) {
        console.error(`[FastStream] Background processing error:`, error.message);
      }
    });
  });

  // --- ALL OTHER ROUTES BELOW ARE UNCHANGED ---

  // Buzzer control endpoint
  app.post('/api/v1/buzzer/control', async (req, res) => {
    try {
      // Validate request body
      console.log({ body: req.body })
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Invalid request body'
        });
      }

      const { deviceId, status } = req.body;

      // Validate required parameters
      if (!deviceId || typeof status !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters. deviceId (string) and status (boolean) are required'
        });
      }

      // Create new buzzer request
      // Convert boolean status to ENUM value
      const statusEnum = status ? 'completed' : 'pending';

      const buzzerRequest = new BuzzerRequest({
        deviceId,
        status: statusEnum,
        requestedAt: Date.now()
      });

      await buzzerRequest.save();

      // Log the request
      console.log(`Buzzer control request received:`, {
        deviceId,
        status,
        timestamp: new Date().toISOString()
      });

      // TODO: Implement actual device control logic here

      res.json({
        success: true,
        message: `Buzzer ${status ? 'activated' : 'deactivated'}`,
        requestId: buzzerRequest.id
      });
    } catch (error) {
      console.error('Buzzer control error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });

  // Buzzer ping endpoint
  app.post('/api/v1/buzzer/ping', async (req, res) => {
    try {
      const { deviceId } = req.body;
      if (!deviceId) {
        return res.status(400).json({ error: 'Device ID is required' });
      }

      const buzzerRequest = new BuzzerRequest({
        deviceId,
        status: 'pending',
        requestedAt: Date.now()
      });

      await buzzerRequest.save();

      // Log the ping request
      console.log(`Buzzer ping request received:`, {
        deviceId,
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: 'Ping request received',
        requestId: buzzerRequest.id
      });
    } catch (error) {
      console.error('Buzzer ping error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
  // Health check
  app.get('/health', async (req, res) => {
    try {
      // Access database through dataStore
      await dataStore.dbReady; // Wait for database to be ready
      const sequelize = dataStore.sequelize;

      const dbStatus = await sequelize.verifyConnection();

      res.json({
        status: dbStatus.success ? 'healthy' : 'degraded',
        uptime: process.uptime(),
        timestamp: Date.now(),
        backendVersion: require('../../package.json').version,
        nodeVersion: process.version,
        database: {
          status: dbStatus.success ? 'connected' : 'disconnected',
          version: dbStatus.version,
          message: dbStatus.message
        }
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error.message
      });
    }
  });

  // --- OPTIMIZED DEVICE ENDPOINTS ---
  // Device registration with intelligent caching
  app.post('/api/v1/devices/register', async (req, res) => {
    const startTime = Date.now();
    const device = req.body;

    if (!device.deviceId || !device.deviceName || !device.deviceType) {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, deviceName, deviceType',
        responseTime: Date.now() - startTime
      });
    }

    try {
      const registeredDevice = await dataStore.registerDevice({
        id: device.deviceId,
        name: device.deviceName,
        type: device.deviceType,
        ipAddress: device.ipAddress,
        status: 'online',
        capabilities: device.capabilities || []
      });

      // Real-time notification
      const deviceMessage = {
        type: 'device_registered',
        device: registeredDevice,
        timestamp: Date.now()
      };

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(deviceMessage));
        }
      });

      addNoCacheHeaders(res);
      res.json({
        success: true,
        ...registeredDevice,
        responseTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[API Error] /devices/register:', error);
      res.status(500).json({
        error: 'Failed to register device',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // Optimized heartbeat endpoint
  app.post('/api/v1/devices/heartbeat', async (req, res) => {
    const startTime = Date.now();
    const { deviceId, uptime, freeHeap, wifiRssi, status } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Device ID required',
        responseTime: Date.now() - startTime
      });
    }

    try {
      const updatedDevice = await dataStore.updateDevice(deviceId, {
        uptime: uptime,
        freeHeap: freeHeap,
        wifiRssi: wifiRssi,
        status: status || 'online'
      });

      if (updatedDevice) {
        addNoCacheHeaders(res);
        res.json({
          message: 'Heartbeat received',
          status: 'success',
          device: updatedDevice,
          responseTime: Date.now() - startTime
        });
      } else {
        console.warn(`Heartbeat from unknown device ${deviceId}, attempting to re-register.`);
        res.status(404).json({
          error: 'Device not found. Please re-register.',
          responseTime: Date.now() - startTime
        });
      }
    } catch (error) {
      console.error('[API Error] /devices/heartbeat:', error);
      res.status(500).json({
        error: 'Failed to process heartbeat',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // --- OPTIMIZED BUZZER CONTROL ENDPOINTS ---
  app.post('/api/v1/buzzer/request', async (req, res) => {
    const startTime = Date.now();
    const { deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    try {
      const request = await dataStore.createBuzzerRequest(deviceId);

      // Real-time notification
      const buzzerMessage = {
        type: 'buzzer_request',
        deviceId,
        requestId: request.id || request.requestedAt,
        timestamp: request.requestedAt
      };

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(buzzerMessage));
        }
      });

      addNoCacheHeaders(res);
      res.json({
        success: true,
        ...request,
        responseTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[API Error] /buzzer/request:', error);
      res.status(500).json({
        error: 'Failed to create buzzer request',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // Optimized buzzer status endpoint with caching
  app.get('/api/v1/buzzer/status/:deviceId?', async (req, res) => {
    const startTime = Date.now();
    const { deviceId } = req.params;

    try {
      if (!deviceId) {
        // Return status for all devices - use caching for performance
        const allDevices = await dataStore.getAllDevices();
        const statuses = await Promise.all(
          allDevices.slice(0, 50).map(device => // Limit to 50 devices for performance
            dataStore.getBuzzerStatus(device.id)
          )
        );

        addCacheHeaders(res, 60); // Cache for 1 minute
        return res.json({
          success: true,
          statuses,
          responseTime: Date.now() - startTime
        });
      }

      const status = await dataStore.getBuzzerStatus(deviceId);

      addCacheHeaders(res, 30); // Cache for 30 seconds
      res.json({
        success: true,
        ...status,
        responseTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[API Error] /buzzer/status:', error);
      res.status(500).json({
        error: 'Failed to get buzzer status',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  app.patch('/api/v1/buzzer/complete/:id', async (req, res) => {
    const startTime = Date.now();
    const { id } = req.params;

    try {
      const request = await dataStore.completeBuzzerRequest(id);

      // Real-time notification
      if (request && request.deviceId) {
        const completionMessage = {
          type: 'buzzer_completed',
          deviceId: request.deviceId,
          requestId: id,
          timestamp: request.buzzedAt
        };

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(completionMessage));
          }
        });
      }

      addNoCacheHeaders(res);
      res.json({
        success: true,
        ...request,
        responseTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[API Error] /buzzer/complete:', error);
      res.status(500).json({
        error: 'Failed to complete buzzer request',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // Get all devices
  app.get('/api/v1/devices', async (req, res) => {
    try {
      const allDevices = await dataStore.getAllDevices();
      const formattedDevices = allDevices.map(device => ({
        deviceId: device.id,
        deviceName: device.name,
        deviceType: device.type,
        status: device.status,
        ipAddress: device.ipAddress,
        lastHeartbeat: device.lastSeen, // Assuming lastSeen is a timestamp or ISO string
        uptime: device.uptime,
        freeHeap: device.freeHeap,
        wifiRssi: device.wifiRssi,
        errorCount: device.errors || 0, // Assuming an 'errors' field might exist
        capabilities: typeof device.capabilities === 'string' ? JSON.parse(device.capabilities) : device.capabilities
      }));
      res.json({
        success: true,
        devices: formattedDevices
      });
    } catch (error) {
      console.error('[API Error] /devices:', error);
      res.status(500).json({ error: 'Failed to retrieve devices', details: error.message });
    }
  });

  // Get system status
  app.get('/api/v1/system/status', async (req, res) => {
    try {
      const allDevices = await dataStore.getAllDevices();
      const onlineDevices = allDevices.filter(d => d.status === 'online' || d.status === 'warning').length;
      res.json({
        success: true,
        status: {
          devicesOnline: onlineDevices,
          devicesTotal: allDevices.length,
          systemUptime: Math.floor(process.uptime()),
          backendConnected: true, // Assuming DB connection implies backend is connected
          lastBackendSync: Date.now(),
        }
      });
    } catch (error) {
      console.error('[API Error] /system/status:', error);
      res.status(500).json({ error: 'Failed to retrieve system status', details: error.message });
    }
  });

  // --- OPTIMIZED SENSOR DATA ENDPOINTS ---
  // High-performance sensor data ingestion with batching
  app.post('/api/v1/ingest/sensor-data', async (req, res) => {
    const startTime = Date.now();
    const sensorData = req.body;

    if (!sensorData.deviceId) {
      return res.status(400).json({
        error: 'Missing required field: deviceId',
        responseTime: Date.now() - startTime
      });
    }

    try {
      const savedData = await dataStore.saveSensorData({
        deviceId: sensorData.deviceId,
        timestamp: sensorData.timestamp || Date.now(),
        temperature: sensorData.temperature,
        humidity: sensorData.humidity,
        distance: sensorData.distance,
        lightLevel: sensorData.lightLevel,
        pressure: sensorData.pressure,
        altitude: sensorData.altitude,
        co2Level: sensorData.co2Level,
        customData: sensorData.customData
      });

      // Real-time WebSocket notification
      const sensorMessage = {
        type: 'sensor-data',
        data: savedData,
        timestamp: savedData.timestamp
      };

      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(sensorMessage));
        }
      });

      addNoCacheHeaders(res);
      res.json({
        success: true,
        message: 'Data received',
        data: savedData,
        responseTime: Date.now() - startTime
      });
    } catch (error) {
      console.error('[API Error] /ingest/sensor-data:', error);
      res.status(500).json({
        error: 'Failed to save sensor data',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // Optimized sensor data retrieval with caching
  app.get('/api/v1/sensor-data', async (req, res) => {
    const startTime = Date.now();
    const { deviceId, limit } = req.query;

    if (!deviceId) {
      return res.status(400).json({
        error: 'Missing required query parameter: deviceId',
        responseTime: Date.now() - startTime
      });
    }

    try {
      const limitNum = limit ? Math.min(parseInt(limit, 10), 1000) : 100; // Cap at 1000 for performance
      const data = await dataStore.getSensorData(deviceId, limitNum);

      // Prepare response and set Content-Length header
      const responseObj = {
        success: true,
        data,
        count: data.length,
        deviceId,
        responseTime: Date.now() - startTime
      };
      const responseStr = JSON.stringify(responseObj);
      res.set('Content-Length', Buffer.byteLength(responseStr));
      addCacheHeaders(res, 60); // Cache for 1 minute
      console.log({ responseStr })
      res.type('application/json').send(responseStr);
    } catch (error) {
      console.error('[API Error] /sensor-data:', error);
      res.status(500).json({
        error: 'Failed to retrieve sensor data',
        details: error.message,
        responseTime: Date.now() - startTime
      });
    }
  });

  // Record video from recent frames
  app.post('/api/v1/stream/record', async (req, res) => {
    // ... existing record endpoint code ...
    // This endpoint is file-system based, no direct DB interaction with DataStore here.
    let tempDir = null;
    try {
      const files = await fsp.readdir(dataDir);
      const now = Date.now();
      const maxAgeMs = 30 * 1000; // Consider making this configurable

      const imageFiles = files
        .map(file => {
          const match = file.match(/_(\d+)\.jpg$/);
          if (!match) return null;
          const timestamp = parseInt(match[1], 10);
          if (now - timestamp > maxAgeMs) return null;
          return { path: path.join(dataDir, file), timestamp };
        })
        .filter(Boolean)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (imageFiles.length < 2) {
        return res.json({ success: false, message: 'Not enough recent frames to create a video.' });
      }

      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rec-'));
      for (let i = 0; i < imageFiles.length; i++) {
        const tempName = `img-${String(i).padStart(5, '0')}.jpg`;
        await fsp.copyFile(imageFiles[i].path, path.join(tempDir, tempName));
      }

      const recordingId = `rec_${Date.now()}.mp4`;
      const outputPath = path.join(recordingsDir, recordingId);
      const inputPattern = path.join(tempDir, 'img-%05d.jpg');
      // Adjust FPS: min 2 frames, target 10 fps, max 30. Duration based on actual frames.
      const durationSeconds = imageFiles.length / Math.max(1, Math.min(imageFiles.length, 10)); // Target 10fps or actual if less
      const fps = Math.max(5, Math.min(30, Math.round(imageFiles.length / Math.max(1, durationSeconds))));

      await new Promise((resolve, reject) => {
        ffmpeg(inputPattern)
          .inputFPS(fps)
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p', '-movflags +faststart'])
          .output(outputPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      res.json({ success: true, data: { recordingId, frameCount: imageFiles.length, url: `/recordings/${recordingId}` } });
    } catch (error) {
      console.error('Error creating video recording:', error);
      res.status(500).json({ success: false, error: error.message });
    } finally {
      if (tempDir) await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  // Get all recordings
  app.get('/api/v1/stream/recordings', async (req, res) => {
    // ... existing recordings list endpoint ...
    // File-system based.
    try {
      res.set({ 'Cache-Control': 'no-cache' });
      const files = await fsp.readdir(recordingsDir);
      const recordings = await Promise.all(
        files
          .filter(f => f.toLowerCase().endsWith('.mp4'))
          .map(async file => {
            const stats = await fsp.stat(path.join(recordingsDir, file));
            const match = file.match(/rec_(\d+)\.mp4/);
            const createdAt = match ? new Date(parseInt(match[1], 10)) : stats.birthtime;
            return { id: file, url: `/recordings/${file}`, createdAt: createdAt.toISOString(), size: stats.size };
          })
      );
      res.json({ success: true, data: recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to retrieve recordings' });
    }
  });

  // Delete a recording
  app.delete('/api/v1/stream/recordings/:filename', async (req, res) => {
    // ... existing delete recording endpoint ...
    // File-system based.
    const { filename } = req.params;
    if (!filename.match(/^rec_\d+\.mp4$/)) {
      return res.status(400).json({ success: false, error: 'Invalid filename' });
    }
    const filePath = path.join(recordingsDir, filename);
    try {
      await fsp.unlink(filePath);
      res.json({ success: true, message: `Deleted ${filename}` });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ success: false, error: 'Not found' });
      res.status(500).json({ success: false, error: 'Failed to delete recording' });
    }
  });

  // Get all image frames
  app.get('/api/v1/stream/frames', async (req, res) => {
    // ... existing frames list endpoint ...
    // File-system based.
    try {
      res.set({ 'Cache-Control': 'no-cache' });
      const files = await fsp.readdir(dataDir);
      const frames = await Promise.all(
        files
          .filter(f => f.toLowerCase().endsWith('.jpg'))
          .map(async file => {
            const stats = await fsp.stat(path.join(dataDir, file));
            return { id: file, url: `/data/${file}`, createdAt: stats.birthtime.toISOString(), size: stats.size };
          })
      );
      res.json({ success: true, data: frames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) });
    } catch (err) {
      res.status(500).json({ success: false, error: 'Failed to retrieve frames' });
    }
  });

  // Add a permitted face
  app.post('/api/v1/recognition/add-permitted-face', permittedFaceUpload.single('image'), async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No image provided or image buffer is empty' });
    }
    if (!req.body.name) {
      return res.status(400).json({ error: 'Subject name is required' });
    }
    try {
      // dataStore.addPermittedFace is already async
      const result = await dataStore.addPermittedFace(req.file.buffer, req.body.name);
      if (result.status === 'success') {
        res.json({ success: true, message: result.message, data: result });
      } else {
        res.status(500).json({ success: false, error: result.message, details: result.error });
      }
    } catch (error) {
      console.error('[API Error] /add-permitted-face:', error);
      res.status(500).json({ error: 'Failed to add permitted face.', details: error.message });
    }
  });

  // Send a command to a device (conceptual, needs actual implementation for device communication)
  app.post('/api/v1/devices/:deviceId/command', async (req, res) => {
    const { deviceId } = req.params;
    const { command } = req.body;
    try {
      const device = await dataStore.getDevice(deviceId);
      if (!device) {
        return res.status(404).json({ success: false, message: "Device not found" });
      }
      console.log(`Received command '${command}' for device ${deviceId} (IP: ${device.ipAddress})`);
      // Actual command sending logic would be implemented here (e.g., HTTP request to device.ipAddress)
      // For now, just acknowledge.
      res.json({ success: true, message: `Command '${command}' notionally sent to ${deviceId}.` });
    } catch (error) {
      console.error('[API Error] /devices/:deviceId/command:', error);
      res.status(500).json({ error: 'Failed to process command for device', details: error.message });
    }
  });



  // Serve static files for frames and recordings
  app.use('/data', express.static(dataDir));
  app.use('/recordings', express.static(recordingsDir));

  // Performance monitoring endpoint
  app.get('/api/v1/system/performance', async (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const uptime = process.uptime();

      // Get device count
      const allDevices = await dataStore.getAllDevices();
      const onlineDevices = allDevices.filter(d => d.status === 'online').length;

      res.json({
        success: true,
        performance: {
          uptime: Math.floor(uptime),
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
            external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
          },
          devices: {
            total: allDevices.length,
            online: onlineDevices,
            offline: allDevices.length - onlineDevices
          },
          websocketConnections: wss.clients.size,
          nodeVersion: process.version,
          platform: process.platform
        }
      });
    } catch (error) {
      console.error('[API Error] /system/performance:', error);
      res.status(500).json({ error: 'Failed to get performance metrics', details: error.message });
    }
  });
}

module.exports = setupRoutes;
