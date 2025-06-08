import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createErrorResponse } from '@/utils/helpers';

/**
 * Global error handler plugin
 */
export default fp(async function errorHandler(fastify: FastifyInstance) {
  // Set custom error handler
  fastify.setErrorHandler(async (error, request: FastifyRequest, reply: FastifyReply) => {
    // Log error
    request.log.error({
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method,
      headers: request.headers,
      query: request.query,
      params: request.params
    }, 'Request error occurred');

    // Handle validation errors
    if (error.validation) {
      return reply
        .status(400)
        .send(createErrorResponse(`Validation error: ${error.message}`));
    }

    // Handle known HTTP errors
    if (error.statusCode) {
      return reply
        .status(error.statusCode)
        .send(createErrorResponse(error.message));
    }

    // Handle unknown errors
    const statusCode = error.statusCode || 500;
    const message = process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message;

    return reply
      .status(statusCode)
      .send(createErrorResponse(message));
  });

  // Not found handler
  fastify.setNotFoundHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    request.log.warn({
      url: request.url,
      method: request.method
    }, 'Route not found');

    return reply
      .status(404)
      .send(createErrorResponse(`Route ${request.method} ${request.url} not found`));
  });
}, {
  name: 'error-handler'
});
