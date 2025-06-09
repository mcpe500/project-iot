import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { commandSchema } from '@/schemas';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse, sanitizeDeviceId } from '@/utils/helpers';
import type { Command } from '@/types';

export default async function controlRoutes(fastify: FastifyInstance) {
  // POST /api/v1/control/command
  fastify.post<{
    Body: Omit<Command, 'id' | 'timestamp' | 'status'>;
  }>('/command', {
    schema: {
      description: 'Send a command to an ESP32 device',
      tags: ['Control'],
      body: commandSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                deviceId: { type: 'string' },
                type: { type: 'string' },
                payload: { type: 'object' },
                status: { type: 'string' },
                timestamp: { type: 'number' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Omit<Command, 'id' | 'timestamp' | 'status'> }>, reply: FastifyReply) => {
    try {
      const commandData = request.body;
      
      // Sanitize device ID
      commandData.deviceId = sanitizeDeviceId(commandData.deviceId);
        // Validate command type - updated for multi-ESP system
      const allowedCommands = [
        // General commands
        'ping', 'status_request', 'reboot', 'update_config',
        // Camera commands
        'cam_start_stream', 'cam_stop_stream', 'cam_take_photo', 
        'cam_adjust_quality', 'cam_record_start', 'cam_record_stop',
        // Valve commands
        'valve_open', 'valve_close', 'valve_toggle', 
        'valve_set_position', 'valve_get_status', 'valve_emergency_stop',
        // Legacy commands for backward compatibility
        'led_control', 'sensor_config', 'relay_control'
      ];
      if (!allowedCommands.includes(commandData.type)) {
        return reply.status(400).send(createErrorResponse(`Invalid command type. Allowed: ${allowedCommands.join(', ')}`));
      }
      
      // Execute command
      const command = await iotService.executeCommand(commandData);
      
      request.log.info({
        commandId: command.id,
        deviceId: command.deviceId,
        type: command.type
      }, 'Command executed');
      
      return reply.send(createSuccessResponse(command));
    } catch (error) {
      request.log.error({ error }, 'Failed to execute command');
      return reply.status(500).send(createErrorResponse('Failed to execute command'));
    }
  });

  // GET /api/v1/control/commands/pending
  fastify.get<{
    Querystring: { deviceId?: string };
  }>('/commands/pending', {
    schema: {
      description: 'Get pending commands, optionally filtered by device',
      tags: ['Control'],
      querystring: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' }
        }
      }
    }
  }, async (request: FastifyRequest<{ Querystring: { deviceId?: string } }>, reply: FastifyReply) => {
    try {
      const { deviceId } = request.query;
      const sanitizedDeviceId = deviceId ? sanitizeDeviceId(deviceId) : undefined;
      
      const pendingCommands = await iotService.getPendingCommands(sanitizedDeviceId);
      
      return reply.send(createSuccessResponse({
        commands: pendingCommands,
        count: pendingCommands.length
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to get pending commands');
      return reply.status(500).send(createErrorResponse('Failed to get pending commands'));
    }
  });

  // PUT /api/v1/control/commands/:commandId/status
  fastify.put<{
    Params: { commandId: string };
    Body: { status: Command['status'] };
  }>('/commands/:commandId/status', {
    schema: {
      description: 'Update command status (typically called by ESP32)',
      tags: ['Control'],
      params: {
        type: 'object',
        properties: {
          commandId: { type: 'string' }
        },
        required: ['commandId']
      },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'sent', 'acknowledged', 'failed'] }
        },
        required: ['status']
      }
    }
  }, async (request: FastifyRequest<{ Params: { commandId: string }; Body: { status: Command['status'] } }>, reply: FastifyReply) => {
    try {
      const { commandId } = request.params;
      const { status } = request.body;
      
      await iotService.updateCommandStatus(commandId, status);
      
      request.log.info({
        commandId,
        status
      }, 'Command status updated');
      
      return reply.send(createSuccessResponse({
        commandId,
        status,
        message: 'Command status updated successfully'
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to update command status');
      return reply.status(500).send(createErrorResponse('Failed to update command status'));
    }
  });
}
