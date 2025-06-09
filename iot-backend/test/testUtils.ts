import Fastify from 'fastify';
import { config } from 'dotenv';

// Load test environment
config({ path: '.env.test' });

export async function buildTestApp() {
  const fastify = Fastify({
    logger: false // Disable logging in tests
  });

  // Test environment configuration
  const testEnvConfig = {
    PORT: 3001,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret',
    API_KEY: 'test-api-key',
    CORS_ORIGIN: 'http://localhost:3001',
    RATE_LIMIT_MAX: 1000,
    RATE_LIMIT_WINDOW_MS: 60000,
    LOG_LEVEL: 'silent'
  };

  try {
    // Register environment plugin
    await fastify.register(require('@fastify/env'), {
      schema: {
        type: 'object',
        required: ['PORT', 'HOST'],
        properties: {
          PORT: { type: 'integer', minimum: 1, maximum: 65535 },
          HOST: { type: 'string' },
          NODE_ENV: { type: 'string' }
        }
      },
      data: testEnvConfig
    });

    // Security plugins
    await fastify.register(require('@fastify/helmet'), {
      global: true
    });

    // CORS configuration
    await fastify.register(require('@fastify/cors'), {
      origin: ['http://localhost:3001'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true
    });

    // Multipart support
    await fastify.register(require('@fastify/multipart'), {
      limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
      }
    });

    // Rate limiting
    await fastify.register(require('@fastify/rate-limit'), {
      max: testEnvConfig.RATE_LIMIT_MAX,
      timeWindow: testEnvConfig.RATE_LIMIT_WINDOW_MS,
      skipOnError: true
    });

    // Register custom plugins
    await fastify.register(require('../src/plugins/errorHandler'));
    await fastify.register(require('../src/plugins/websocket'));
    await fastify.register(require('../src/plugins/auth'));

    // Health check endpoint
    fastify.get('/health', async () => {
      return {
        success: true,
        data: {
          status: 'healthy',
          uptime: process.uptime(),
          timestamp: Date.now(),
          version: '1.0.0'
        },
        timestamp: Date.now()
      };
    });

    // API routes
    await fastify.register(async function (fastify) {
      await fastify.register(require('../src/routes/ingest'), { prefix: '/ingest' });
      await fastify.register(require('../src/routes/dashboard'), { prefix: '/dashboard' });
      await fastify.register(require('../src/routes/control'), { prefix: '/control' });
      await fastify.register(require('../src/routes/devices'), { prefix: '/devices' });
      await fastify.register(require('../src/routes/notes'), { prefix: '/dashboard/notes' });
      await fastify.register(require('../src/routes/config'), { prefix: '/config' });
      await fastify.register(require('../src/routes/stream'), { prefix: '/stream' });
    }, { prefix: '/api/v1' });

    return fastify;
  } catch (error) {
    fastify.log.error({ error }, 'Failed to build test application');
    throw error;
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createMockDeviceData(deviceId: string, deviceType: 'camera' | 'valve' | 'master') {
  const baseData = {
    deviceId,
    deviceName: `Test ${deviceType}`,
    deviceType,
    ipAddress: '192.168.1.100',
    timestamp: Date.now(),
    freeHeap: Math.floor(Math.random() * 200000) + 100000,
    wifiRssi: Math.floor(Math.random() * 30) - 70
  };

  switch (deviceType) {
    case 'camera':
      return {
        ...baseData,
        capabilities: ['stream', 'photo', 'record'],
        frameRate: 10,
        resolution: 'VGA'
      };
    case 'valve':
      return {
        ...baseData,
        capabilities: ['open', 'close', 'position'],
        position: Math.floor(Math.random() * 101),
        isOpen: Math.random() > 0.5
      };
    case 'master':
      return {
        ...baseData,
        capabilities: ['coordinate', 'monitor', 'command'],
        connectedDevices: Math.floor(Math.random() * 5) + 1,
        systemLoad: Math.floor(Math.random() * 100)
      };
    default:
      return baseData;
  }
}

export async function registerTestDevice(app: any, deviceData: any) {
  return await app.inject({
    method: 'POST',
    url: '/api/v1/devices/register',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: deviceData
  });
}

export async function sendTestCommand(app: any, deviceId: string, command: string, payload: any = {}) {
  return await app.inject({
    method: 'POST',
    url: '/api/v1/control/command',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: {
      deviceId,
      type: command,
      payload
    }
  });
}
