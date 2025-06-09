// Configuration file for the IoT Camera Stream App
// Update these values to match your setup

export const CONFIG = {
  // Backend server configuration
  BACKEND_URL: 'http://192.168.1.100:3000',
  WS_URL: 'ws://192.168.1.100:3000',
  
  // Camera configuration
  CAMERA_FPS: 10,
  BUFFER_DURATION_SECONDS: 30,
  
  // UI Configuration
  RECONNECT_DELAY_MS: 3000,
  REFRESH_TIMEOUT_MS: 5000,
};

// Helper function to get WebSocket URL
export const getWebSocketURL = (endpoint: string) => {
  return `${CONFIG.WS_URL}${endpoint}`;
};

// Helper function to get HTTP URL
export const getHttpURL = (endpoint: string) => {
  return `${CONFIG.BACKEND_URL}${endpoint}`;
};
