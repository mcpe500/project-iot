export interface SensorData {
  deviceId: string;
  timestamp: number;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  lightLevel?: number;
  motionDetected?: boolean;
  airQuality?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'error';
  lastSeen: number;
  location?: string;
  metadata?: Record<string, any>;
}

export interface Command {
  id: string;
  deviceId: string;
  type: string;
  payload: Record<string, any>;
  status: 'pending' | 'sent' | 'acknowledged' | 'failed';
  timestamp: number;
  userId?: string;
}

export interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  userId?: string;
}

export interface MediaConfig {
  videoStreamUrl?: string;
  imageUrls: string[];
  thumbnailUrls: string[];
  refreshInterval: number;
}

export interface DashboardData {
  devices: Device[];
  latestSensorData: Record<string, SensorData>;
  systemStatus: {
    uptime: number;
    connectedDevices: number;
    lastDataReceived: number;
  };
}

export interface WebSocketMessage {
  type: 'sensor-data' | 'device-status' | 'command-result' | 'system-alert';
  payload: any;
  timestamp: number;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

export interface EnvironmentConfig {
  PORT: number;
  HOST: string;
  NODE_ENV: string;
  JWT_SECRET: string;
  API_KEY: string;
  CORS_ORIGIN: string;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW_MS: number;
  LOG_LEVEL: string;
  DATABASE_URL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_MAX_FILE_SIZE?: string;
  GEMINI_SUPPORTED_FORMATS?: string;
}

// Gemini AI Types
export interface GeminiFileUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  size: number;
}

export interface GeminiRequest {
  prompt: string;
  files?: GeminiFileUpload[];
  context?: string;
  temperature?: number;
  maxTokens?: number;
  userId?: string;
}

export interface GeminiResponse {
  id: string;
  response: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  processingTime: number;
  model: string;
  timestamp: number;
}

export interface GeminiAnalysisResult {
  analysis: string;
  insights: string[];
  recommendations: string[];
  confidence: number;
  fileAnalysis?: {
    [filename: string]: {
      type: 'image' | 'video' | 'audio';
      description: string;
      features: string[];
    };
  };
}

export type SupportedMimeType = 
  | 'image/jpeg' 
  | 'image/png' 
  | 'image/gif' 
  | 'image/webp'
  | 'video/mp4' 
  | 'video/mov' 
  | 'video/avi'
  | 'audio/mp3' 
  | 'audio/wav' 
  | 'audio/aac';
