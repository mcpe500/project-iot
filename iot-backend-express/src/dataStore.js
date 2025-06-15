const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Ensure directories exist
const dataDir = path.join(__dirname, '../data');
const recordingsDir = path.join(__dirname, '../recordings');
const permittedFacesDir = path.join(__dirname, '../permitted_faces');

[dataDir, recordingsDir, permittedFacesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Simplified face recognition - delegated to Python service
let faceRecognitionEnabled = false;

// Function to clean up old recordings
function cleanupOldRecordings(directory, maxAgeMs) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error("Error reading data directory for cleanup:", err);
      return;
    }

    const now = Date.now();
    files.forEach(file => {
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

// Data store implementation
class DataStore {
  constructor() {
    this.devices = new Map();
    this.sensorData = new Map();
    this.commands = new Map();
    this.notes = new Map();
    this.nextNoteId = 1;
    
    console.log('DataStore initialized - Face recognition delegated to Python service');
    
    // Setup automatic cleanup
    const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const FRAME_MAX_AGE_MS = 10 * 60 * 1000;   // 10 minutes
    
    setInterval(() => {
      console.log(`Running scheduled cleanup of old frames (older than ${FRAME_MAX_AGE_MS / 60000} mins)...`);
      cleanupOldRecordings(dataDir, FRAME_MAX_AGE_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  // Device operations
  updateDevice(deviceId, updates) {
    const device = this.devices.get(deviceId);
    if (device) {
      Object.assign(device, updates, { lastSeen: Date.now() });
      this.devices.set(deviceId, device);
      return device;
    }
    return null;
  }

  registerDevice(device) {
    const existingDevice = this.devices.get(device.id);
    if (existingDevice) {
      const updatedDevice = {
        ...existingDevice,
        ...device,
        lastSeen: Date.now()
      };
      this.devices.set(device.id, updatedDevice);
      return updatedDevice;
    } else {
      const newDevice = {
        ...device,
        status: device.status || 'online',
        lastSeen: Date.now(),
        errors: 0
      };
      this.devices.set(device.id, newDevice);
      return newDevice;
    }
  }

  getDevice(deviceId) {
    return this.devices.get(deviceId);
  }

  getAllDevices() {
    return Array.from(this.devices.values());
  }

  getSystemStatus() {
    return {
      devicesOnline: this.getAllDevices().filter(d => d.status === 'online').length,
      devicesTotal: this.devices.size,
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }

  getDeviceStatusSummary() {
    const devices = this.getAllDevices();
    return {
      total: devices.length,
      online: devices.filter(d => d.status === 'online').length,
      offline: devices.filter(d => d.status === 'offline').length,
      warning: devices.filter(d => d.status === 'warning').length,
      error: devices.filter(d => d.status === 'error').length
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

  // GPU-accelerated face recognition via Python service
  async performFaceRecognition(imageBuffer) {
    try {
      const FormData = require('form-data');
      const { default: fetch } = await import('node-fetch');
      
      const form = new FormData();
      form.append('file', imageBuffer, {
        filename: 'frame.jpg',
        contentType: 'image/jpeg'
      });
      
      // Call Python GPU face recognition service
      const response = await fetch('http://localhost:8001/recognize', {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 5000 // 5 second timeout
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.status === 'success' && result.recognized_faces && result.recognized_faces.length > 0) {
          // Found recognized faces
          const bestMatch = result.recognized_faces[0];
          return {
            status: 'recognized',
            recognizedAs: bestMatch.name,
            confidence: bestMatch.confidence,
            faces_detected: result.faces_detected,
            processing_time: result.processing_time
          };
        } else if (result.status === 'success' && result.faces_detected > 0) {
          // Faces detected but not recognized
          return {
            status: 'unknown_face',
            recognizedAs: null,
            faces_detected: result.faces_detected,
            processing_time: result.processing_time
          };
        } else {
          // No faces detected
          return {
            status: 'no_faces',
            recognizedAs: null,
            faces_detected: 0,
            processing_time: result.processing_time
          };
        }
      } else {
        console.log('Face recognition service unavailable, response status:', response.status);
        return {
          status: 'service_unavailable',
          recognizedAs: null
        };
      }
    } catch (error) {
      console.log('Face recognition service error:', error.message);
      return {
        status: 'service_error',
        recognizedAs: null,
        error: error.message
      };
    }
  }

  async addPermittedFace(imageBuffer, subjectName) {
    try {
      // Call Python service to add permitted face
      const FormData = require('form-data');
      const { default: fetch } = await import('node-fetch');
      
      const form = new FormData();
      form.append('image', imageBuffer, {
        filename: 'permitted_face.jpg',
        contentType: 'image/jpeg'
      });
      form.append('name', subjectName);
      
      const response = await fetch('http://localhost:9003/api/v1/recognition/add-permitted-face', {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });
      
      if (response.ok) {
        const result = await response.json();
        return result;
      } else {
        throw new Error('Failed to add permitted face via Python service');
      }
    } catch (error) {
      console.error("Error adding permitted face:", error);
      throw error;
    }
  }
}

module.exports = {
  DataStore,
  dataDir,
  recordingsDir,
  permittedFacesDir,
  cleanupOldRecordings
};