// Environment configuration
// You can create .env.local file to override these values

export const ENV_CONFIG = {
  // Development environment (default)
  BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL || 'http://203.175.11.145:9002',
  WS_URL: process.env.EXPO_PUBLIC_WS_URL || 'ws://203.175.11.145:9002',
  API_KEY: process.env.EXPO_PUBLIC_API_KEY || 'dev-api-key-change-in-production',
  
  // Network configuration
  REQUEST_TIMEOUT: 15000,
  RECONNECT_DELAY: 3000,
  MAX_RECONNECT_ATTEMPTS: 5,
  
  // App configuration
  CAMERA_FPS: 10,
  BUFFER_DURATION_SECONDS: 30,
};

// Helper functions
export const getApiHeaders = () => ({
  'X-API-Key': ENV_CONFIG.API_KEY,
  'Content-Type': 'application/json',
});

export const getWebSocketUrl = (endpoint: string) => {
  return `${ENV_CONFIG.WS_URL}${endpoint}?apiKey=${ENV_CONFIG.API_KEY}`;
};

export const getHttpUrl = (endpoint: string) => {
  return `${ENV_CONFIG.BACKEND_URL}${endpoint}`;
};