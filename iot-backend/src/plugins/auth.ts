import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Authentication plugin - DISABLED for development
 * All requests are allowed without API key validation
 */
export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('isAuthenticated', true);
    // Log all requests for debugging
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    fastify.log.info({
      method: request.method,
      url: request.url,
      headers: {
        'content-type': request.headers['content-type'],
        'user-agent': request.headers['user-agent'],
        'content-length': request.headers['content-length']
      },
      ip: request.ip
    }, 'Request received');
    
    // Mark all requests as authenticated
    (request as any).isAuthenticated = true;
  });
}, {
  name: 'auth-plugin'
});
