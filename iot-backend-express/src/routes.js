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

// Multer configurations (still needed for other uploads)
const permittedFaceUpload = multer({ storage: multer.memoryStorage() });

function setupRoutes(app, dataStore, wss) {

  // =========================================================================
  // --- PRIMARY FIX: A NEW, SIMPLIFIED STREAMING ENDPOINT ---
  // This endpoint now specifically handles raw JPEG image uploads.
  // =========================================================================
  app.post('/api/v1/stream/stream', express.raw({
    type: 'image/jpeg', // Only apply this middleware for JPEG content type
    limit: '10mb'       // Set a reasonable limit for frame size
  }), async (req, res) => {
    // Get headers (headers are automatically lowercased by Express)
    const deviceId = req.headers['device-id'] || 'unknown_device';

    // Check if the body parser ran and if the body has content
    if (!req.body || req.body.length === 0) {
      console.warn(`[Stream API] Empty or invalid JPEG body received from ${deviceId}`);
      return res.status(400).json({ error: 'Empty image buffer received.' });
    }

    const timestamp = Date.now();
    const filename = `${deviceId}_${timestamp}.jpg`;
    const filePath = path.join(dataDir, filename);

    try {
      // req.body is now the complete image buffer, thanks to express.raw()
      await fsp.writeFile(filePath, req.body);

      // --- Broadcast and recognition logic (unchanged) ---
      const newFrameMessage = {
        type: 'new_frame',
        deviceId,
        timestamp,
        filename,
        url: `/data/${filename}`,
        recognition: { status: 'pending' }
      };
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(newFrameMessage));
      });

      // Perform face recognition in the background
      dataStore.performFaceRecognition(req.body)
        .then(recognitionResult => {
          const recognitionCompleteMessage = { type: 'recognition_complete', filename: filename, recognition: recognitionResult };
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(recognitionCompleteMessage));
          });
        })
        .catch(recogErr => console.error(`[Recognition BG] Error for ${filename}:`, recogErr));

      // Respond with success
      res.status(200).json({
        success: true,
        message: 'Frame received successfully.',
        filename,
        timestamp,
        size: req.body.length
      });

    } catch (procErr) {
      console.error('[Stream API] Error processing raw JPEG frame:', procErr);
      res.status(500).json({
        success: false,
        error: 'Failed to process JPEG frame',
        details: procErr.message
      });
    }
  });


  // --- ALL OTHER ROUTES BELOW ARE UNCHANGED ---

  // Buzzer control endpoint
  app.post('/api/v1/buzzer/control', async (req, res) => {
    try {
      const { deviceId, status } = req.body;
      
      if (!deviceId || typeof status !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Invalid request parameters'
        });
      }

      // Create new buzzer request
      const buzzerRequest = new BuzzerRequest({
        deviceId,
        status,
        timestamp: new Date()
      });

      await buzzerRequest.save();

      // TODO: Implement actual device control logic here

      res.json({
        success: true,
        message: `Buzzer ${status ? 'activated' : 'deactivated'}`
      });
    } catch (error) {
      console.error('Buzzer control error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
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

  // Device registration
  app.post('/api/v1/devices/register', async (req, res) => {
    const device = req.body;
    if (!device.deviceId || !device.deviceName || !device.deviceType) {
      return res.status(400).json({ error: 'Missing required fields: deviceId, deviceName, deviceType' });
    }
    try {
      const registeredDevice = await dataStore.registerDevice({
        id: device.deviceId,
        name: device.deviceName,
        type: device.deviceType,
        ipAddress: device.ipAddress,
        status: 'online',
        // lastSeen is handled by registerDevice
        capabilities: device.capabilities || []
      });
      res.json(registeredDevice);
    } catch (error) {
      console.error('[API Error] /devices/register:', error);
      res.status(500).json({ error: 'Failed to register device', details: error.message });
    }
  });

  // Heartbeat endpoint
  app.post('/api/v1/devices/heartbeat', async (req, res) => {
    const { deviceId, uptime, freeHeap, wifiRssi, status } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }
    try {
      const updatedDevice = await dataStore.updateDevice(deviceId, {
        uptime: uptime,
        freeHeap: freeHeap,
        wifiRssi: wifiRssi,
        status: status || 'online'
        // lastSeen is automatically updated by updateDevice
      });
      if (updatedDevice) {
        res.json({ message: 'Heartbeat received', status: 'success', device: updatedDevice });
      } else {
        // Attempt to register if heartbeat for unknown device
        // This could happen if the device was cleared from DB but is still running
        console.warn(`Heartbeat from unknown device ${deviceId}, attempting to re-register.`);
        // We need more info than just ID for registration, so we can't fully re-register here.
        // Client should ideally re-register if it gets a 404 or error.
        res.status(404).json({ error: 'Device not found. Please re-register.' });
      }
    } catch (error) {
      console.error('[API Error] /devices/heartbeat:', error);
      res.status(500).json({ error: 'Failed to process heartbeat', details: error.message });
    }
  });

  // --- BUZZER CONTROL ENDPOINTS ---
  app.post('/api/v1/buzzer/request', async (req, res) => {
    const { deviceId } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }
    
    try {
      const request = await dataStore.createBuzzerRequest(deviceId);
      res.json(request);
    } catch (error) {
      console.error('[API Error] /buzzer/request:', error);
      res.status(500).json({ error: 'Failed to create buzzer request', details: error.message });
    }
  });

  app.get('/api/v1/buzzer/status/:deviceId', async (req, res) => {
    const { deviceId } = req.params;
    
    try {
      const status = await dataStore.getBuzzerStatus(deviceId);
      res.json(status);
    } catch (error) {
      console.error('[API Error] /buzzer/status:', error);
      res.status(500).json({ error: 'Failed to get buzzer status', details: error.message });
    }
  });

  app.patch('/api/v1/buzzer/complete/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
      const request = await dataStore.completeBuzzerRequest(id);
      res.json(request);
    } catch (error) {
      console.error('[API Error] /buzzer/complete:', error);
      res.status(500).json({ error: 'Failed to complete buzzer request', details: error.message });
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

  // Sensor data ingestion
  app.post('/api/v1/ingest/sensor-data', async (req, res) => {
    const sensorData = req.body;
    // deviceId is mandatory. Timestamp can be optional if server generates it.
    if (!sensorData.deviceId) {
      return res.status(400).json({ error: 'Missing required field: deviceId' });
    }
    try {
      const savedData = await dataStore.saveSensorData({
        deviceId: sensorData.deviceId,
        timestamp: sensorData.timestamp || Date.now(), // Use provided or generate now
        temperature: sensorData.temperature,
        humidity: sensorData.humidity,
        distance: sensorData.distance,
        lightLevel: sensorData.lightLevel,
        // any other sensor fields
      });
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'sensor-data', data: savedData }));
        }
      });
      res.json({ message: 'Data received', data: savedData });
    } catch (error) {
      console.error('[API Error] /ingest/sensor-data:', error);
      res.status(500).json({ error: 'Failed to save sensor data', details: error.message });
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
      res.json({ success: true, data: recordings.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)) });
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

  // Get sensor data for a device
  app.get('/api/v1/sensor-data', async (req, res) => {
    const { deviceId, limit } = req.query;
    console.log('[API] /sensor-data query:', { deviceId, limit });
    if (!deviceId) {
      return res.status(400).json({ error: 'Missing required query parameter: deviceId' });
    }
    try {
      // Default to 100 records if not specified
      const data = await dataStore.getSensorData(deviceId, limit ? parseInt(limit, 10) : 100);
      res.json({ success: true, data });
    } catch (error) {
      console.error('[API Error] /sensor-data:', error);
      res.status(500).json({ error: 'Failed to retrieve sensor data', details: error.message });
    }
  });

  // Serve static files for frames and recordings
  app.use('/data', express.static(dataDir));
  app.use('/recordings', express.static(recordingsDir));
}

module.exports = setupRoutes;