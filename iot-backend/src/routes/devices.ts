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
  devicesTotal: 0,
  systemUptime: Date.now(),
  totalCommandsSent: 0,
  totalCommandsFailed: 0,
  backendConnected: true,
  lastBackendSync: Date.now(),
  systemLoad: 0
};

// Background task to mark stale devices as offline
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 2 * 60 * 1000; // 2 minutes
  
  for (const [deviceId, device] of deviceRegistry.entries()) {
    if (now - device.lastHeartbeat > staleThreshold && device.status === 'online') {
      device.status = 'offline';
      deviceRegistry.set(deviceId, device);
      console.log(`Device ${deviceId} marked as offline due to stale heartbeat`);
    }
  }
  
  // Update system status
  systemStatus.devicesOnline = Array.from(deviceRegistry.values()).filter(d => d.status === 'online').length;
  systemStatus.devicesTotal = deviceRegistry.size;
}, 30000); // Check every 30 seconds

export default async function deviceRoutes(fastify: FastifyInstance) {  // GET /api/v1/devices/devices - List all devices
  fastify.get('/devices', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const devices = Array.from(deviceRegistry.values());
      
      fastify.log.info(`Returning ${devices.length} devices`);
      
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
  }>('/devices/:deviceId', async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
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
    }  }>('/devices/register', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { deviceId, deviceName, deviceType, ipAddress, capabilities = [] } = body;
      
      // Validate required fields
      if (!deviceId || !deviceName || !deviceType || !ipAddress) {
        return reply.status(400).send(createErrorResponse('Missing required fields: deviceId, deviceName, deviceType, ipAddress'));
      }
      
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
      
      return reply.send(createSuccessResponse({
        message: 'Device registered successfully',
        device
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to register device'));
    }
  });

  // POST /api/v1/devices/heartbeat - General heartbeat endpoint
  fastify.post<{
    Body: {
      deviceId: string;
      status?: 'online' | 'offline' | 'error' | 'maintenance';
      uptime?: number;
      freeHeap?: number;
      wifiRssi?: number;
    }  }>('/devices/heartbeat', async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
    try {
      const body = request.body as any;
      const { deviceId, status, uptime, freeHeap, wifiRssi } = body;
      
      if (!deviceId) {
        return reply.status(400).send(createErrorResponse('deviceId is required'));
      }
      
      let device = deviceRegistry.get(deviceId);
      if (!device) {
        fastify.log.warn(`Heartbeat for unregistered device: ${deviceId}`);
        return reply.status(404).send(createErrorResponse(`Device ${deviceId} not found. Please register first.`));
      }
      
      // Update device info
      device.lastHeartbeat = Date.now();
      if (status) device.status = status;
      if (uptime !== undefined) device.uptime = uptime;
      if (freeHeap !== undefined) device.freeHeap = freeHeap;
      if (wifiRssi !== undefined) device.wifiRssi = wifiRssi;
      
      deviceRegistry.set(deviceId, device);
      
      fastify.log.debug(`Heartbeat updated for device: ${deviceId}`);
      
      return reply.send(createSuccessResponse({
        message: 'Heartbeat updated successfully',
        device
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to update heartbeat'));
    }
  });
  // GET /api/v1/devices/system/status - Get system status
  fastify.get('/system/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Update real-time stats
      systemStatus.devicesOnline = Array.from(deviceRegistry.values()).filter(d => d.status === 'online').length;
      systemStatus.devicesTotal = deviceRegistry.size;
      systemStatus.lastBackendSync = Date.now();
      
      return reply.send(createSuccessResponse({
        systemStatus,
        timestamp: Date.now()
      }));
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send(createErrorResponse('Failed to retrieve system status'));
    }
  });

  // DELETE /api/v1/devices/:deviceId - Unregister device
  fastify.delete<{
    Params: { deviceId: string }
  }>('/devices/:deviceId', async (request: FastifyRequest<{ Params: { deviceId: string } }>, reply: FastifyReply) => {
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
}

// Export function to get device registry (for use in other routes)
export function getDeviceRegistry(): Map<string, DeviceInfo> {
  return deviceRegistry;
}

// Export function to register device automatically (for stream route)
export function autoRegisterDevice(deviceId: string, ipAddress: string): DeviceInfo {
  const device: DeviceInfo = {
    deviceId,
    deviceName: `Auto-registered ${deviceId}`,
    deviceType: 'camera',
    status: 'online',
    ipAddress,
    lastHeartbeat: Date.now(),
    uptime: 0,
    freeHeap: 0,
    errorCount: 0,
    capabilities: ['streaming', 'auto-registered']
  };
  
  deviceRegistry.set(deviceId, device);
  console.log(`Auto-registered device: ${deviceId} from ${ipAddress}`);
  
  return device;
}