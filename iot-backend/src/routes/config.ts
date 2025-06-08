import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';

export default async function configRoutes(fastify: FastifyInstance) {
  // GET /api/v1/config/media
  fastify.get('/media', {
    schema: {
      description: 'Get media configuration including video stream URLs and image paths',
      tags: ['Configuration'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                videoStreamUrl: { type: 'string' },
                imageUrls: {
                  type: 'array',
                  items: { type: 'string' }
                },
                thumbnailUrls: {
                  type: 'array',
                  items: { type: 'string' }
                },
                refreshInterval: { type: 'number' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const mediaConfig = iotService.getMediaConfig();
      
      request.log.info('Media configuration requested');
      
      return reply.send(createSuccessResponse(mediaConfig));
    } catch (error) {
      request.log.error({ error }, 'Failed to get media configuration');
      return reply.status(500).send(createErrorResponse('Failed to get media configuration'));
    }
  });

  // GET /api/v1/config/system
  fastify.get('/system', {
    schema: {
      description: 'Get system configuration and capabilities',
      tags: ['Configuration']
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const systemConfig = {
        version: '1.0.0',
        apiVersion: 'v1',
        features: {
          websockets: true,
          realTimeUpdates: true,
          commandExecution: true,
          notesTaking: true,
          deviceManagement: true
        },
        limits: {
          maxDevices: 100,
          maxHistoryPerDevice: 1000,
          maxNotes: 1000,
          maxWebSocketConnections: 50
        },
        supportedSensorTypes: [
          'temperature',
          'humidity',
          'pressure',
          'lightLevel',
          'motionDetected',
          'airQuality'
        ],
        supportedCommandTypes: [
          'led_control',
          'sensor_config',
          'reboot',
          'ping',
          'relay_control'
        ]
      };
      
      return reply.send(createSuccessResponse(systemConfig));
    } catch (error) {
      request.log.error({ error }, 'Failed to get system configuration');
      return reply.status(500).send(createErrorResponse('Failed to get system configuration'));
    }
  });
}
