import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sensorDataSchema } from '@/schemas';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse, sanitizeDeviceId } from '@/utils/helpers';
import type { SensorData } from '@/types';

export default async function ingestRoutes(fastify: FastifyInstance) {
  // POST /api/v1/ingest/sensor-data
  fastify.post<{
    Body: SensorData;
  }>('/sensor-data', {
    schema: {
      description: 'Ingest sensor data from ESP32 devices',
      tags: ['Ingestion'],
      body: sensorDataSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'number' }
          }
        },
        400: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: SensorData }>, reply: FastifyReply) => {
    try {
      const sensorData = request.body;
      
      // Sanitize device ID
      sensorData.deviceId = sanitizeDeviceId(sensorData.deviceId);
      
      // Process the sensor data
      await iotService.processSensorData(sensorData);
      
      request.log.info({ 
        deviceId: sensorData.deviceId,
        dataKeys: Object.keys(sensorData).filter(key => key !== 'deviceId' && key !== 'timestamp')
      }, 'Sensor data ingested successfully');
      
      return reply.send(createSuccessResponse({ 
        message: 'Sensor data ingested successfully',
        deviceId: sensorData.deviceId 
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to ingest sensor data');
      return reply.status(500).send(createErrorResponse('Failed to ingest sensor data'));
    }
  });

  // GET /api/v1/ingest/sensor-data/history/:deviceId
  fastify.get<{
    Params: { deviceId: string };
    Querystring: { limit?: string };
  }>('/sensor-data/history/:deviceId', {
    schema: {
      description: 'Get sensor data history for a specific device',
      tags: ['Ingestion'],
      params: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' }
        },
        required: ['deviceId']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'string', pattern: '^[0-9]+$' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { deviceId: string }; Querystring: { limit?: string } }>, reply: FastifyReply) => {
    try {
      const { deviceId } = request.params;
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;
      
      if (limit > 1000) {
        return reply.status(400).send(createErrorResponse('Limit cannot exceed 1000'));
      }
      
      const sanitizedDeviceId = sanitizeDeviceId(deviceId);
      const history = await iotService.getSensorHistory(sanitizedDeviceId, limit);
      
      return reply.send(createSuccessResponse({
        deviceId: sanitizedDeviceId,
        data: history,
        count: history.length
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to get sensor data history');
      return reply.status(500).send(createErrorResponse('Failed to get sensor data history'));
    }
  });
}
