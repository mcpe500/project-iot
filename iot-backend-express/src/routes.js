const express = require('express');
const multer = require('multer');
const WebSocket = require('ws');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const Jimp = require('jimp'); // Add Jimp for better RGB565 handling

const { dataDir, recordingsDir } = require('./dataStore');

// Placeholder data for demo purposes
let devices = [
  { id: "device1", name: "Living Room Cam", ipAddress: "192.168.1.101", uptime: "12h 30m", freeHeap: "512KB", lastSeen: new Date().toISOString(), errors: 0, capabilities: ["stream", "record", "ptz"], status: "online" },
  { id: "device2", name: "Kitchen Sensor", ipAddress: "192.168.1.102", uptime: "2d 5h", freeHeap: "1024KB", lastSeen: new Date().toISOString(), errors: 1, capabilities: ["temperature", "humidity"], status: "warning" },
  { id: "device3", name: "Garage Door", ipAddress: "192.168.1.103", uptime: "5h 15m", freeHeap: "256KB", lastSeen: new Date(Date.now() - 3600000 * 3).toISOString(), errors: 0, capabilities: ["open", "close", "status"], status: "offline" },
];

let systemStatus = {
  totalDevices: devices.length,
  onlineDevices: devices.filter(d => d.status === "online").length,
  systemLoad: "Low",
  storageUsage: "45%",
  lastBackup: new Date(Date.now() - 86400000).toISOString(),
};

// Multer configurations
const streamUpload = multer({ storage: multer.memoryStorage() });
const permittedFaceUpload = multer({ storage: multer.memoryStorage() });

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
      device.lastSeen = Date.now();
      device.uptime = uptime || device.uptime;
      device.freeHeap = freeHeap || device.freeHeap;
      device.wifiRssi = wifiRssi;
      device.status = status || 'online';
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
    const systemStatus = {
      devicesOnline: onlineDevices,
      devicesTotal: allDevices.length,
      systemUptime: Math.floor(process.uptime()),
      totalCommandsSent: 0,
      totalCommandsFailed: 0,
      backendConnected: true,
      lastBackendSync: Date.now(),
      systemLoad: 0.1
    };
    res.json({
      success: true,
      status: systemStatus
    });
  });

  // Sensor data ingestion
  app.post('/api/v1/ingest/sensor-data', (req, res) => {
    const sensorData = req.body;
    if (!sensorData.deviceId || !sensorData.timestamp) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const savedData = dataStore.saveSensorData(sensorData);
    
    // Broadcast to WebSocket clients
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'sensor-data',
          data: savedData,
          timestamp: Date.now()
        }));
      }
    });
    
    res.json({ message: 'Data received', data: savedData });
  });

  // Stream endpoint with HYBRID processing (both JPEG and RAW support)
  app.post('/api/v1/stream/stream', async (req, res) => {
    const contentType = req.headers['content-type'] || '';
    const timestamp = Date.now();
    const deviceId = req.headers['x-device-id'] || 'unknown_device';
    const filename = `${deviceId}_${timestamp}.jpg`;
    const filePath = path.join(dataDir, filename);

    console.log(`[Stream API] Received request from ${deviceId}, Content-Type: ${contentType}`);

    try {
      let jpegBuffer;

      if (contentType === 'application/octet-stream') {
        // --- RAW RGB565 PROCESSING ---
        const width = parseInt(req.headers['x-frame-width'], 10);
        const height = parseInt(req.headers['x-frame-height'], 10);
        const format = req.headers['x-frame-format'];

        if (!width || !height || !format) {
          return res.status(400).json({ error: 'Missing frame metadata headers for raw data' });
        }

        console.log(`[Stream API] Processing RAW ${format} frame: ${width}x${height}`);

        // Parse raw body manually
        const rawBodyChunks = [];
        req.on('data', chunk => rawBodyChunks.push(chunk));
        req.on('end', async () => {
          try {
            const rawBuffer = Buffer.concat(rawBodyChunks);
            console.log(`[Stream API] Raw buffer size: ${rawBuffer.length} bytes`);

            if (format === 'RGB565') {
              const rgbBuffer = convertRGB565ToRGB(rawBuffer, width, height);
              jpegBuffer = await sharp(rgbBuffer, {
                raw: { width, height, channels: 3 }
              }).jpeg({ quality: 85 }).toBuffer();
            }

            await fsp.writeFile(filePath, jpegBuffer);
            console.log('[Stream API] Raw frame converted and saved:', filePath);

            const recognition = await dataStore.performFaceRecognition(jpegBuffer);
            
            // Broadcast and respond
            const wsMessage = {
              type: 'new_frame',
              deviceId, timestamp, filename,
              url: `/data/${filename}`,
              recognition: {
                status: recognition.status,
                recognizedAs: recognition.recognizedAs,
                confidence: recognition.confidence,
                error: recognition.error
              }
            };

            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(wsMessage));
              }
            });

            res.json({ 
              message: 'Raw frame processed successfully', 
              filename, 
              recognitionStatus: recognition.status,
              recognizedAs: recognition.recognizedAs,
              confidence: recognition.confidence 
            });

          } catch (error) {
            console.error('[Stream API] Error processing raw frame:', error);
            res.status(500).json({ error: 'Failed to process raw frame', details: error.message });
          }
        });

      } else if (contentType.includes('multipart/form-data')) {
        // --- JPEG MULTIPART PROCESSING ---
        const upload = multer({ storage: multer.memoryStorage() }).single('image');
        
        upload(req, res, async (err) => {
          if (err || !req.file) {
            console.log('[Stream API] No image in multipart request');
            return res.status(400).json({ error: 'No image provided' });
          }

          console.log(`[Stream API] Processing JPEG frame: ${req.file.size} bytes`);

          try {
            // Save the JPEG directly (it's already compressed)
            await fsp.writeFile(filePath, req.file.buffer);
            console.log('[Stream API] JPEG frame saved:', filePath);

            // Perform face recognition
            const recognition = await dataStore.performFaceRecognition(req.file.buffer);
            console.log('[Stream API] Face recognition result:', JSON.stringify(recognition));
            
            // Broadcast to WebSocket clients
            const wsMessage = {
              type: 'new_frame',
              deviceId, timestamp, filename,
              url: `/data/${filename}`,
              recognition: {
                status: recognition.status,
                recognizedAs: recognition.recognizedAs,
                confidence: recognition.confidence,
                error: recognition.error
              }
            };
            
            wss.clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(wsMessage));
              }
            });

            res.json({ 
              message: 'JPEG frame received and processed', 
              filename,
              recognitionStatus: recognition.status,
              recognizedAs: recognition.recognizedAs,
              confidence: recognition.confidence,
              error: recognition.error
            });

          } catch (error) {
            console.error('[Stream API] Error processing JPEG frame:', error);
            res.status(500).json({ error: 'Failed to process JPEG frame', details: error.message });
          }
        });

      } else {
        return res.status(400).json({ error: 'Unsupported content type. Expected multipart/form-data or application/octet-stream.' });
      }

    } catch (err) {
      console.error('[Stream API] General error:', err);
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  });

  // Record video from last 30 seconds of frames
  app.post('/api/v1/stream/record', async (req, res) => {
    let tempDir = null;
    try {
      const filesInDataDir = await fsp.readdir(dataDir);
      const now = Date.now();
      const maxAgeMs = 30 * 1000; // 30 seconds
      let frameCount = 0;

      const imageFilesToProcess = [];

      for (const file of filesInDataDir) {
        const filePath = path.join(dataDir, file);
        try {
          const stat = await fsp.stat(filePath);
          if (!stat.isFile() || !file.toLowerCase().endsWith('.jpg')) continue;

          const parts = file.split('_');
          if (parts.length < 2) continue;

          const timestampStrWithExt = parts[parts.length - 1];
          const timestampStr = timestampStrWithExt.split('.')[0];
          const fileTimestamp = parseInt(timestampStr, 10);

          if (!isNaN(fileTimestamp) && (now - fileTimestamp <= maxAgeMs) && (now - fileTimestamp >= 0)) {
            imageFilesToProcess.push({ filePath, timestamp: fileTimestamp, originalName: file });
          }
        } catch (statError) {
          console.error(`Error stating file ${file}:`, statError);
        }
      }

      if (imageFilesToProcess.length === 0) {
        return res.json({ success: false, message: 'No frames found in the last 30 seconds to record.' });
      }

      // Sort files by timestamp
      imageFilesToProcess.sort((a, b) => a.timestamp - b.timestamp);

      // Create temporary directory for ffmpeg
      tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'recording-frames-'));

      // Copy sorted files to tempDir with sequential names
      for (let i = 0; i < imageFilesToProcess.length; i++) {
        const item = imageFilesToProcess[i];
        const tempFileName = `img-${String(i).padStart(5, '0')}.jpg`;
        await fsp.copyFile(item.filePath, path.join(tempDir, tempFileName));
      }
      frameCount = imageFilesToProcess.length;

      const recordingId = `rec_${Date.now()}.mp4`;
      const outputVideoPath = path.join(recordingsDir, recordingId);
      const inputPattern = path.join(tempDir, 'img-%05d.jpg');

      const fps = Math.max(1, Math.min(30, Math.round(frameCount / 30))) || 10;

      await new Promise((resolve, reject) => {
        ffmpeg(inputPattern)
          .inputFPS(fps)
          .outputOptions([
            '-c:v libx264',
            '-pix_fmt yuv420p',
            '-movflags +faststart'
          ])
          .output(outputVideoPath)
          .on('end', () => {
            console.log(`Recording ${recordingId} saved with ${frameCount} frames at ${fps} FPS.`);
            resolve();
          })
          .on('error', (err) => {
            console.error('Error during ffmpeg processing:', err.message);
            reject(new Error(`FFmpeg error: ${err.message}`));
          })
          .run();
      });

      res.json({ success: true, data: { recordingId, frameCount, videoUrl: `/recordings/${recordingId}` } });

    } catch (error) {
      console.error('Error saving video recording:', error);
      res.status(500).json({ success: false, error: `Failed to save video recording: ${error.message}` });
    } finally {
      if (tempDir) {
        try {
          await fsp.rm(tempDir, { recursive: true, force: true });
          console.log('Temporary directory cleaned up:', tempDir);
        } catch (cleanupError) {
          console.error('Error cleaning up temporary directory:', cleanupError);
        }
      }
    }
  });

  // Get all recordings with consistent response format
  app.get('/api/v1/stream/recordings', async (req, res) => {
    try {
      // Set cache headers to ensure fresh data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const files = await fsp.readdir(recordingsDir);
      const videoRecordingsPromises = files
        .filter(file => file.toLowerCase().endsWith('.mp4'))
        .map(async (file) => {
          const filePath = path.join(recordingsDir, file);
          try {
            const stats = await fsp.stat(filePath);
            let createdAt = stats.birthtime || stats.mtime;
            const match = file.match(/rec_(\d+)\.mp4/);
            if (match && match[1]) {
              createdAt = new Date(parseInt(match[1], 10));
            }
            return {
              id: file,
              name: file,
              url: `/recordings/${file}`,
              createdAt: createdAt.toISOString(),
              size: stats.size,
              type: 'video',
            };
          } catch (statError) {
            console.error(`Failed to get stats for ${filePath}:`, statError);
            return null;
          }
        });

      const videoRecordings = (await Promise.all(videoRecordingsPromises))
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      // Respond with the standardized object
      res.json({ success: true, data: videoRecordings });
    } catch (err) {
      console.error("Error reading recordings directory:", err);
      res.status(500).json({ success: false, error: 'Failed to retrieve recordings' });
    }
  });

  // Delete a recording
  app.delete('/api/v1/stream/recordings/:filename', async (req, res) => {
    const { filename } = req.params;
    
    if (!filename || !filename.endsWith('.mp4')) {
      return res.status(400).json({ success: false, error: 'Invalid filename provided' });
    }

    const filePath = path.join(recordingsDir, filename);

    try {
      // Check if file exists first
      await fsp.access(filePath);
      
      // Delete the file
      await fsp.unlink(filePath);
      console.log(`Recording ${filename} deleted successfully`);
      
      res.json({ success: true, message: `Recording ${filename} deleted successfully` });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ success: false, error: 'Recording not found' });
      }
      console.error(`Error deleting recording ${filename}:`, err);
      res.status(500).json({ success: false, error: 'Failed to delete recording' });
    }
  });

  // Get all image frames with consistent response format
  app.get('/api/v1/stream/frames', async (req, res) => {
    try {
      // Set cache headers to ensure fresh data
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });

      const files = await fsp.readdir(dataDir);
      const imageFramesPromises = files
        .filter(file => file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg'))
        .map(async file => {
          const filePath = path.join(dataDir, file);
          try {
            const stats = await fsp.stat(filePath);
            return {
              id: file,
              name: file,
              url: `/data/${file}`,
              createdAt: stats.birthtime.toISOString(),
              size: stats.size,
              type: 'image',
            };
          } catch (statError) {
            console.error(`Error getting stats for image file ${file}:`, statError);
            return null;
          }
        });

        const imageFrames = (await Promise.all(imageFramesPromises))
            .filter(Boolean)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Respond with the standardized object
      res.json({ success: true, data: imageFrames });
    } catch (err) {
      console.error("Error reading data directory for frames:", err);
      res.status(500).json({ success: false, error: 'Failed to retrieve image frames' });
    }
  });

  // Add permitted face
  app.post('/api/v1/recognition/add-permitted-face', permittedFaceUpload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided for permitted face.' });
    }

    const subjectName = req.body.name || `subject_${Date.now()}`;

    try {
      const result = await dataStore.addPermittedFace(req.file.buffer, subjectName);
      res.json({ 
        success: true, 
        message: `Permitted face '${result.subjectName}' added successfully.`, 
        filename: result.filename 
      });
    } catch (error) {
      console.error("Error adding permitted face:", error);
      res.status(500).json({ 
        error: 'Failed to add permitted face.', 
        details: error.message 
      });
    }
  });

  // Legacy device routes (placeholder data)
  app.get('/api/v1/devices', (req, res) => {
    res.json(devices);
  });

  app.get('/api/v1/system/status', (req, res) => {
    systemStatus.totalDevices = devices.length;
    systemStatus.onlineDevices = devices.filter(d => d.status === "online" || d.status === "warning").length;
    res.json(systemStatus);
  });

  app.post('/api/v1/devices/:deviceId/command', (req, res) => {
    const { deviceId } = req.params;
    const { command, params } = req.body;

    const device = dataStore.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({ success: false, message: "Device not found" });
    }

    console.log(`Received command '${command}' for device ${deviceId} with params:`, params);

    switch (command) {
      case 'restart':
        device.status = 'maintenance';
        dataStore.registerDevice(device);
        setTimeout(() => {
          const d = dataStore.getDevice(deviceId);
          if (d) {
            d.status = 'online';
            dataStore.registerDevice(d);
          }
        }, 5000);
        break;
      case 'ping':
        break;
      case 'snapshot':
        if (device.type === 'camera') {
          console.log(`Taking snapshot for camera ${deviceId}`);
        }
        break;
      default:
        console.log(`Unknown command: ${command}`);
    }

    res.json({
      success: true,
      message: `Command '${command}' sent to device ${deviceId} successfully.`,
      deviceStatus: device.status
    });
  });

  // Serve static files
  app.use('/data', express.static(dataDir));
  app.use('/recordings', express.static(recordingsDir));

  // Debug utility for RGB565 conversion testing
  function debugRGB565Conversion(rgb565Buffer, width, height, samplePixels = 5) {
    console.log(`[RGB565 Debug] Buffer size: ${rgb565Buffer.length} bytes`);
    console.log(`[RGB565 Debug] Expected size: ${width * height * 2} bytes`);
    console.log(`[RGB565 Debug] Dimensions: ${width}x${height}`);
    
    // Sample a few pixels for debugging
    for (let i = 0; i < Math.min(samplePixels * 2, rgb565Buffer.length); i += 2) {
      const rgb565 = rgb565Buffer.readUInt16LE(i);
      
      const r5 = (rgb565 >> 11) & 0x1F;
      const g6 = (rgb565 >> 5) & 0x3F;
      const b5 = rgb565 & 0x1F;
      
      const r8 = Math.round((r5 * 255) / 31);
      const g8 = Math.round((g6 * 255) / 63);
      const b8 = Math.round((b5 * 255) / 31);
      
      console.log(`[RGB565 Debug] Pixel ${i/2}: RGB565=0x${rgb565.toString(16).padStart(4, '0')} → RGB(${r8},${g8},${b8})`);
    }
  }

  // Improved RGB565 to RGB conversion function
  function convertRGB565ToRGB(rgb565Buffer, width, height) {
    console.log(`[RGB565] Converting ${width}x${height} RGB565 buffer (${rgb565Buffer.length} bytes)`);
    
    const rgbBuffer = Buffer.alloc(width * height * 3);
    const expectedSize = width * height * 2; // RGB565 is 2 bytes per pixel
    
    if (rgb565Buffer.length !== expectedSize) {
      console.warn(`[RGB565] Warning: Buffer size mismatch. Expected ${expectedSize}, got ${rgb565Buffer.length}`);
    }
    
    let rgbIndex = 0;
    
    for (let i = 0; i < Math.min(rgb565Buffer.length, expectedSize); i += 2) {
      // Read RGB565 as big-endian (ESP32 might send big-endian)
      const rgb565 = rgb565Buffer.readUInt16BE(i);
      
      // Extract 5-6-5 bits correctly
      const r5 = (rgb565 & 0xF800) >> 11;  // Bits 15-11 (5 bits red)
      const g6 = (rgb565 & 0x07E0) >> 5;   // Bits 10-5  (6 bits green)  
      const b5 = (rgb565 & 0x001F);        // Bits 4-0   (5 bits blue)
      
      // Convert to 8-bit values with proper scaling
      const r8 = Math.round((r5 * 255) / 31);
      const g8 = Math.round((g6 * 255) / 63);
      const b8 = Math.round((b5 * 255) / 31);
      
      // Store in RGB buffer
      rgbBuffer[rgbIndex++] = r8;
      rgbBuffer[rgbIndex++] = g8;
      rgbBuffer[rgbIndex++] = b8;
    }
    
    return rgbBuffer;
  }

  // Alternative RGB565 conversion using little-endian
  function convertRGB565ToRGBLE(rgb565Buffer, width, height) {
    console.log(`[RGB565-LE] Converting ${width}x${height} RGB565 buffer (${rgb565Buffer.length} bytes)`);
    
    const rgbBuffer = Buffer.alloc(width * height * 3);
    const expectedSize = width * height * 2;
    
    let rgbIndex = 0;
    
    for (let i = 0; i < Math.min(rgb565Buffer.length, expectedSize); i += 2) {
      // Read RGB565 as little-endian
      const rgb565 = rgb565Buffer.readUInt16LE(i);
      
      // Extract 5-6-5 bits correctly
      const r5 = (rgb565 & 0xF800) >> 11;
      const g6 = (rgb565 & 0x07E0) >> 5;
      const b5 = (rgb565 & 0x001F);
      
      // Convert to 8-bit values
      const r8 = Math.round((r5 * 255) / 31);
      const g8 = Math.round((g6 * 255) / 63);
      const b8 = Math.round((b5 * 255) / 31);
      
      rgbBuffer[rgbIndex++] = r8;
      rgbBuffer[rgbIndex++] = g8;
      rgbBuffer[rgbIndex++] = b8;
    }
    
    return rgbBuffer;
  }
}

module.exports = setupRoutes;