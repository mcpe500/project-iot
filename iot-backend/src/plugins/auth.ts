import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createErrorResponse, validateApiKey } from '@/utils/helpers';

/**
 * Authentication plugin for API key validation
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('isAuthenticated', false);
  
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health check and some public endpoints
    const publicPaths = ['/health', '/api/v1/config/media'];
    const isPublicPath = publicPaths.some(path => request.url.startsWith(path));
    
    if (isPublicPath) {
      return;
    }

    // Check for API key in headers
    const apiKey = request.headers['x-api-key'] as string;
    
    if (!apiKey) {
      return reply
        .status(401)
        .send(createErrorResponse('API key required'));
    }

    if (!validateApiKey(apiKey)) {
      return reply
        .status(401)
        .send(createErrorResponse('Invalid API key'));
    }

    // Mark request as authenticated
    (request as any).isAuthenticated = true;
  });
}, {
  name: 'auth-plugin'
});
