import axios from 'axios';
import { CONFIG } from '@/config';

// Type definitions
interface DeviceRegistration {
  id: string;
  name: string;
  type: string;
  ipAddress: string;
  capabilities: string[];
}

interface SensorData {
  deviceId: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
}

interface CameraFrameHeaders {
  'X-Device-ID': string;
  'X-Frame-Width': number;
  'X-Frame-Height': number;
}

interface DeviceInfo {
  id: string;
  name: string;
  type: string;
  status: string;
  lastSeen: number;
}

interface SensorDataResponse {
  data: Array<{
    timestamp: number;
    temperature: number;
    humidity: number;
    distance: number;
    lightLevel: number;
  }>;
}

interface BuzzerStatus {
  deviceId: string;
  status: boolean;
  lastUpdated: number;
}

// Create axios instance with default configuration
const api = axios.create({
  baseURL: CONFIG.BACKEND_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': CONFIG.API_KEY,
    'Content-Type': 'application/json'
  }
});

// Add request interceptor to ensure API key is always included
api.interceptors.request.use(
  (config) => {
    config.headers['X-API-Key'] = CONFIG.API_KEY;
    console.log('🔐 API Request:', {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      fullURL: `${config.baseURL}${config.url}`,
      headers: {
        'X-API-Key': config.headers['X-API-Key'],
        'Content-Type': config.headers['Content-Type']
      },
      timeout: config.timeout
    });
    return config;
  },
  (error) => {
    console.error('❌ API Request Setup Error:', error);
    return Promise.reject(error);
  }
);

// Add response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    console.log('✅ API Response Success:', {
      status: response.status,
      statusText: response.statusText,
      url: response.config.url,
      dataType: typeof response.data,
      dataSize: JSON.stringify(response.data).length
    });
    return response;
  },
  (error) => {
    console.error('❌ API Response Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      message: error.message,
      data: error.response?.data
    });
    
    if (error.response?.status === 401) {
      console.error('🚫 Authentication failed details:', {
        expectedApiKey: CONFIG.API_KEY,
        sentApiKey: error.config?.headers?.['X-API-Key'],
        backendUrl: CONFIG.BACKEND_URL
      });
    }
    
    if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error')) {
      console.error('🌐 Network connectivity issue - check if backend is running');
    }
    
    return Promise.reject(error);
  }
);

// Device Management API
export const registerDevice = async (deviceData: DeviceRegistration) => {
  return api.post('/api/v1/devices/register', deviceData);
};

export const getDevices = async (): Promise<{ data: { devices: any[] } }> => {
  return api.get('/api/v1/devices');
};

// Sensor Data API
export const ingestSensorData = async (sensorData: SensorData) => {
  return api.post('/api/v1/ingest/sensor-data', sensorData);
};

export const getSensorData = async (deviceId: string): Promise<{ data: any[] }> => {
  return api.get(`/api/v1/sensor-data?deviceId=${encodeURIComponent(deviceId)}&limit=100`);
};

// Camera API
export const streamCameraFrame = async (
  frameData: ArrayBuffer,
  headers: CameraFrameHeaders
) => {
  return api.post('/api/v1/stream/stream', frameData, {
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream'
    }
  });
};

// Buzzer Control API
export const requestBuzzer = async (deviceId: string, status: boolean): Promise<BuzzerStatus> => {
  return api.post('/api/v1/buzzer/control', { deviceId, status });
};

export const getBuzzerStatus = async (deviceId: string): Promise<BuzzerStatus> => {
  return api.get(`/api/v1/buzzer/status?deviceId=${encodeURIComponent(deviceId)}`);
};

export default api;