const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { initializeDatabase, Device, SensorData } = require('./database');

const dataDir = path.join(__dirname, '../data');
const recordingsDir = path.join(__dirname, '../recordings');
const permittedFacesDir = path.join(__dirname, '../permitted_faces');

[dataDir, recordingsDir, permittedFacesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function cleanupOldRecordings(directory, maxAgeMs) {
  fs.readdir(directory, (err, files) => {
    if (err) {
      console.error("Error reading directory for cleanup:", err);
      return;
    }
    const now = Date.now();
    files.forEach(file => {
      const parts = file.split('_');
      if (parts.length < 2) return;
      const timestamp = parseInt(parts[parts.length - 1].split('.')[0], 10);
      if (!isNaN(timestamp) && (now - timestamp > maxAgeMs)) {
        const filePath = path.join(directory, file);
        fs.unlink(filePath, unlinkErr => {
          if (unlinkErr) console.error(`Error deleting ${filePath}:`, unlinkErr);
          else console.log(`Deleted old file: ${filePath}`);
        });
      }
    });
  });
}

class DataStore {
  constructor() {
    console.log('📦 DataStore initialized. Database connection pending...');
    this.sequelize = null; // Will be set when database is ready
    this.Device = Device;
    this.SensorData = SensorData;
    this.dbReady = this.initializeDatabase();
    this.initializeCleanup();
  }

  async initializeDatabase() {
    try {
      this.sequelize = await initializeDatabase();
      console.log('✅ DataStore: Database connection ready.');
      return this.sequelize;
    } catch (error) {
      console.error('❌ DataStore: Failed to initialize database:', error);
      throw error;
    }
  }

  async initializeCleanup() {
    try {
      // Wait for DB to be ready before starting cleanup
      await this.dbReady;
      console.log('🧹 Database connected. Starting cleanup scheduler.');
      
      const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
      const FRAME_MAX_AGE_MS = 10 * 60 * 1000;
      setInterval(() => {
        console.log(`Running scheduled cleanup of old frames...`);
        cleanupOldRecordings(dataDir, FRAME_MAX_AGE_MS);
      }, CLEANUP_INTERVAL_MS);
    } catch (err) {
      console.error('Failed to initialize cleanup scheduler:', err);
    }
  }

  // --- DEVICE OPERATIONS (DATABASE) ---
  async registerDevice(device) {
    await this.dbReady; // Ensure database is ready
    
    const deviceData = {
      id: device.id,
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      status: device.status || 'online',
      lastSeen: Date.now(),
      capabilities: device.capabilities || []
    };
    
    // Use Sequelize upsert (update or insert)
    const [deviceRecord, created] = await this.Device.upsert(deviceData, {
      returning: true
    });
    
    console.log(`${created ? '🆕 Registered' : '🔄 Updated'} device: ${device.id}`);
    return deviceRecord;
  }

  async getDevice(deviceId) {
    await this.dbReady; // Ensure database is ready
    return await this.Device.findOne({
      where: { id: deviceId }
    });
  }

  async getAllDevices() {
    await this.dbReady; // Ensure database is ready
    return await this.Device.findAll({
      order: [['lastSeen', 'DESC']]
    });
  }

  async updateDevice(deviceId, updates) {
    if (!deviceId) return null;
    await this.dbReady; // Ensure database is ready
    
    const updateData = { ...updates, lastSeen: Date.now() };
    await this.Device.update(updateData, {
      where: { id: deviceId }
    });
    
    return await this.getDevice(deviceId);
  }

  // --- SENSOR DATA OPERATIONS (DATABASE) ---
  async saveSensorData(data) {
    await this.dbReady; // Ensure database is ready
    
    const payload = {
      deviceId: data.deviceId,
      timestamp: data.timestamp || Date.now(),
      temperature: data.temperature,
      humidity: data.humidity,
      distance: data.distance,
      lightLevel: data.lightLevel,
      pressure: data.pressure,
      altitude: data.altitude,
      co2Level: data.co2Level,
      customData: data.customData
    };
    
    // Save sensor data
    const sensorRecord = await this.SensorData.create(payload);
    
    // Update device's lastSeen timestamp
    await this.updateDevice(data.deviceId, {});
    
    console.log(`💾 Saved sensor data for device: ${data.deviceId}`);
    return sensorRecord;
  }

  async getSensorData(deviceId, limit = 100) {
    await this.dbReady; // Ensure database is ready
    return await this.SensorData.findAll({
      where: { deviceId },
      order: [['timestamp', 'DESC']],
      limit,
      include: [{
        model: this.Device,
        as: 'device',
        attributes: ['name', 'type']
      }]
    });
  }

  // --- FACE RECOGNITION (remains the same) ---
  async performFaceRecognition(imageBuffer) {
    const pythonServiceUrl = process.env.PYTHON_GPU_SERVICE_URL || 'http://localhost:9001';
    const serviceEnabled = process.env.PYTHON_GPU_SERVICE_ENABLED !== 'false';

    console.log(`[Face Recognition] Service URL: ${pythonServiceUrl}/recognize, Enabled: ${serviceEnabled}`);

    if (!serviceEnabled) {
      console.log('[Face Recognition] Service is disabled in configuration.');
      return {
        status: 'service_disabled',
        recognizedAs: null,
        error: 'Face recognition service is disabled.'
      };
    }

    try {
      const FormData = require('form-data');
      const { default: fetch } = await import('node-fetch');
      
      const form = new FormData();
      form.append('image', imageBuffer, { 
        filename: 'frame.jpg',
        contentType: 'image/jpeg'
      });
      
      console.log(`[Face Recognition] Attempting to call Python GPU service at: ${pythonServiceUrl}/api/v1/recognize`);

      const response = await fetch(`${pythonServiceUrl}/api/v1/recognize`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 15000 
      });
      
      console.log(`[Face Recognition] Response status from Python service: ${response.status}`);

      if (response.ok) {
        const result = await response.json();
        console.log('[Face Recognition] Raw result from Python service:', result);
        
        if (result.status === 'permitted_face' || (result.status === 'success' && result.recognized_faces && result.recognized_faces.length > 0)) {
          const faceName = result.recognizedAs || (result.recognized_faces && result.recognized_faces[0] ? result.recognized_faces[0].name : 'Unknown');
          const confidence = result.confidence || (result.recognized_faces && result.recognized_faces[0] ? result.recognized_faces[0].confidence : null);
          return {
            status: 'recognized',
            recognizedAs: faceName,
            confidence: confidence,
            faces_detected: result.faces_detected,
            processing_time: result.processing_time
          };
        } else if (result.status === 'unknown_face' || (result.status === 'success' && result.faces_detected > 0 && (!result.recognized_faces || result.recognized_faces.length === 0))) {
          return {
            status: 'unknown_face',
            recognizedAs: null,
            faces_detected: result.faces_detected,
            processing_time: result.processing_time
          };
        } else if (result.status === 'no_face_detected' || result.status === 'no_faces' || (result.status === 'success' && result.faces_detected === 0)) {
           return {
            status: 'no_faces',
            recognizedAs: null,
            faces_detected: 0,
            processing_time: result.processing_time
          };
        } else {
            console.warn('[Face Recognition] Unexpected success response structure or status from Python service:', result);
            return {
                status: result.status || 'unexpected_response',
                recognizedAs: null,
                error: 'Unexpected response structure from recognition service.',
                details: result
            };
        }
      } else {
        const errorBody = await response.text();
        console.error(`[Face Recognition] Python service at ${pythonServiceUrl}/recognize returned error ${response.status}: ${errorBody}`);
        return {
          status: 'service_error',
          recognizedAs: null,
          error: `Recognition service returned ${response.status}`,
          details: errorBody
        };
      }
      
    } catch (err) {
      console.error(`[Face Recognition] Error calling Python GPU service at ${pythonServiceUrl}/recognize: ${err.message}`, err);
      if (err.name === 'AbortError' || err.message.toLowerCase().includes('timeout')) {
        return {
          status: 'service_timeout',
          recognizedAs: null,
          error: `Request to recognition service timed out: ${err.message}`
        };
      }
      return {
        status: 'service_error',
        recognizedAs: null,
        error: `Failed to connect to recognition service: ${err.message}`
      };
    }
  }

  async addPermittedFace(imageBuffer, subjectName) {
    try {
      const FormData = require('form-data');
      const { default: fetch } = await import('node-fetch');
      const pythonServiceUrl = process.env.PYTHON_GPU_SERVICE_URL || 'http://localhost:9001';
      
      const form = new FormData();
      form.append('image', imageBuffer, {
        filename: 'permitted_face.jpg',
        contentType: 'image/jpeg'
      });
      form.append('name', subjectName);
      
      const response = await fetch(`${pythonServiceUrl}/api/v1/recognition/add-permitted-face`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders()
      });
      
      if (response.ok) {
        const result = await response.json();
        return result;
      } else {
        const errorBody = await response.text();
        console.error(`Error adding permitted face via Python service: ${response.status}`, errorBody);
        throw new Error(`Failed to add permitted face via Python service. Status: ${response.status}. Body: ${errorBody}`);
      }
    } catch (error) {
      console.error("Error in addPermittedFace function:", error);
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