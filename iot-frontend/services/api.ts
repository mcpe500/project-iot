import axios, { AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { CONFIG } from '@/config';

// Extend InternalAxiosRequestConfig to include required metadata
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  metadata: {
    retryCount: number;
    responseTime?: number;
  };
}

// Exponential backoff configuration
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  retryStatusCodes: [408, 429, 500, 502, 503, 504],
  retryNetworkErrors: true
};

// Enhanced type definitions
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

// Exponential backoff retry function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const shouldRetry = (error: AxiosError) => {
  return RETRY_CONFIG.retryStatusCodes.includes(error.response?.status || 0) ||
    (RETRY_CONFIG.retryNetworkErrors && !error.response);
};

const calculateRetryDelay = (retryCount: number) => {
  return Math.min(
    RETRY_CONFIG.initialDelay * Math.pow(2, retryCount),
    RETRY_CONFIG.maxDelay
  );
};

// Create axios instance with default configuration
const api = axios.create({
  baseURL: CONFIG.BACKEND_URL,
  timeout: 10000,
  headers: {
    'X-API-Key': CONFIG.API_KEY,
    'Content-Type': 'application/json'
  }
});

// Enhanced request interceptor
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // Type cast to ExtendedAxiosRequestConfig and initialize metadata
    const extendedConfig = config as ExtendedAxiosRequestConfig;
    extendedConfig.metadata = extendedConfig.metadata || { retryCount: 0 };
    
    // Ensure headers exist with the correct type
    extendedConfig.headers = extendedConfig.headers || {};

    // Add content-length header for non-empty payloads
    if (extendedConfig.data) {
      extendedConfig.headers['Content-Length'] = JSON.stringify(extendedConfig.data).length;
    }

    console.log('🔐 API Request:', {
      method: extendedConfig.method?.toUpperCase(),
      url: extendedConfig.url,
      baseURL: extendedConfig.baseURL,
      fullURL: `${extendedConfig.baseURL}${extendedConfig.url}`,
      headers: extendedConfig.headers,
      timeout: extendedConfig.timeout,
      payloadSize: extendedConfig.data ? JSON.stringify(extendedConfig.data).length : 0
    });

    return extendedConfig;
  },
  (error) => {
    console.error('❌ API Request Setup Error:', {
      message: error.message,
      config: error.config,
      stack: error.stack
    });
    return Promise.reject(error);
  }
);

// Enhanced response interceptor with retry logic
api.interceptors.response.use(
  (response: AxiosResponse) => {
    const extendedConfig = response.config as ExtendedAxiosRequestConfig;
    
    // Verify response content
    if (!response.headers['content-length']) {
      console.warn('⚠️ Missing Content-Length header in response');
    }

    console.log('✅ API Response Success:', {
      status: response.status,
      statusText: response.statusText,
      url: extendedConfig.url,
      dataType: typeof response.data,
      dataSize: response.headers['content-length'] || 'unknown',
      responseTime: extendedConfig.metadata?.responseTime || 'unknown'
    });

    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as ExtendedAxiosRequestConfig;
    
    // Initialize retry count if not present
    config.metadata = config.metadata || { retryCount: 0 };
    
    if (shouldRetry(error) && config.metadata.retryCount < RETRY_CONFIG.maxRetries) {
      const retryCount = config.metadata.retryCount + 1;
      const delayTime = calculateRetryDelay(retryCount);
      
      console.warn(`🔄 Retrying request (attempt ${retryCount}/${RETRY_CONFIG.maxRetries})`, {
        url: config.url,
        delay: delayTime,
        error: error.message,
        status: error.response?.status
      });

      // Update retry count and add delay
      config.metadata.retryCount = retryCount;
      await delay(delayTime);
      
      return api(config);
    }

    console.error('❌ API Response Error:', {
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: config.url,
      message: error.message,
      data: error.response?.data,
      retryAttempts: config.metadata.retryCount
    });

    if (error.response?.status === 401) {
      console.error('🚫 Authentication failed details:', {
        expectedApiKey: CONFIG.API_KEY,
        sentApiKey: config.headers?.['X-API-Key'],
        backendUrl: CONFIG.BACKEND_URL
      });
    }

    if (error.code === 'NETWORK_ERROR' || error.message.includes('Network Error')) {
      console.error('🌐 Network connectivity issue - check if backend is running');
    }

    return Promise.reject(error);
  }
);

// Enhanced API methods with content validation
export const registerDevice = async (deviceData: DeviceRegistration) => {
  // Validate device data
  if (!deviceData.id || !deviceData.name || !deviceData.type) {
    throw new Error('Invalid device data: missing required fields');
  }
  return api.post('/api/v1/devices/register', deviceData);
};

export const getDevices = async (): Promise<{ data: { devices: any[] } }> => {
  return api.get('/api/v1/devices');
};

export const ingestSensorData = async (sensorData: SensorData) => {
  // Validate sensor data
  if (!sensorData.deviceId || !sensorData.timestamp) {
    throw new Error('Invalid sensor data: missing required fields');
  }
  return api.post('/api/v1/ingest/sensor-data', sensorData);
};

export const getSensorData = async (deviceId: string): Promise<{ data: any[] }> => {
  if (!deviceId) {
    throw new Error('Device ID is required');
  }
  return api.get(`/api/v1/sensor-data?deviceId=${encodeURIComponent(deviceId)}&limit=100`);
};

export const streamCameraFrame = async (
  frameData: ArrayBuffer,
  headers: CameraFrameHeaders
) => {
  if (!frameData || !headers['X-Device-ID']) {
    throw new Error('Invalid frame data or headers');
  }
  return api.post('/api/v1/stream/stream', frameData, {
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': frameData.byteLength
    }
  });
};

export const requestBuzzer = async (deviceId: string, status: boolean): Promise<BuzzerStatus> => {
  if (!deviceId) {
    throw new Error('Device ID is required');
  }
  return api.post('/api/v1/buzzer/control', { deviceId, status });
};

export const getBuzzerStatus = async (deviceId: string): Promise<BuzzerStatus> => {
  if (!deviceId) {
    throw new Error('Device ID is required');
  }
  return api.get(`/api/v1/buzzer/status?deviceId=${encodeURIComponent(deviceId)}`);
};

export const pingBuzzer = async (deviceId: string): Promise<BuzzerStatus> => {
  if (!deviceId) {
    throw new Error('Device ID is required');
  }
  return api.post('/api/v1/buzzer/ping', { deviceId });
};

export default api;