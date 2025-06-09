import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';

// Device registry for multi-ESP system
interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'camera' | 'valve' | 'master';
  status: 'online' | 'offline' | 'error' | 'maintenance';
  ipAddress: string;
  lastHeartbeat: number;
  uptime: number;
  freeHeap: number;
  wifiRssi?: number;
  errorCount: number;
  capabilities?: string[];
}

interface SystemStatus {
  devicesOnline: number;
  devicesTotal: number;
  systemUptime: number;
  totalCommandsSent: number;
  totalCommandsFailed: number;
  backendConnected: boolean;
  lastBackendSync: number;
  systemLoad: number;
}

// In-memory device registry (in production, use database)
const deviceRegistry = new Map<string, DeviceInfo>();
let systemStatus: SystemStatus = {
  devicesOnline: 0,
  devicesTotal: 3, // Camera, Valve, Master
  systemUptime: Date.now(),
  totalCommandsSent: 0,
  totalCommandsFailed: 0,
  backendConnected: true,
  lastBackendSync: Date.now(),
  systemLoad: 0
};

export default async function deviceRoutes(fastify: FastifyInstance) {
  // GET /api/v1/devices - List all devices
  fastify.get('/devices', {
    schema: {
      description: 'Get list of all registered ESP32 devices',
      tags: ['Devices'],
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
                      deviceId: { type: 'string' },
                      deviceName: { type: 'string' },
                      deviceType: { type: 'string' },
                      status: { type: 'string' },
                      ipAddress: { type: 'string' },
                      lastHeartbeat: { type: 'number' },
                      uptime: { type: 'number' },
                      freeHeap: { type: 'number' },
                      errorCount: { type: 'number' }
                    }
                  }
                },
                systemStatus: {
                  type: 'object',
                  properties: {
                    devicesOnline: { type: 'number' },
                    devicesTotal: { type: 'number' },
                    systemUptime: { type: 'number' },
                    totalCommandsSent: { type: 'number' },
                    totalCommandsFailed: { type: 'number' },
                    backendConnected: { type: 'boolean' },
                    systemLoad: { type: 'number' }
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
      const devices = Array.from(deviceRegistry.values());
      
      // Update system status
      systemStatus.devicesOnline = devices.filter(d => d.status === 'online').length;
      systemStatus.lastBackendSync = Date.now();
      
      return reply.send(createSuccessResponse({
        devices,
        systemStatus
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to retrieve devices'));
    }
  });

  // GET /api/v1/devices/:deviceId - Get specific device info
  fastify.get<{
    Params: { deviceId: string }
  }>('/devices/:deviceId', {
    schema: {
      description: 'Get detailed information about a specific device',
      tags: ['Devices'],
      params: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' }
        },
        required: ['deviceId']
      }
    }
  }, async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
    try {
      const { deviceId } = request.params;
      const device = deviceRegistry.get(deviceId);
      
      if (!device) {
        return reply.status(404).send(createErrorResponse(`Device ${deviceId} not found`));
      }
      
      return reply.send(createSuccessResponse(device));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to retrieve device information'));
    }
  });

  // POST /api/v1/devices/register - Register a new device
  fastify.post<{
    Body: {
      deviceId: string;
      deviceName: string;
      deviceType: 'camera' | 'valve' | 'master';
      ipAddress: string;
      capabilities?: string[];
    }
  }>('/devices/register', {
    schema: {
      description: 'Register a new ESP32 device',
      tags: ['Devices'],
      body: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          deviceName: { type: 'string' },
          deviceType: { type: 'string', enum: ['camera', 'valve', 'master'] },
          ipAddress: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } }
        },
        required: ['deviceId', 'deviceName', 'deviceType', 'ipAddress']
      }
    }
  }, async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const { deviceId, deviceName, deviceType, ipAddress, capabilities = [] } = request.body;
      
      const device: DeviceInfo = {
        deviceId,
        deviceName,
        deviceType,
        status: 'online',
        ipAddress,
        lastHeartbeat: Date.now(),
        uptime: 0,
        freeHeap: 0,
        errorCount: 0,
        capabilities
      };
      
      deviceRegistry.set(deviceId, device);
      
      fastify.log.info(`Device registered: ${deviceName} (${deviceId}) at ${ipAddress}`);
      
      return reply.send(createSuccessResponse(device));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to register device'));
    }
  });

  // POST /api/v1/devices/:deviceId/heartbeat - Update device heartbeat
  fastify.post<{
    Params: { deviceId: string };
    Body: {
      status?: 'online' | 'offline' | 'error' | 'maintenance';
      uptime?: number;
      freeHeap?: number;
      wifiRssi?: number;
      customData?: any;
    }
  }>('/devices/:deviceId/heartbeat', {
    schema: {
      description: 'Update device heartbeat and status',
      tags: ['Devices'],
      params: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' }
        },
        required: ['deviceId']
      },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['online', 'offline', 'error', 'maintenance'] },
          uptime: { type: 'number' },
          freeHeap: { type: 'number' },
          wifiRssi: { type: 'number' },
          customData: { type: 'object' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Params: { deviceId: string }; Body: any }>, reply: FastifyReply) => {
    try {
      const { deviceId } = request.params;
      const { status, uptime, freeHeap, wifiRssi, customData } = request.body;
      
      let device = deviceRegistry.get(deviceId);
      if (!device) {
        return reply.status(404).send(createErrorResponse(`Device ${deviceId} not found`));
      }
      
      // Update device info
      device.lastHeartbeat = Date.now();
      if (status) device.status = status;
      if (uptime !== undefined) device.uptime = uptime;
      if (freeHeap !== undefined) device.freeHeap = freeHeap;
      if (wifiRssi !== undefined) device.wifiRssi = wifiRssi;
      
      deviceRegistry.set(deviceId, device);
      
      // Store custom data based on device type
      if (customData) {
        switch (device.deviceType) {
          case 'camera':
            // Store camera-specific data (streaming status, fps, etc.)
            break;
          case 'valve':
            // Store valve-specific data (position, state, etc.)
            break;
          case 'master':
            // Store master coordinator data (system status, etc.)
            if (customData.systemStatus) {
              systemStatus = { ...systemStatus, ...customData.systemStatus };
            }
            break;
        }
      }
      
      return reply.send(createSuccessResponse({ 
        message: 'Heartbeat updated successfully',
        device 
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to update heartbeat'));
    }
  });

  // DELETE /api/v1/devices/:deviceId - Unregister device
  fastify.delete<{
    Params: { deviceId: string }
  }>('/devices/:deviceId', {
    schema: {
      description: 'Unregister a device from the system',
      tags: ['Devices'],
      params: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' }
        },
        required: ['deviceId']
      }
    }
  }, async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
    try {
      const { deviceId } = request.params;
      
      if (!deviceRegistry.has(deviceId)) {
        return reply.status(404).send(createErrorResponse(`Device ${deviceId} not found`));
      }
      
      deviceRegistry.delete(deviceId);
      
      fastify.log.info(`Device unregistered: ${deviceId}`);
      
      return reply.send(createSuccessResponse({ 
        message: `Device ${deviceId} unregistered successfully` 
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to unregister device'));
    }
  });

  // GET /api/v1/devices/system/status - Get overall system status
  fastify.get('/system/status', {
    schema: {
      description: 'Get comprehensive system status',
      tags: ['Devices'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                systemStatus: { type: 'object' },
                devicesSummary: {
                  type: 'object',
                  properties: {
                    total: { type: 'number' },
                    online: { type: 'number' },
                    offline: { type: 'number' },
                    error: { type: 'number' }
                  }
                },
                deviceTypes: {
                  type: 'object',
                  properties: {
                    camera: { type: 'object' },
                    valve: { type: 'object' },
                    master: { type: 'object' }
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
      const devices = Array.from(deviceRegistry.values());
      
      // Calculate device summary
      const devicesSummary = {
        total: devices.length,
        online: devices.filter(d => d.status === 'online').length,
        offline: devices.filter(d => d.status === 'offline').length,
        error: devices.filter(d => d.status === 'error').length
      };
      
      // Group devices by type
      const deviceTypes = {
        camera: devices.filter(d => d.deviceType === 'camera'),
        valve: devices.filter(d => d.deviceType === 'valve'),
        master: devices.filter(d => d.deviceType === 'master')
      };
      
      // Update system status
      systemStatus.devicesOnline = devicesSummary.online;
      systemStatus.devicesTotal = devicesSummary.total;
      systemStatus.lastBackendSync = Date.now();
      
      return reply.send(createSuccessResponse({
        systemStatus,
        devicesSummary,
        deviceTypes
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to retrieve system status'));
    }
  });

  // Helper function to check device timeouts and update status
  setInterval(() => {
    const now = Date.now();
    const timeout = 60000; // 60 seconds timeout
    
    for (const [deviceId, device] of deviceRegistry.entries()) {
      if (now - device.lastHeartbeat > timeout && device.status === 'online') {
        device.status = 'offline';
        deviceRegistry.set(deviceId, device);
        fastify.log.warn(`Device ${deviceId} (${device.deviceName}) marked as offline due to timeout`);
      }
    }
  }, 30000); // Check every 30 seconds

  // Export device registry for use in other modules
  fastify.decorate('deviceRegistry', deviceRegistry);
  fastify.decorate('systemStatus', systemStatus);
}
