import axios from 'axios';
import { CONFIG } from '@/app/config';

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
    // Always ensure API key is present
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

export default api;