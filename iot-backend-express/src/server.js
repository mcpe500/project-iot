const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const multer = require('multer');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const fs = require('fs');
const fsp = require('fs').promises; // Added for async file operations
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');
const { createSshTunnel } = require('../job/tunnel');
const ffmpeg = require('fluent-ffmpeg'); // Added for video processing

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure recordings directory exists
const recordingsDir = path.join(__dirname, '../recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

// // Middleware
// app.use(cors({
//   origin: process.env.CORS_ORIGIN || '*',
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
//   credentials: true
// }));

app.use(cors('*')); // Allow all origins for simplicity, adjust as needed

app.use(helmet());
app.use(express.json());
app.use(morgan('dev'));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS || 60000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: 'Too many requests, please try again later'
});
app.use('/api/', apiLimiter);

// Data store implementation
class DataStore {
  constructor() {
    this.devices = new Map();
    this.sensorData = new Map();
    this.commands = new Map();
    this.notes = new Map();
    this.nextNoteId = 1;
  }

  // Device operations
  registerDevice(device) {
    this.devices.set(device.id, device);
    return device;
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  // Get all devices
  getAllDevices() {
    return Array.from(this.devices.values());
  }

  // Get system status
  getSystemStatus() {
    return {
      devicesOnline: this.getAllDevices().filter(d => d.status === 'online').length,
      devicesTotal: this.devices.size,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  // Sensor data operations
  saveSensorData(data) {
    if (!this.sensorData.has(data.deviceId)) {
      this.sensorData.set(data.deviceId, []);
    }
    this.sensorData.get(data.deviceId).push(data);
    return data;
  }
}

const dataStore = new DataStore();

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    console.log('Received WebSocket message:', message.toString());
  });

  ws.send(JSON.stringify({ 
    type: 'connection', 
    status: 'connected', 
    timestamp: Date.now() 
  }));
});

// Placeholder for in-memory device data
let devices = [
  { id: "device1", name: "Living Room Cam", ipAddress: "192.168.1.101", uptime: "12h 30m", freeHeap: "512KB", lastSeen: new Date().toISOString(), errors: 0, capabilities: ["stream", "record", "ptz"], status: "online" },
  { id: "device2", name: "Kitchen Sensor", ipAddress: "192.168.1.102", uptime: "2d 5h", freeHeap: "1024KB", lastSeen: new Date().toISOString(), errors: 1, capabilities: ["temperature", "humidity"], status: "warning" },
  { id: "device3", name: "Garage Door", ipAddress: "192.168.1.103", uptime: "5h 15m", freeHeap: "256KB", lastSeen: new Date(Date.now() - 3600000 * 3).toISOString(), errors: 0, capabilities: ["open", "close", "status"], status: "offline" },
];

// Placeholder for system status
let systemStatus = {
  totalDevices: devices.length,
  onlineDevices: devices.filter(d => d.status === "online").length,
  systemLoad: "Low",
  storageUsage: "45%",
  lastBackup: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
};

// API Routes

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

// Stream endpoint
app.post('/api/v1/stream/stream', multer().single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image provided' });
  }
  
  // Save the image to the data directory
  const timestamp = Date.now();
  const deviceId = req.body.deviceId || 'unknown_device'; // Get deviceId from request body or use a default
  const filename = `${deviceId}_${timestamp}.jpg`;
  const filePath = path.join(dataDir, filename);

  fs.writeFile(filePath, req.file.buffer, (err) => {
    if (err) {
      console.error('Error saving image:', err);
      // Decide if you want to send an error response or still broadcast
      // For now, we'll log and continue to broadcast
    } else {
      console.log('Image saved:', filePath);
      cleanupOldRecordings(dataDir, 30000); // Cleanup files older than 30 seconds
    }
  });

  // Broadcast to WebSocket clients
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'frame',
        data: req.file.buffer.toString('base64'),
        timestamp: Date.now()
      }));
    }
  });
  
  res.json({ message: 'Frame received' });
});

// Endpoint to save the last 30 seconds of frames as a video recording
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

    // Sort files by timestamp to ensure correct order in video
    imageFilesToProcess.sort((a, b) => a.timestamp - b.timestamp);

    // Create a temporary directory for ffmpeg processing
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'recording-frames-'));

    // Copy sorted files to tempDir with sequential names
    for (let i = 0; i < imageFilesToProcess.length; i++) {
      const item = imageFilesToProcess[i];
      // Pad with 5 zeros, e.g., img-00001.jpg, handles up to 99999 frames.
      const tempFileName = `img-${String(i).padStart(5, '0')}.jpg`;
      await fsp.copyFile(item.filePath, path.join(tempDir, tempFileName));
    }
    frameCount = imageFilesToProcess.length;

    const recordingId = `rec_${Date.now()}.mp4`;
    const outputVideoPath = path.join(recordingsDir, recordingId);
    const inputPattern = path.join(tempDir, 'img-%05d.jpg');

    // Determine FPS, e.g., 10 FPS or based on actual frames over time
    // For simplicity, let's use a fixed FPS or calculate if possible.
    // If we have N frames over ~30s, FPS = N/30. Let's use 10 FPS as a default.
    const fps = Math.max(1, Math.min(30, Math.round(frameCount / 30))) || 10;


    await new Promise((resolve, reject) => {
      ffmpeg(inputPattern)
        .inputFPS(fps)
        .outputOptions([
          '-c:v libx264',       // Video codec
          '-pix_fmt yuv420p',   // Pixel format for compatibility
          '-movflags +faststart'// Optimize for web streaming
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

// Function to clean up old recordings
function cleanupOldRecordings(directory, maxAgeMs) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error("Error reading data directory for cleanup:", err);
      return;
    }

    const now = Date.now();
    files.forEach(file => {
      // Assuming filename format: deviceId_timestamp.jpg
      const parts = file.split('_');
      if (parts.length >= 2) {
        const timestampStr = parts[parts.length - 1].split('.')[0];
        const timestamp = parseInt(timestampStr, 10);
        if (!isNaN(timestamp) && (now - timestamp > maxAgeMs)) {
          const filePath = path.join(directory, file);
          fs.unlink(filePath, unlinkErr => {
            if (unlinkErr) {
              console.error(`Error deleting old file ${filePath}:`, unlinkErr);
            } else {
              console.log(`Deleted old file: ${filePath}`);
            }
          });
        }
      }
    });
  });
}

// Get all recordings (now lists video files)
app.get('/api/v1/stream/recordings', async (req, res) => {
  try {
    const files = await fsp.readdir(recordingsDir);
    // Filter for .mp4 files and map to desired format
    const videoRecordingsPromises = files
      .filter(file => file.toLowerCase().endsWith('.mp4'))
      .map(async (file) => {
        const filePath = path.join(recordingsDir, file);
        try {
          const stats = await fsp.stat(filePath); // Use async stat

          let createdAt = stats.birthtime || stats.mtime; // Fallback to mtime
          const match = file.match(/rec_(\d+)\.mp4/);
          if (match && match[1]) {
            createdAt = new Date(parseInt(match[1], 10));
          }

          return {
            id: file, // Use filename as ID
            name: file,
            url: `/recordings/${file}`, // Relative URL
            createdAt: createdAt.toISOString(),
            size: stats.size,
            type: 'video',
            // frameCount and durationText are harder to get from just listing files.
            // These were part of the POST /api/v1/stream/record response.
            // The frontend should handle these as optional for listed items.
          };
        } catch (statError) {
          console.error(`Failed to get stats for ${filePath}:`, statError);
          return null; // Skip this file if stat fails
        }
      });

    const videoRecordings = (await Promise.all(videoRecordingsPromises))
      .filter(Boolean) // Remove any nulls from failed stats
      .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
    res.json(videoRecordings);
  } catch (err) {
    console.error("Error reading recordings directory:", err);
    return res.status(500).json({ error: 'Failed to retrieve recordings' });
  }
});

// Endpoint to get all image frames
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
            url: `/data/${file}`, // Relative URL for client
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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()); // Sort by newest first
    res.json(imageFrames);
  } catch (err) {
    console.error("Error reading data directory for frames:", err);
    res.status(500).json({ error: 'Failed to retrieve image frames' });
  }
});

// GET /api/v1/devices - List all devices
app.get('/api/v1/devices', (req, res) => {
  // In a real app, you might want to update lastSeen or other dynamic properties here
  res.json(devices);
});

// GET /api/v1/system/status - Get system status
app.get('/api/v1/system/status', (req, res) => {
  // Update dynamic properties
  systemStatus.totalDevices = devices.length;
  systemStatus.onlineDevices = devices.filter(d => d.status === "online" || d.status === "warning").length; // Consider warning as online for count
  res.json(systemStatus);
});

// POST /api/v1/devices/:deviceId/command - Send a command to a device
app.post('/api/v1/devices/:deviceId/command', (req, res) => {
  const { deviceId } = req.params;
  const { command, payload } = req.body; // e.g., command: "reboot", payload: { delay: 5 }

  const device = devices.find(d => d.id === deviceId);

  if (!device) {
    return res.status(404).json({ message: "Device not found" });
  }

  console.log(`Received command '${command}' for device ${deviceId} with payload:`, payload);

  // Simulate command processing
  // In a real application, you would interact with the actual device here (e.g., via MQTT, HTTP, etc.)
  // For now, we'll just log it and return a success response.

  // Example: Update device status based on command
  if (command === 'reboot') {
    device.status = 'rebooting';
    setTimeout(() => {
      const d = devices.find(dev => dev.id === deviceId);
      if (d) d.status = 'online'; // Simulate it coming back online
      console.log(`Device ${deviceId} rebooted and is now online.`);
    }, 5000); // Simulate 5 seconds to reboot
  } else if (command === 'setActive') {
    // device.isActive = payload.active; // Assuming a property like isActive
    console.log(`Device ${deviceId} active state set to ${payload.active}`);
  }


  res.status(200).json({ message: `Command '${command}' sent to device ${deviceId} successfully.`, deviceStatus: device.status });
});

// Serve static files from the data directory
app.use('/data', express.static(dataDir));
// Serve static files from the recordings directory
app.use('/recordings', express.static(recordingsDir));

// Handle WebSocket upgrades
const server = app.listen(port, () => {
  console.log(`IoT Backend running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// SSH tunnel setup if configured
if (process.env.PUBLIC_VPS_IP) {
  const sshClient = createSshTunnel();
  if (sshClient) {
    console.log('SSH tunnel established');
  }
}

module.exports = server;