import Fastify from 'fastify';
import { config } from 'dotenv';
import { validateEnvironment, parseCorsOrigins, createSuccessResponse } from '@/utils/helpers';
import type { EnvironmentConfig } from '@/types';
import { createSshTunnel } from '@/job/tunnel';

// Load environment variables
config();

// Validate environment
validateEnvironment();

// Create Fastify instance with enhanced logging
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    ...(process.env.NODE_ENV === 'production' && {
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]']
    })
  }
});

// Environment configuration
const envConfig: EnvironmentConfig = {
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  NODE_ENV: process.env.NODE_ENV || 'development',
  JWT_SECRET: process.env.JWT_SECRET!,
  API_KEY: process.env.API_KEY!,
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:3001',
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ...(process.env.DATABASE_URL && { DATABASE_URL: process.env.DATABASE_URL })
};

async function buildApp() {
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
      data: envConfig
    });

    // Security plugins
    await fastify.register(require('@fastify/helmet'), {
      global: true
    });

    // CORS configuration
    await fastify.register(require('@fastify/cors'), {
      origin: parseCorsOrigins(envConfig.CORS_ORIGIN),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
      credentials: true
    });

    // Rate limiting
    await fastify.register(require('@fastify/rate-limit'), {
      max: envConfig.RATE_LIMIT_MAX,
      timeWindow: envConfig.RATE_LIMIT_WINDOW_MS,
      skipOnError: true
    });

    // Register custom plugins
    await fastify.register(require('@/plugins/errorHandler'));
    await fastify.register(require('@/plugins/websocket'));
    await fastify.register(require('@/plugins/auth'));

    // Health check endpoint (public)
    fastify.get('/health', async () => {
      return createSuccessResponse({
        status: 'healthy',
        uptime: process.uptime(),
        timestamp: Date.now(),
        version: '1.0.0'
      });
    });    // API routes
    await fastify.register(async function (fastify) {
      await fastify.register(require('@/routes/ingest'), { prefix: '/ingest' });
      await fastify.register(require('@/routes/dashboard'), { prefix: '/dashboard' });
      await fastify.register(require('@/routes/control'), { prefix: '/control' });
      await fastify.register(require('@/routes/devices'), { prefix: '/devices' });
      await fastify.register(require('@/routes/notes'), { prefix: '/dashboard/notes' });
      await fastify.register(require('@/routes/config'), { prefix: '/config' });
      await fastify.register(require('@/routes/gemini'), { prefix: '/ai' });
      await fastify.register(require('@/routes/stream'), { prefix: '/stream' });
    }, { prefix: '/api/v1' });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      fastify.log.info(`Received ${signal}, shutting down gracefully`);
      try {
        await fastify.close();
        process.exit(0);
      } catch (error) {
        fastify.log.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return fastify;
  } catch (error) {
    fastify.log.error({ error }, 'Failed to build application');
    process.exit(1);
  }
}

async function start() {
  let sshClient: any = null;
  
  try {
    const app = await buildApp();
    
    await app.listen({
      port: envConfig.PORT,
      host: envConfig.HOST
    });

    app.log.info({
      port: envConfig.PORT,
      host: envConfig.HOST,
      environment: envConfig.NODE_ENV
    }, 'IoT Backend Server started successfully');

    // Initialize SSH reverse tunnel if configured
    if (process.env.PUBLIC_VPS_IP) {
      app.log.info('Initializing SSH reverse tunnel...');
      try {
        sshClient = createSshTunnel(
          envConfig.PORT, // Use the server's port as the private server port
          parseInt(process.env.PUBLIC_PORT || '9001', 10),
          process.env.SSH_USER || 'user',
          process.env.PUBLIC_VPS_IP,
          process.env.SSH_PASSWORD,
          process.env.SSH_PRIVATE_KEY_PATH,
          process.env.SSH_PASSPHRASE
        );
        
        if (sshClient) {
          app.log.info({
            localPort: envConfig.PORT,
            remotePort: process.env.PUBLIC_PORT || '9001',
            vpsIp: process.env.PUBLIC_VPS_IP
          }, 'SSH reverse tunnel initiated successfully');
        } else {
          app.log.warn('SSH reverse tunnel could not be established - check configuration');
        }
      } catch (tunnelError) {
        app.log.error({ error: tunnelError }, 'Failed to initialize SSH tunnel');
      }
    } else {
      app.log.info('SSH tunnel not configured (PUBLIC_VPS_IP not set)');
    }

    // Update graceful shutdown to include SSH tunnel cleanup
    const gracefulShutdown = async (signal: string) => {
      app.log.info(`Received ${signal}, shutting down gracefully`);
      try {
        // Close SSH tunnel first
        if (sshClient) {
          app.log.info('Closing SSH tunnel...');
          sshClient.end();
        }
        
        await app.close();
        process.exit(0);
      } catch (error) {
        app.log.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    // Override the existing signal handlers
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));// Log available routes in development
    if (envConfig.NODE_ENV === 'development') {
      app.log.info('Available routes:');
      app.log.info('  GET    /health');
      app.log.info('  WS     /ws');
      app.log.info('  POST   /api/v1/ingest/sensor-data');
      app.log.info('  GET    /api/v1/ingest/sensor-data/history/:deviceId');
      app.log.info('  GET    /api/v1/dashboard/data');
      app.log.info('  GET    /api/v1/dashboard/devices');
      app.log.info('  GET    /api/v1/dashboard/system-status');
      app.log.info('  GET    /api/v1/dashboard/notes');
      app.log.info('  POST   /api/v1/dashboard/notes');
      app.log.info('  PUT    /api/v1/dashboard/notes/:id');
      app.log.info('  DELETE /api/v1/dashboard/notes/:id');
      app.log.info('  POST   /api/v1/control/command');
      app.log.info('  GET    /api/v1/control/commands/pending');
      app.log.info('  PUT    /api/v1/control/commands/:id/status');
      app.log.info('  GET    /api/v1/config/media');
      app.log.info('  GET    /api/v1/config/system');
      app.log.info('  POST   /api/v1/stream/stream');
      app.log.info('  WS     /api/v1/stream/live');
      app.log.info('  POST   /api/v1/stream/record');
      app.log.info('  GET    /api/v1/stream/recordings');
      app.log.info('  GET    /api/v1/stream/status');
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
start();
