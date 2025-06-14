// Environment configuration
// You can create .env.local file to override these values

export const ENV_CONFIG = {
  // Development environment (default)
  BACKEND_URL: process.env.EXPO_PUBLIC_BACKEND_URL || 'http://203.175.11.145:9004',
  // Ensure WS_URL does NOT have a trailing slash here; it will be handled by getWebSocketUrl
  WS_URL: process.env.EXPO_PUBLIC_WS_URL || 'ws://203.175.11.145:9004',
  API_KEY: process.env.EXPO_PUBLIC_API_KEY || 'dev-api-key-change-in-production',
  
  // Network configuration
  REQUEST_TIMEOUT: 15000,
  RECONNECT_DELAY: 3000, // Renamed from RECONNECT_DELAY_MS for consistency if used elsewhere
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

export const getWebSocketUrl = (path: string = '/') => {
  // Ensure the base WS_URL does not end with a slash for clean joining
  const baseWsUrl = ENV_CONFIG.WS_URL.endsWith('/') ? ENV_CONFIG.WS_URL.slice(0, -1) : ENV_CONFIG.WS_URL;
  // Ensure the path starts with a slash
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // Append API key if available. Consider if your WebSocket server uses it.
  // If not, you can remove the apiKey query parameter part.
  if (ENV_CONFIG.API_KEY) {
    return `${baseWsUrl}${normalizedPath}?apiKey=${ENV_CONFIG.API_KEY}`;
  }
  return `${baseWsUrl}${normalizedPath}`;
};

export const getHttpUrl = (endpoint: string) => {
  // Ensure the base BACKEND_URL does not end with a slash for clean joining
  const baseUrl = ENV_CONFIG.BACKEND_URL.endsWith('/') ? ENV_CONFIG.BACKEND_URL.slice(0, -1) : ENV_CONFIG.BACKEND_URL;
  // Ensure the endpoint starts with a slash
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${normalizedEndpoint}`;
};