const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const multer = require('multer');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dotenv = require('dotenv');
const { createSshTunnel } = require('../job/tunnel');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
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

// Get all recordings
app.get('/api/v1/stream/recordings', (req, res) => {
  fs.readdir(dataDir, (err, files) => {
    if (err) {
      console.error("Error reading data directory:", err);
      return res.status(500).json({ error: 'Failed to retrieve recordings' });
    }
    // Optional: Filter for specific file types if needed, e.g., .jpg, .mp4
    const recordings = files.map(file => ({
      filename: file,
      url: `/data/${file}` // Or a more direct way to serve/access files if needed
    }));
    res.json(recordings);
  });
});

// Serve static files from the data directory
app.use('/data', express.static(dataDir));

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