import type { ApiResponse } from '@/types';

/**
 * Create standardized API responses
 */
export function createApiResponse<T = any>(
  success: boolean,
  data?: T,
  error?: string
): ApiResponse<T> {
  return {
    success,
    data,
    error,
    timestamp: Date.now()
  };
}

/**
 * Create success response
 */
export function createSuccessResponse<T = any>(data?: T): ApiResponse<T> {
  return createApiResponse(true, data);
}

/**
 * Create error response
 */
export function createErrorResponse(error: string): ApiResponse {
  return createApiResponse(false, undefined, error);
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): void {
  const required = ['PORT', 'HOST', 'JWT_SECRET', 'API_KEY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/**
 * Parse CORS origins from environment variable
 */
export function parseCorsOrigins(corsOrigin: string): string[] {
  return corsOrigin.split(',').map(origin => origin.trim()).filter(Boolean);
}

/**
 * Sanitize device ID for security
 */
export function sanitizeDeviceId(deviceId: string): string {
  return deviceId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);
}

/**
 * Generate unique ID
 */
export function generateId(prefix = ''): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Validate API key from request headers
 */
export function validateApiKey(providedKey: string): boolean {
  return providedKey === process.env.API_KEY;
}

/**
 * Rate limiting key generator for IP-based limiting
 */
export function getRateLimitKey(ip: string, endpoint?: string): string {
  return endpoint ? `${ip}:${endpoint}` : ip;
}

/**
 * Safe JSON parsing with error handling
 */
export function safeJsonParse<T = any>(jsonString: string): T | null {
  try {
    return JSON.parse(jsonString);
  } catch {
    return null;
  }
}

/**
 * Calculate time ago in human readable format
 */
export function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return `${seconds} second${seconds !== 1 ? 's' : ''} ago`;
}
