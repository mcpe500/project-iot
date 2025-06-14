const express = require('express');
const multer = require('multer');
const WebSocket = require('ws');
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');

const { dataDir, recordingsDir, canvasModule } = require('./dataStore');

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
    if (!device.id || !device.name || !device.type) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const registeredDevice = dataStore.registerDevice({
      ...device,
      status: 'online',
      lastSeen: Date.now()
    });
    
    res.json(registeredDevice);
  });

  // Get all devices
  app.get('/api/v1/devices/devices', (req, res) => {
    const devices = dataStore.getAllDevices();
    res.json(devices);
  });

  // Get system status
  app.get('/api/v1/devices/system/status', (req, res) => {
    const status = dataStore.getSystemStatus();
    res.json(status);
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

  // Stream endpoint with face recognition
  app.post('/api/v1/stream/stream', streamUpload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const timestamp = Date.now();
    const deviceId = req.body.deviceId || 'unknown_device';
    const filename = `${deviceId}_${timestamp}.jpg`;
    const filePath = path.join(dataDir, filename);

    try {
      // Save the image to the data directory
      await fsp.writeFile(filePath, req.file.buffer);
      console.log('Frame saved:', filePath);

      // Perform face recognition
      const recognition = await dataStore.performFaceRecognition(req.file.buffer);

      // Broadcast to WebSocket clients
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({
            type: 'new_frame',
            deviceId,
            timestamp,
            filename,
            url: `/data/${filename}`,
            recognition: {
              status: recognition.status,
              recognizedAs: recognition.recognizedAs
            }
          }));
        }
      });

      res.json({ 
        message: 'Frame received', 
        recognitionStatus: recognition.status, 
        recognizedAs: recognition.recognizedAs 
      });

    } catch (err) {
      console.error('Error processing frame:', err);
      res.status(500).json({ error: 'Failed to process frame' });
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

  // Get all recordings
  app.get('/api/v1/stream/recordings', async (req, res) => {
    try {
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
        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
      res.json(videoRecordings);
    } catch (err) {
      console.error("Error reading recordings directory:", err);
      return res.status(500).json({ error: 'Failed to retrieve recordings' });
    }
  });

  // Get all image frames
  app.get('/api/v1/stream/frames', async (req, res) => {
    try {
      const files = await fsp.readdir(dataDir);
      const imageFrames = files
        .filter(file => file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg'))
        .map(file => {
          const filePath = path.join(dataDir, file);
          try {
            const stats = fs.statSync(filePath);
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
            return {
              id: file,
              name: file,
              url: `/data/${file}`,
              createdAt: new Date(0).toISOString(),
              size: 0,
              type: 'image',
              error: 'Could not retrieve file stats'
            };
          }
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      res.json(imageFrames);
    } catch (err) {
      console.error("Error reading data directory for frames:", err);
      res.status(500).json({ error: 'Failed to retrieve image frames' });
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
    const { command, payload } = req.body;

    const device = devices.find(d => d.id === deviceId);

    if (!device) {
      return res.status(404).json({ message: "Device not found" });
    }

    console.log(`Received command '${command}' for device ${deviceId} with payload:`, payload);

    if (command === 'reboot') {
      device.status = 'rebooting';
      setTimeout(() => {
        const d = devices.find(dev => dev.id === deviceId);
        if (d) d.status = 'online';
        console.log(`Device ${deviceId} rebooted and is now online.`);
      }, 5000);
    } else if (command === 'setActive') {
      console.log(`Device ${deviceId} active state set to ${payload.active}`);
    }

    res.status(200).json({ 
      message: `Command '${command}' sent to device ${deviceId} successfully.`, 
      deviceStatus: device.status 
    });
  });

  // Serve static files
  app.use('/data', express.static(dataDir));
  app.use('/recordings', express.static(recordingsDir));
}

module.exports = setupRoutes;