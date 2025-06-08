import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { iotService } from '@/services/iotService';

/**
 * WebSocket plugin for real-time communication
 */
export default fp(async function websocketPlugin(fastify: FastifyInstance) {
  await fastify.register(require('@fastify/websocket'));

  // WebSocket route
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (connection, request) => {
      request.log.info('WebSocket client connected');

      // Send initial connection confirmation
      connection.socket.send(JSON.stringify({
        type: 'connection',
        payload: { status: 'connected' },
        timestamp: Date.now()
      }));

      // Listen for IoT service events and broadcast to this client
      const broadcastHandler = (message: any) => {
        if (connection.socket.readyState === connection.socket.OPEN) {
          connection.socket.send(JSON.stringify(message));
        }
      };

      iotService.on('websocket-broadcast', broadcastHandler);

      // Handle client messages
      connection.socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          request.log.info({ data }, 'WebSocket message received');
          
          // Handle different message types
          switch (data.type) {
            case 'ping':
              connection.socket.send(JSON.stringify({
                type: 'pong',
                timestamp: Date.now()
              }));
              break;
            case 'subscribe':
              // Handle subscription logic if needed
              break;
            default:
              request.log.warn({ type: data.type }, 'Unknown WebSocket message type');
          }
        } catch (error) {
          request.log.error({ error }, 'Failed to parse WebSocket message');
        }
      });

      // Handle client disconnect
      connection.socket.on('close', () => {
        request.log.info('WebSocket client disconnected');
        iotService.removeListener('websocket-broadcast', broadcastHandler);
      });

      // Handle errors
      connection.socket.on('error', (error) => {
        request.log.error({ error }, 'WebSocket error');
        iotService.removeListener('websocket-broadcast', broadcastHandler);
      });
    });
  });
}, {
  name: 'websocket-plugin'
});
