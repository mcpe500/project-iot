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

// Multer configurations
const permittedFaceUpload = multer({ storage: multer.memoryStorage() });
const streamMultipartUpload = multer({ storage: multer.memoryStorage() }).single('image');

function setupRoutes(app, dataStore, wss) {
  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy', 
      uptime: process.uptime(), 
      timestamp: Date.now() 
    });
  });

  // Device registration
  app.post('/api/v1/devices/register', (req, res) => {
    const device = req.body;
    if (!device.deviceId || !device.deviceName || !device.deviceType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const registeredDevice = dataStore.registerDevice({
      id: device.deviceId,
      name: device.deviceName,
      type: device.deviceType,
      ipAddress: device.ipAddress,
      status: 'online',
      lastSeen: Date.now(),
      uptime: 0,
      freeHeap: 0,
      capabilities: device.capabilities || []
    });
    res.json(registeredDevice);
  });

  // Heartbeat endpoint
  app.post('/api/v1/devices/heartbeat', (req, res) => {
    const { deviceId, uptime, freeHeap, wifiRssi, status } = req.body;
    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID required' });
    }
    const device = dataStore.getDevice(deviceId);
    if (device) {
      Object.assign(device, {
        lastSeen: Date.now(),
        uptime: uptime || device.uptime,
        freeHeap: freeHeap || device.freeHeap,
        wifiRssi,
        status: status || 'online'
      });
      dataStore.registerDevice(device);
    }
    res.json({ message: 'Heartbeat received', status: 'success' });
  });

  // Get all devices
  app.get('/api/v1/devices', (req, res) => {
    const allDevices = dataStore.getAllDevices();
    const formattedDevices = allDevices.map(device => ({
      deviceId: device.id,
      deviceName: device.name,
      deviceType: device.type,
      status: device.status,
      ipAddress: device.ipAddress,
      lastHeartbeat: device.lastSeen,
      uptime: device.uptime,
      freeHeap: device.freeHeap,
      wifiRssi: device.wifiRssi,
      errorCount: device.errors || 0,
      capabilities: device.capabilities || []
    }));
    res.json({
      success: true,
      devices: formattedDevices
    });
  });

  // Get system status
  app.get('/api/v1/system/status', (req, res) => {
    const allDevices = dataStore.getAllDevices();
    const onlineDevices = allDevices.filter(d => d.status === 'online' || d.status === 'warning').length;
    res.json({
      success: true,
      status: {
        devicesOnline: onlineDevices,
        devicesTotal: allDevices.length,
        systemUptime: Math.floor(process.uptime()),
        backendConnected: true,
        lastBackendSync: Date.now(),
      }
    });
  });

  // Sensor data ingestion
  app.post('/api/v1/ingest/sensor-data', (req, res) => {
    const sensorData = req.body;
    if (!sensorData.deviceId || !sensorData.timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const savedData = dataStore.saveSensorData(sensorData);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'sensor-data', data: savedData }));
      }
    });
    res.json({ message: 'Data received', data: savedData });
  });

  // Helper function to enhance raw RGB565 images
  async function enhanceRawImage(rawBuffer, width, height) {
    const swappedBuffer = Buffer.alloc(rawBuffer.length);
    for (let i = 0; i < rawBuffer.length; i += 2) {
      swappedBuffer.writeUInt16LE(rawBuffer.readUInt16BE(i), i);
    }
    return sharp(swappedBuffer, { raw: { width, height, channels: 2 } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // --- UNIFIED STREAMING ENDPOINT (FIXED) ---
  app.post('/api/v1/stream/stream', (req, res) => {
    const contentType = req.get('Content-Type');
    const deviceId = req.headers['x-device-id'] || 'unknown_device';

    // --- BRANCH 1: RAW BINARY (OCTET-STREAM) ---
    if (contentType && contentType.startsWith('application/octet-stream')) {
      express.raw({ type: 'application/octet-stream', limit: '10mb' })(req, res, async (err) => {
        if (err) {
            console.error('[Stream API] Raw body parser error:', err);
            return res.status(400).json({ error: 'Invalid raw body' });
        }

        const width = parseInt(req.headers['x-frame-width'], 10);
        const height = parseInt(req.headers['x-frame-height'], 10);
        
        if (!width || !height || !req.body || req.body.length === 0) {
          return res.status(400).json({ error: 'Missing frame metadata or body' });
        }

        const timestamp = Date.now();
        const filename = `${deviceId}_${timestamp}.jpg`;
        const filePath = path.join(dataDir, filename);

        try {
          const enhancedJpegBuffer = await enhanceRawImage(req.body, width, height);
          await fsp.writeFile(filePath, enhancedJpegBuffer);

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
          
          // Perform recognition in the background, don't await it
          dataStore.performFaceRecognition(enhancedJpegBuffer).then(recognitionResult => {
              const recognitionCompleteMessage = {
                  type: 'recognition_complete',
                  filename: filename,
                  recognition: recognitionResult
              };
              wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(recognitionCompleteMessage));
              });
          }).catch(recogErr => console.error(`[Recognition BG] Error for ${filename}:`, recogErr));

          res.status(200).json({ message: 'Frame received, recognition started.' });
        } catch (procErr) {
          console.error('[Stream API] Error processing raw frame:', procErr);
          res.status(500).json({ error: 'Failed to process raw frame', details: procErr.message });
        }
      });
    
    // --- BRANCH 2: JPEG IMAGE (MULTIPART) ---
    } else if (contentType && contentType.startsWith('multipart/form-data')) {
      streamMultipartUpload(req, res, async (uploadErr) => {
        if (uploadErr || !req.file) {
          console.log('[Stream API] Multipart upload error or no file:', uploadErr);
          return res.status(400).json({ error: 'Invalid or missing image in multipart request' });
        }
        
        const timestamp = Date.now();
        const filename = `${deviceId}_${timestamp}.jpg`;
        const filePath = path.join(dataDir, filename);

        try {
          await fsp.writeFile(filePath, req.file.buffer);
          const recognition = await dataStore.performFaceRecognition(req.file.buffer);
          
          const wsMessage = {
            type: 'new_frame',
            deviceId, timestamp, filename,
            url: `/data/${filename}`,
            recognition
          };
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(wsMessage));
          });

          res.json({ message: 'JPEG frame processed', filename, recognition });
        } catch (procErr) {
          console.error('[Stream API] Error processing JPEG frame:', procErr);
          res.status(500).json({ error: 'Failed to process JPEG frame', details: procErr.message });
        }
      });
    
    // --- BRANCH 3: UNSUPPORTED ---
    } else {
      res.status(400).json({ error: 'Unsupported content type. Use application/octet-stream or multipart/form-data.' });
    }
  });

  // Record video from recent frames
  app.post('/api/v1/stream/record', async (req, res) => {
    let tempDir = null;
    try {
      const files = await fsp.readdir(dataDir);
      const now = Date.now();
      const maxAgeMs = 30 * 1000;

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
      const fps = Math.max(5, Math.min(30, Math.round(imageFiles.length / 30)));

      await new Promise((resolve, reject) => {
        ffmpeg(inputPattern)
          .inputFPS(fps)
          .outputOptions(['-c:v libx264', '-pix_fmt yuv420p'])
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
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }
    try {
      const result = await dataStore.addPermittedFace(req.file.buffer, req.body.name);
      res.json({ success: true, message: 'Permitted face added.', data: result });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add permitted face.', details: error.message });
    }
  });

  // Send a command to a device
  app.post('/api/v1/devices/:deviceId/command', (req, res) => {
    const { deviceId } = req.params;
    const { command } = req.body;
    const device = dataStore.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }
    console.log(`Received command '${command}' for device ${deviceId}`);
    // Command logic would go here
    res.json({ success: true, message: `Command '${command}' sent.` });
  });

  // Serve static files for frames and recordings
  app.use('/data', express.static(dataDir));
  app.use('/recordings', express.static(recordingsDir));
}

module.exports = setupRoutes;