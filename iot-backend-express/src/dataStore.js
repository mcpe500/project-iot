const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { initializeDatabase, Device, SensorData, BuzzerRequest } = require('./database');
const { DatabaseOptimizer } = require('./databaseOptimizer');

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
    console.log('📦 DataStore initialized with high-performance caching.');
    this.USEDB = process.env.USEDB !== 'false';
    this.sequelize = null;
    this.Device = Device;
    this.SensorData = SensorData;
    this.BuzzerRequest = BuzzerRequest;
    
    this.dbOptimizer = null;
    
    // Performance monitoring
    this.performanceMetrics = {
      operationsCount: 0,
      averageResponseTime: 0,
      totalResponseTime: 0,
      lastOptimizationTime: Date.now()
    };

    // Batch operation queues for high-throughput scenarios
    this.deviceUpdateQueue = new Map();
    this.sensorDataQueue = [];
    this.buzzerRequestQueue = [];
    
    // Start batch processing
    this.startBatchProcessor();
    
    if (this.USEDB) {
      console.log('Database connection pending...');
      this.dbReady = this.initializeDatabase();
      this.initializeCleanup();
    } else {
      console.log('Database operations disabled (USEDB=false). Using stub methods.');
      this.dbReady = Promise.resolve();
    }
  }

  async initializeDatabase() {
    try {
      this.sequelize = await initializeDatabase();
      this.dbOptimizer = new DatabaseOptimizer(this.sequelize);
      console.log('✅ DataStore: Database connection ready with optimizations.');
      return this.sequelize;
    } catch (error) {
      console.error('❌ DataStore: Failed to initialize database:', error);
      throw error;
    }
  }

  // High-performance batch processor
  startBatchProcessor() {
    // Process device updates in batches
    setInterval(() => {
      if (this.deviceUpdateQueue.size > 0) {
        this.processBatchDeviceUpdates();
      }
    }, 100); // Every 100ms

    // Process sensor data in batches
    setInterval(() => {
      if (this.sensorDataQueue.length > 0) {
        this.processBatchSensorData();
      }
    }, 100); // Reduced to 100ms for faster processing

    // Process buzzer requests
    setInterval(() => {
      if (this.buzzerRequestQueue.length > 0) {
        this.processBatchBuzzerRequests();
      }
    }, 150); // Every 150ms

    // Performance metrics update
    setInterval(() => {
      this.updatePerformanceMetrics();
    }, 5000); // Every 5 seconds
  }

  async processBatchDeviceUpdates() {
    if (!this.USEDB || this.deviceUpdateQueue.size === 0) return;

    const updates = Array.from(this.deviceUpdateQueue.values());
    this.deviceUpdateQueue.clear();

    try {
      // Group updates by device for optimization
      const deviceGroups = new Map();
      updates.forEach(update => {
        if (!deviceGroups.has(update.id)) {
          deviceGroups.set(update.id, []);
        }
        deviceGroups.get(update.id).push(update);
      });

      // Process each device's updates
      const promises = [];
      for (const [deviceId, deviceUpdates] of deviceGroups) {
        // Merge all updates for the same device
        const mergedUpdate = deviceUpdates.reduce((merged, update) => ({
          ...merged,
          ...update,
          lastSeen: Date.now() // Always use current time
        }), {});

        // Ensure required fields have valid values (handle null/undefined)
        const sanitizedUpdate = {
          ...mergedUpdate,
          uptime: mergedUpdate.uptime ?? 0,
          freeHeap: mergedUpdate.freeHeap ?? 0,
          wifiRssi: mergedUpdate.wifiRssi ?? 0,
          capabilities: mergedUpdate.capabilities || []
        };

        promises.push(this.dbOptimizer.optimizedUpsert(this.Device, sanitizedUpdate));
        
        // Process device update
      }

      await Promise.all(promises);
      console.log(`🚀 Batch processed ${updates.length} device updates`);
    } catch (error) {
      console.error('Batch device update error:', error);
    }
  }

  async processBatchSensorData() {
    if (!this.USEDB || this.sensorDataQueue.length === 0) return;

    const sensorData = [...this.sensorDataQueue];
    this.sensorDataQueue.length = 0;

    // Filter out any invalid data entries
    const validSensorData = sensorData.filter(data => 
      data && data.deviceId && (data.timestamp || data.temperature !== undefined || data.humidity !== undefined)
    );

    if (validSensorData.length === 0) {
      console.log('📊 No valid sensor data to process in batch');
      return;
    }

    try {
      await this.dbOptimizer.optimizedBulkCreate(this.SensorData, validSensorData, {
        ignoreDuplicates: true,
        batchSize: 500
      });

      console.log(`📊 Batch processed ${validSensorData.length} sensor data entries`);
    } catch (error) {
      console.error('Batch sensor data error:', error);
      // Re-queue failed data for retry (with limit to prevent infinite loops)
      if (validSensorData.length < 100) {
        this.sensorDataQueue.push(...validSensorData);
      }
    }
  }

  async processBatchBuzzerRequests() {
    if (!this.USEDB || this.buzzerRequestQueue.length === 0) return;

    const requests = [...this.buzzerRequestQueue];
    this.buzzerRequestQueue.length = 0;

    // Filter out invalid requests
    const validRequests = requests.filter(request => 
      request && request.deviceId && request.requestedAt
    );

    if (validRequests.length === 0) {
      console.log('🔔 No valid buzzer requests to process in batch');
      return;
    }

    try {
      await this.dbOptimizer.optimizedBulkCreate(this.BuzzerRequest, validRequests, {
        ignoreDuplicates: true
      });

      console.log(`🔔 Batch processed ${validRequests.length} buzzer requests`);
    } catch (error) {
      console.error('Batch buzzer request error:', error);
      // Re-queue failed requests for retry (with limit)
      if (validRequests.length < 50) {
        this.buzzerRequestQueue.push(...validRequests);
      }
    }
  }

  updatePerformanceMetrics() {
    this.performanceMetrics.operationsCount += 1;
    
    // Log performance summary
    if (this.performanceMetrics.operationsCount % 100 === 0) {
      console.log('📈 Performance Summary:', {
        cacheHitRate: this.performanceMetrics.cacheHitRate,
        operations: this.performanceMetrics.operationsCount,
        queueSizes: {
          devices: this.deviceUpdateQueue.size,
          sensorData: this.sensorDataQueue.length,
          buzzer: this.buzzerRequestQueue.length
        }
      });
    }
  }

  updateResponseTime(startTime) {
    const responseTime = Date.now() - startTime;
    this.performanceMetrics.totalResponseTime += responseTime;
    this.performanceMetrics.averageResponseTime = 
      this.performanceMetrics.totalResponseTime / this.performanceMetrics.operationsCount;
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

  // --- OPTIMIZED DEVICE OPERATIONS WITH INTELLIGENT CACHING ---
  async registerDevice(device) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: registerDevice called (USEDB=false)');
      return { ...device, lastSeen: Date.now() };
    }

    // Queue device update for batch processing
    await this.dbReady;
    
    const deviceData = {
      id: device.id,
      name: device.name,
      type: device.type,
      ipAddress: device.ipAddress,
      status: 'online',
      lastSeen: Date.now(),
      uptime: 0,
      freeHeap: 0,
      wifiRssi: 0,
      capabilities: []
    };
    
    try {
      // Use optimized upsert
      const [deviceRecord, created] = await this.dbOptimizer.optimizedUpsert(this.Device, deviceData);
      
      // Return the device record
      console.log(`${created ? '🆕 Registered' : '🔄 Updated'} device: ${device.id}`);
      this.updateResponseTime(startTime);
      return deviceRecord;
    } catch (error) {
      console.error('Error in registerDevice:', error);
      // Fallback: queue for batch processing
      this.deviceUpdateQueue.set(device.id, deviceData);
      this.updateResponseTime(startTime);
      return deviceData;
    }
  }

  async getDevice(deviceId) {
    const startTime = Date.now();
    
    if (!this极USEDB) {
      console.log('Stub: getDevice called (USEDB=false)');
      return null;
    }

    await this.dbReady;
    
    try {
      const device = await this.dbOptimizer.optimizedFindOne(this.Device, {
        where: { id: deviceId }
      });
      
      // Return the device
      this.updateResponseTime(startTime);
      return device;
    } catch (error) {
      console.error('Error in getDevice:', error);
      this.updateResponseTime(startTime);
      return null;
    }
  }

  async getAllDevices() {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: getAllDevices called (USEDB=false)');
      return [];
    }

    await this.dbReady;
    
    try {
      const devices = await this.dbOptimizer.optimizedFindAll(this.Device, {
        order: [['lastSeen', 'DESC']],
        limit: 100 // Reasonable limit for UI
      });
      
      // Return the devices
      this.updateResponseTime(startTime);
      return devices;
    } catch (error) {
      console.error('Error in getAllDevices:', error);
      this.updateResponseTime(startTime);
      return [];
    }
  }

  async updateDevice(deviceId, updates) {
    const startTime = Date.now();
    
    if (!deviceId) {
      this.updateResponseTime(startTime);
      return null;
    }
    
    if (!this.USEDB) {
      console.log('Stub: updateDevice called (USEDB=false)');
      return { id: deviceId, ...updates, lastSeen: Date.now() };
    }

    await this.dbReady;
    
    try {
      // Sanitize update data to prevent null violations
      const updateData = { 
        ...updates, 
        lastSeen: Date.now()
      };
      
      // Ensure required fields have valid values if they're being updated
      if ('uptime' in updateData && updateData.uptime == null) {
        updateData.uptime = 0;
      }
      if ('freeHeap' in updateData && updateData.freeHeap == null) {
        updateData.freeHeap = 0;
      }
      if ('wifiRssi' in updateData && updateData.wifiRssi == null) {
        updateData.wifiRssi = 0;
      }
      
      // Use optimized update
      await this.dbOptimizer.optimizedUpdate(this.Device, updateData, {
        where: { id: deviceId }
      });
      
      // Get the updated device
      const updatedDevice = await this.getDevice(deviceId);
      
      this.updateResponseTime(startTime);
      return updatedDevice;
    } catch (error) {
      console.error('Error in updateDevice:', error);
      this.updateResponseTime(startTime);
      return null;
    }
  }

  // --- OPTIMIZED SENSOR DATA OPERATIONS WITH INTELLIGENT CACHING ---
  async saveSensorData(data) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: saveSensorData called (USEDB=false)');
      return { ...data, timestamp: Date.now() };
    }

    const deviceId = data.deviceId;
    if (!deviceId) {
      throw new Error('Device ID is required for sensor data');
    }

    // Prepare sensor data payload
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

    // Auto-register device if not already registered
    const deviceData = {
      id: deviceId,
      name: data.deviceName || deviceId,
      type: data.deviceType || 'sensor',
      ipAddress: data.ipAddress || '',
      status: 'online',
      lastSeen: Date.now(),
      uptime: 0,
      freeHeap: 0,
      wifiRssi: 0,
      capabilities: []
    };
    this.deviceUpdateQueue.set(deviceId, deviceData);

    // Immediately save sensor data to database
    const savedData = await this.dbOptimizer.optimizedCreate(this.SensorData, payload);
    
    // Log successful save with timestamp
    console.log(`✅ Saved sensor data for ${deviceId} at ${new Date(savedData.timestamp).toISOString()}`);
    
    this.updateResponseTime(startTime);
    return savedData;
  }

  async getSensorData(deviceId, limit = 100) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: getSensorData called (USEDB=false)');
      return [];
    }

    await this.dbReady;
    
    try {
      const sensorData = await this.dbOptimizer.optimizedFindAll(this.SensorData, {
        where: { deviceId },
        order: [['timestamp', 'DESC']],
        limit
      });
      // Return the sensor data
      this.updateResponseTime(startTime);
      return sensorData;
    } catch (error) {
      console.error('Error in getSensorData:', error);
      this.updateResponseTime(startTime);
      return [];
    }
  }

  // --- OPTIMIZED BUZZER REQUEST OPERATIONS WITH INTELLIGENT CACHING ---
  async createBuzzerRequest(deviceId) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: createBuzzerRequest called (USEDB=false)');
      return { deviceId, requestedAt: Date.now(), status: 'pending' };
    }
    
    if (!deviceId) {
      throw new Error('Device ID is required');
    }
    
    const requestData = {
      deviceId,
      requestedAt: Date.now(),
      status: 'pending'
    };
    
    // Queue for batch processing (high-throughput mode)
    this.buzzerRequestQueue.push(requestData);
    
    // Return the request data
    
    this.updateResponseTime(startTime);
    console.log(`🔔 Queued buzzer request for device: ${deviceId} (batch processing)`);
    return requestData; // Return immediately without waiting for DB
  }

  async getBuzzerStatus(deviceId) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: getBuzzerStatus called (USEDB=false)');
      return { status: 'no_requests' };
    }
    
    await this.dbReady;
    
    try {
      const request = await this.dbOptimizer.optimizedFindOne(this.BuzzerRequest, {
        where: { deviceId },
        order: [['requestedAt', 'DESC']]
      });
      
      if (!request) {
        this.updateResponseTime(startTime);
        return { status: 'no_requests' };
      }
      
      // Return the status
      this.updateResponseTime(startTime);
      return {
        status: request.status,
        lastRequestedAt: request.requestedAt,
        lastBuzzedAt: request.buzzedAt
      };
    } catch (error) {
      console.error('Error in getBuzzerStatus:', error);
      this.updateResponseTime(startTime);
      return { status: 'no_requests' };
    }
  }

  async completeBuzzerRequest(requestId) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: completeBuzzerRequest called (USEDB=false)');
      return { id: requestId, status: 'completed', buzzedAt: Date.now() };
    }
    
    await this.dbReady;
    
    try {
      const updateData = {
        status: 'completed',
        buzzedAt: Date.now()
      };
      
      const [updated] = await this.dbOptimizer.optimizedUpdate(this.BuzzerRequest, updateData, {
        where: { id: requestId }
      });
      
      if (updated === 0) {
        throw new Error('Buzzer request not found');
      }
      
      const updatedRequest = await this.dbOptimizer.optimizedFindByPk(this.BuzzerRequest, requestId);
      
      // Return the updated request
      
      this.updateResponse极(startTime);
      console.log(`✅ Completed buzzer request: ${requestId}`);
      return updatedRequest;
    } catch (error) {
      console.error('Error in completeBuzzerRequest:', error);
      this.updateResponseTime(startTime);
      throw error;
    }
  }

  async getBuzzerRequests(deviceId, limit = 极) {
    const startTime = Date.now();
    
    if (!this.USEDB) {
      console.log('Stub: getBuzzerRequests called (USEDB=false)');
      return [];
    }
    
    await this.dbReady;
    
    try {
      const requests = await this.dbOptimizer.optimizedFindAll(this.BuzzerRequest, {
        where: { deviceId },
        order: [['requestedAt', 'DESC']],
        limit
      });
      // Return the requests
      this.updateResponseTime(startTime);
      return requests;
    } catch (error) {
      console.error('Error in getBuzzerRequests:', error);
      this.updateResponseTime(startTime);
      return [];
    }
  }

  // --- FACE RECOGNITION (optimized for high FPS) ---
  async performFaceRecognition(imageBuffer) {
    const pythonServiceUrl = process.env.PYTHON_GPU_SERVICE_URL || 'http://localhost:9001';
    const serviceEnabled = process.env.PYTHON_GPU_SERVICE_ENABLED !== 'false';

    if (!serviceEnabled) {
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

      const response = await fetch(`${pythonServiceUrl}/api/v1/recognize`, {
        method: 'POST',
        body: form,
        headers: form.getHeaders(),
        timeout: 3000  // Reduced timeout for faster response
      });

      if (response.ok) {
        const result = await response.json();
        
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
      console.error(`[Face Recognition] Error calling Python GPU service at ${pythonServiceUrl}/recognize: ${极.message}`, err);
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