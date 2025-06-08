import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';

export default async function dashboardRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard/data
  fastify.get('/data', {
    schema: {
      description: 'Get complete dashboard data including devices, latest sensor readings, and system status',
      tags: ['Dashboard'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                devices: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      type: { type: 'string' },
                      status: { type: 'string', enum: ['online', 'offline', 'error'] },
                      lastSeen: { type: 'number' },
                      location: { type: 'string' },
                      metadata: { type: 'object' }
                    }
                  }
                },
                latestSensorData: { type: 'object' },
                systemStatus: {
                  type: 'object',
                  properties: {
                    uptime: { type: 'number' },
                    connectedDevices: { type: 'number' },
                    lastDataReceived: { type: 'number' }
                  }
                }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dashboardData = await iotService.getDashboardData();
      
      request.log.info({
        deviceCount: dashboardData.devices.length,
        connectedDevices: dashboardData.systemStatus.connectedDevices
      }, 'Dashboard data requested');
      
      return reply.send(createSuccessResponse(dashboardData));
    } catch (error) {
      request.log.error({ error }, 'Failed to get dashboard data');
      return reply.status(500).send(createErrorResponse('Failed to get dashboard data'));
    }
  });

  // GET /api/v1/dashboard/devices
  fastify.get('/devices', {
    schema: {
      description: 'Get all registered devices',
      tags: ['Dashboard'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string' },
                  status: { type: 'string' },
                  lastSeen: { type: 'number' }
                }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dashboardData = await iotService.getDashboardData();
      return reply.send(createSuccessResponse(dashboardData.devices));
    } catch (error) {
      request.log.error({ error }, 'Failed to get devices');
      return reply.status(500).send(createErrorResponse('Failed to get devices'));
    }
  });

  // GET /api/v1/dashboard/system-status
  fastify.get('/system-status', {
    schema: {
      description: 'Get system status and statistics',
      tags: ['Dashboard']
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const dashboardData = await iotService.getDashboardData();
      return reply.send(createSuccessResponse(dashboardData.systemStatus));
    } catch (error) {
      request.log.error({ error }, 'Failed to get system status');
      return reply.status(500).send(createErrorResponse('Failed to get system status'));
    }
  });
}
