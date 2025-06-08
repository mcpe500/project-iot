import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { geminiPromptSchema, geminiAnalysisSchema } from '@/schemas';
import { geminiService } from '@/services/geminiService';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';
import type { GeminiRequest, GeminiFileUpload } from '@/types';

export default async function geminiRoutes(fastify: FastifyInstance) {
  // Register multipart support
  await fastify.register(require('@fastify/multipart'), {
    limits: {
      fileSize: geminiService.getMaxFileSize()
    }
  });

  // GET /api/v1/ai/config
  fastify.get('/config', {
    schema: {
      description: 'Get Gemini AI service configuration and capabilities',
      tags: ['AI'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                available: { type: 'boolean' },
                model: { type: 'string' },
                supportedFormats: {
                  type: 'array',
                  items: { type: 'string' }
                },
                maxFileSize: { type: 'number' },
                maxFileSizeFormatted: { type: 'string' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const config = geminiService.getConfiguration();
      return reply.send(createSuccessResponse(config));
    } catch (error) {
      request.log.error({ error }, 'Failed to get Gemini configuration');
      return reply.status(500).send(createErrorResponse('Failed to get AI service configuration'));
    }
  });

  // POST /api/v1/ai/generate
  fastify.post<{
    Body: Omit<GeminiRequest, 'files'>;
  }>('/generate', {
    schema: {
      description: 'Generate text response using Gemini AI',
      tags: ['AI'],
      body: geminiPromptSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                response: { type: 'string' },
                processingTime: { type: 'number' },
                model: { type: 'string' },
                timestamp: { type: 'number' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Omit<GeminiRequest, 'files'> }>, reply: FastifyReply) => {
    try {
      if (!geminiService.isAvailable()) {
        return reply.status(503).send(createErrorResponse('Gemini AI service is not available'));
      }

      const response = await geminiService.generateResponse(request.body);
      
      request.log.info({
        requestId: response.id,
        processingTime: response.processingTime,
        promptLength: request.body.prompt.length
      }, 'Gemini text generation completed');

      return reply.send(createSuccessResponse(response));
    } catch (error) {
      request.log.error({ error }, 'Failed to generate text with Gemini');
      return reply.status(500).send(createErrorResponse(
        error instanceof Error ? error.message : 'Failed to generate text'
      ));
    }
  });

  // POST /api/v1/ai/generate-multimodal
  fastify.post('/generate-multimodal', {
    schema: {
      description: 'Generate response with multimodal input (text, images, audio, video)',
      tags: ['AI'],
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                response: { type: 'string' },
                processingTime: { type: 'number' },
                model: { type: 'string' },
                timestamp: { type: 'number' },
                filesProcessed: { type: 'number' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!geminiService.isAvailable()) {
        return reply.status(503).send(createErrorResponse('Gemini AI service is not available'));
      }

      const data = await request.file();
      if (!data) {
        return reply.status(400).send(createErrorResponse('No form data provided'));
      }

      // Parse multipart form data
      const parts = await request.saveRequestFiles();
      const fields: Record<string, any> = {};
      const files: GeminiFileUpload[] = [];

      // Extract form fields and files
      for (const part of parts) {
        if (part.fieldname === 'files' && part.file) {
          const buffer = await part.file.toBuffer();
          files.push({
            buffer,
            filename: part.filename || 'unknown',
            mimetype: part.mimetype,
            size: buffer.length
          });
        } else {
          // Handle form fields
          const buffer = await part.file.toBuffer();
          fields[part.fieldname] = buffer.toString();
        }
      }

      // Validate required fields
      if (!fields.prompt) {
        return reply.status(400).send(createErrorResponse('Prompt is required'));
      }

      // Prepare Gemini request
      const geminiRequest: GeminiRequest = {
        prompt: fields.prompt,
        files,
        context: fields.context,
        temperature: fields.temperature ? parseFloat(fields.temperature) : undefined,
        maxTokens: fields.maxTokens ? parseInt(fields.maxTokens, 10) : undefined,
        userId: fields.userId
      };

      const response = await geminiService.generateResponse(geminiRequest);
      
      request.log.info({
        requestId: response.id,
        processingTime: response.processingTime,
        filesCount: files.length,
        promptLength: geminiRequest.prompt.length
      }, 'Gemini multimodal generation completed');

      return reply.send(createSuccessResponse({
        ...response,
        filesProcessed: files.length
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to generate multimodal response');
      return reply.status(500).send(createErrorResponse(
        error instanceof Error ? error.message : 'Failed to generate multimodal response'
      ));
    }
  });

  // POST /api/v1/ai/analyze
  fastify.post<{
    Body: Omit<GeminiRequest, 'files'>;
  }>('/analyze', {
    schema: {
      description: 'Analyze content and provide structured insights',
      tags: ['AI'],
      body: geminiAnalysisSchema,
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                analysis: { type: 'string' },
                insights: {
                  type: 'array',
                  items: { type: 'string' }
                },
                recommendations: {
                  type: 'array',
                  items: { type: 'string' }
                },
                confidence: { type: 'number' },
                fileAnalysis: { type: 'object' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Omit<GeminiRequest, 'files'> }>, reply: FastifyReply) => {
    try {
      if (!geminiService.isAvailable()) {
        return reply.status(503).send(createErrorResponse('Gemini AI service is not available'));
      }

      const analysis = await geminiService.analyzeContent(request.body);
      
      request.log.info({
        confidence: analysis.confidence,
        insightsCount: analysis.insights.length,
        recommendationsCount: analysis.recommendations.length
      }, 'Gemini content analysis completed');

      return reply.send(createSuccessResponse(analysis));
    } catch (error) {
      request.log.error({ error }, 'Failed to analyze content with Gemini');
      return reply.status(500).send(createErrorResponse(
        error instanceof Error ? error.message : 'Failed to analyze content'
      ));
    }
  });

  // POST /api/v1/ai/analyze-iot
  fastify.post<{
    Querystring: { deviceId?: string; timeRange?: string };
  }>('/analyze-iot', {
    schema: {
      description: 'Analyze IoT sensor data with AI insights',
      tags: ['AI'],
      querystring: {
        type: 'object',
        properties: {
          deviceId: { type: 'string' },
          timeRange: { type: 'string', enum: ['1h', '6h', '24h', '7d'] }
        }
      },
      consumes: ['multipart/form-data']
    }
  }, async (request: FastifyRequest<{ Querystring: { deviceId?: string; timeRange?: string } }>, reply: FastifyReply) => {
    try {
      if (!geminiService.isAvailable()) {
        return reply.status(503).send(createErrorResponse('Gemini AI service is not available'));
      }

      const { deviceId, timeRange = '24h' } = request.query;

      // Get IoT data
      const dashboardData = await iotService.getDashboardData();
      let sensorData: any;

      if (deviceId) {
        // Get specific device data
        const history = await iotService.getSensorHistory(deviceId, 100);
        sensorData = {
          device: dashboardData.devices.find(d => d.id === deviceId),
          latestReading: dashboardData.latestSensorData[deviceId],
          history: history.slice(-50) // Last 50 readings
        };
      } else {
        // Get all data
        sensorData = {
          devices: dashboardData.devices,
          latestReadings: dashboardData.latestSensorData,
          systemStatus: dashboardData.systemStatus
        };
      }

      // Handle multipart files if present
      let files: GeminiFileUpload[] = [];
      try {
        const parts = await request.saveRequestFiles();
        for (const part of parts) {
          if (part.fieldname === 'files' && part.file) {
            const buffer = await part.file.toBuffer();
            files.push({
              buffer,
              filename: part.filename || 'unknown',
              mimetype: part.mimetype,
              size: buffer.length
            });
          }
        }
      } catch (error) {
        // No multipart data, that's fine
      }

      const analysis = await geminiService.analyzeIoTData(
        sensorData,
        files,
        `Time range: ${timeRange}. Focus on actionable insights for IoT system optimization.`
      );

      request.log.info({
        deviceId,
        timeRange,
        filesCount: files.length,
        confidence: analysis.confidence
      }, 'IoT data analysis completed');

      return reply.send(createSuccessResponse({
        ...analysis,
        deviceId,
        timeRange,
        dataPoints: Array.isArray(sensorData.history) ? sensorData.history.length : Object.keys(sensorData.latestReadings || {}).length
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to analyze IoT data');
      return reply.status(500).send(createErrorResponse(
        error instanceof Error ? error.message : 'Failed to analyze IoT data'
      ));
    }
  });
}
