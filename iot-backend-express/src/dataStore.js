const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

// Face recognition imports
const faceapi = require('face-api.js');
const canvasModule = require('canvas');
const { Canvas, Image, ImageData } = canvasModule;
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Ensure directories exist
const dataDir = path.join(__dirname, '../data');
const recordingsDir = path.join(__dirname, '../recordings');
const permittedFacesDir = path.join(__dirname, '../permitted_faces');

[dataDir, recordingsDir, permittedFacesDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Face Recognition Model Loading
let faceMatcher = null;
const modelsPath = path.join(__dirname, '../models');

async function loadModels() {
  try {
    console.log("Loading face recognition models...");
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
    await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
    await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
    console.log("Face recognition models loaded successfully.");
    await loadPermittedFaces();
  } catch (error) {
    console.error("Error loading face recognition models:", error);
    console.error("Please ensure models are downloaded and correctly placed in:", modelsPath);
  }
}

async function loadPermittedFaces() {
  if (!faceapi.nets.faceRecognitionNet.isLoaded) {
    console.warn("Face recognition model not loaded yet. Skipping loading permitted faces.");
    return;
  }
  console.log("Loading permitted faces...");
  const permittedDescriptors = [];
  try {
    const files = await fsp.readdir(permittedFacesDir);
    for (const file of files) {
      if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.jpeg') || file.toLowerCase().endsWith('.png')) {
        const imgPath = path.join(permittedFacesDir, file);
        const img = await canvasModule.loadImage(imgPath);
        const detections = await faceapi.detectSingleFace(img).withFaceLandmarks().withFaceDescriptor();
        if (detections) {
          const label = path.basename(file, path.extname(file));
          permittedDescriptors.push(new faceapi.LabeledFaceDescriptors(label, [detections.descriptor]));
          console.log(`Loaded descriptor for ${label} from ${file}`);
        } else {
          console.warn(`No face detected in permitted image: ${file}`);
        }
      }
    }
    if (permittedDescriptors.length > 0) {
      faceMatcher = new faceapi.FaceMatcher(permittedDescriptors);
      console.log(`Loaded ${permittedDescriptors.length} permitted face(s).`);
    } else {
      faceMatcher = null;
      console.log("No permitted faces loaded.");
    }
  } catch (error) {
    console.error("Error loading permitted faces:", error);
    faceMatcher = null;
  }
}

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
    
    // Initialize face recognition
    loadModels();
    
    // Setup automatic cleanup
    const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const FRAME_MAX_AGE_MS = 10 * 60 * 1000;   // 10 minutes
    
    setInterval(() => {
      console.log(`Running scheduled cleanup of old frames (older than ${FRAME_MAX_AGE_MS / 60000} mins)...`);
      cleanupOldRecordings(dataDir, FRAME_MAX_AGE_MS);
    }, CLEANUP_INTERVAL_MS);
  }

  // Device operations
  registerDevice(device) {
    this.devices.set(device.id, device);
    return device;
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

  // Sensor data operations
  saveSensorData(data) {
    if (!this.sensorData.has(data.deviceId)) {
      this.sensorData.set(data.deviceId, []);
    }
    this.sensorData.get(data.deviceId).push(data);
    return data;
  }

  // Face recognition operations
  async performFaceRecognition(imageBuffer) {
    if (!faceMatcher) {
      return {
        status: 'models_not_loaded',
        recognizedAs: null
      };
    }

    try {
      const img = await canvasModule.loadImage(imageBuffer);
      const detections = await faceapi.detectAllFaces(img).withFaceLandmarks().withFaceDescriptors();
      
      if (detections.length > 0) {
        let recognitionStatus = 'unknown_face';
        let recognizedAs = null;
        
        for (const detection of detections) {
          const bestMatch = faceMatcher.findBestMatch(detection.descriptor);
          if (bestMatch && bestMatch.label !== 'unknown' && bestMatch.distance < 0.5) {
            recognitionStatus = 'permitted_face';
            recognizedAs = bestMatch.label;
            console.log(`Permitted face detected: ${recognizedAs} (Distance: ${bestMatch.distance})`);
            break;
          } else if (bestMatch) {
            console.log(`Detected face, best match: ${bestMatch.label} (Distance: ${bestMatch.distance}) - Not permitted or distance too high.`);
          }
        }
        
        if (recognitionStatus === 'unknown_face' && recognizedAs === null) {
          console.log('Unknown face(s) detected in stream.');
        }
        
        return { status: recognitionStatus, recognizedAs };
      } else {
        return { status: 'no_face_detected', recognizedAs: null };
      }
    } catch (error) {
      console.error("Error during face recognition:", error);
      return { status: 'recognition_error', recognizedAs: null };
    }
  }

  async addPermittedFace(imageBuffer, subjectName) {
    if (!faceapi.nets.faceRecognitionNet.isLoaded) {
      throw new Error('Face recognition models not ready. Please try again later.');
    }

    const safeSubjectName = subjectName.replace(/[^a-z0-9_.-]/gi, '_');
    const filename = `${safeSubjectName}.jpg`;
    const filePath = path.join(permittedFacesDir, filename);

    // Check if face is detectable before saving
    const tempImage = await canvasModule.loadImage(imageBuffer);
    const detection = await faceapi.detectSingleFace(tempImage).withFaceLandmarks().withFaceDescriptor();
    
    if (!detection) {
      throw new Error('No face detected in the uploaded image. Please provide a clear frontal face image.');
    }

    await fsp.writeFile(filePath, imageBuffer);
    console.log(`Permitted face image saved: ${filePath}`);
    
    // Reload permitted faces to update the faceMatcher
    await loadPermittedFaces();
    
    return { success: true, filename, subjectName: safeSubjectName };
  }
}

module.exports = {
  DataStore,
  dataDir,
  recordingsDir,
  permittedFacesDir,
  cleanupOldRecordings,
  canvasModule
};