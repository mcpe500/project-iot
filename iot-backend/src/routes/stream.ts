import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';
import { dataService } from '@/services/dataService';
import { autoRegisterDevice, deviceExists } from '@/routes/devices';

// In-memory circular buffer to store frames (30 seconds at 10 FPS = 300 frames)
class FrameBuffer {
  private buffer: Buffer[] = [];
  private maxSize = 300;
  private currentIndex = 0;

  addFrame(frame: Buffer): void {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(frame);
    } else {
      this.buffer[this.currentIndex] = frame;
      this.currentIndex = (this.currentIndex + 1) % this.maxSize;
    }
  }

  getAllFrames(): Buffer[] {
    if (this.buffer.length < this.maxSize) {
      return [...this.buffer];
    }
    
    // Return frames in chronological order (oldest first)
    const frames = [
      ...this.buffer.slice(this.currentIndex),
      ...this.buffer.slice(0, this.currentIndex)
    ];
    return frames;
  }

  getFrameCount(): number {
    return this.buffer.length;
  }
}

// Global frame buffer instance
const frameBuffer = new FrameBuffer();

// Set to store WebSocket connections for live streaming
const liveViewers = new Set<any>();

const streamRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {  // Register multipart support for this route
  await fastify.register(require('@fastify/multipart'), {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB max file size
    }
  });

  // POST /stream - Receive frames from ESP32
  fastify.post('/stream', {
    schema: {
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' }
          }
        }
      }
    }  }, async (request, reply) => {
    try {
      // Log incoming request details for debugging
      fastify.log.info('Incoming stream request:', {
        contentType: request.headers['content-type'],
        contentLength: request.headers['content-length'],
        userAgent: request.headers['user-agent'],
        apiKey: request.headers['x-api-key']
      });

      const data = await (request as any).file();
      
      if (!data) {
        fastify.log.error('No file data received in multipart request');
        return reply.code(400).send(createErrorResponse('No file data found in request'));
      }

      if (data.fieldname !== 'image') {
        fastify.log.error(`Wrong fieldname received: "${data.fieldname}", expected "image"`);
        return reply.code(400).send(createErrorResponse(`Expected fieldname 'image', got '${data.fieldname}'`));
      }

      // Read the file buffer
      const buffer = await data.toBuffer();
      
      if (buffer.length === 0) {
        fastify.log.error('Empty file buffer received');
        return reply.code(400).send(createErrorResponse('Empty file received'));
      }      // Log successful frame reception
      fastify.log.debug(`Frame received successfully. Size: ${buffer.length} bytes, MIME: ${data.mimetype}`);

      // Auto-register device if not already registered (for backward compatibility)
      const userAgent = request.headers['user-agent'] as string;
      if (userAgent && userAgent.includes('ESP32')) {
        const deviceId = extractDeviceIdFromUserAgent(userAgent) || 'ESP32-CAM-UNKNOWN';
        if (!deviceExists(deviceId)) {
          await autoRegisterDevice(deviceId, request.ip);
        }
      }

      // Save image to data folder for persistence
      try {
        const deviceId = extractDeviceIdFromUserAgent(userAgent || '') || 'ESP32-CAM-UNKNOWN';
        await dataService.saveImage(deviceId, buffer, data.mimetype);
      } catch (saveError) {
        fastify.log.warn({ error: saveError }, 'Failed to save image to data folder');
      }

      // Add frame to circular buffer
      frameBuffer.addFrame(buffer);// Broadcast frame to all connected WebSocket clients
      const base64Frame = buffer.toString('base64');
      liveViewers.forEach((ws) => {
        if ((ws as any).readyState === 1) { // WebSocket.OPEN
          try {
            (ws as any).send(JSON.stringify({
              type: 'frame',
              data: base64Frame,
              timestamp: Date.now()
            }));
          } catch (error) {
            fastify.log.error({ error }, 'Error sending frame to WebSocket client');
            liveViewers.delete(ws);
          }
        } else {
          liveViewers.delete(ws);
        }
      });

      fastify.log.debug(`Frame received and processed. Buffer size: ${frameBuffer.getFrameCount()}`);

      return reply.send(createSuccessResponse({
        message: 'Frame received successfully',
        bufferSize: frameBuffer.getFrameCount()
      }));

    } catch (error) {
      fastify.log.error({ error }, 'Error processing frame upload');
      return reply.code(500).send(createErrorResponse('Internal server error processing frame'));
    }
  });  // GET /live - WebSocket endpoint for live streaming
  fastify.register(async function (fastify) {
    fastify.get('/live', { websocket: true } as any, (connection: any, _request: any) => {
      fastify.log.info('New WebSocket client connected for live stream');
      
      // Add connection to live viewers
      liveViewers.add(connection.socket);

      // Send initial connection confirmation
      (connection.socket as any).send(JSON.stringify({
        type: 'connected',
        message: 'Connected to live stream',
        timestamp: Date.now()
      }));

      // Handle connection close
      connection.socket.on('close', () => {
        fastify.log.info('WebSocket client disconnected from live stream');
        liveViewers.delete(connection.socket);
      });

      // Handle connection errors
      connection.socket.on('error', (error) => {
        fastify.log.error({ error }, 'WebSocket connection error');
        liveViewers.delete(connection.socket);
      });

      // Handle incoming messages (if needed for future features)
      connection.socket.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          fastify.log.debug({ data }, 'Received WebSocket message');
          
          // Handle ping/pong for connection keep-alive
          if (data.type === 'ping') {
            (connection.socket as any).send(JSON.stringify({
              type: 'pong',
              timestamp: Date.now()
            }));
          }
        } catch (error) {
          fastify.log.error({ error }, 'Error parsing WebSocket message');
        }
      });
    });
  });
  // POST /record - Save last 30 seconds of footage
  fastify.post('/record', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                message: { type: 'string' },
                recordingId: { type: 'string' },
                frameCount: { type: 'number' }
              }
            }
          }
        }
      }
    }
  }, async (_request, reply) => {
    try {
      const frames = frameBuffer.getAllFrames();
      
      if (frames.length === 0) {
        return reply.code(400).send(createErrorResponse('No frames available to record'));
      }

      // Create timestamp-based recording ID
      const now = new Date();
      const recordingId = `recording_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
      
      // Use data service to save recording
      await dataService.saveRecording('ESP32-CAM-MAIN', frames, recordingId);

      fastify.log.info(`Recording saved: ${recordingId} with ${frames.length} frames`);

      return reply.send(createSuccessResponse({
        status: 'success',
        message: 'Recording saved.',
        recordingId,
        frameCount: frames.length
      }));

    } catch (error) {
      fastify.log.error({ error }, 'Error saving recording');
      return reply.code(500).send(createErrorResponse('Internal server error saving recording'));
    }
  });
  // GET /recordings - List all available recordings
  fastify.get('/recordings', {
    schema: {
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
                  recordingId: { type: 'string' },
                  deviceId: { type: 'string' },
                  timestamp: { type: 'string' },
                  frameCount: { type: 'number' }
                }
              }
            }
          }
        }
      }
    }  }, async (_request, reply) => {
    try {
      const recordings = await dataService.getRecordings();
      return reply.send(createSuccessResponse(recordings));
    } catch (error) {
      fastify.log.error({ error }, 'Error listing recordings');
      return reply.code(500).send(createErrorResponse('Internal server error listing recordings'));
    }
  });

  // GET /recordings/:id/frames/:frameNumber - Get specific frame from recording
  fastify.get('/recordings/:id/frames/:frameNumber', {
    schema: {
      params: {
        type: 'object',
        required: ['id', 'frameNumber'],
        properties: {
          id: { type: 'string' },
          frameNumber: { type: 'string' }
        }
      }
    }  }, async (request, reply) => {
    try {
      const { id, frameNumber } = request.params as { id: string; frameNumber: string };
      
      const recordingPath = path.join(dataService.getRecordingsDir(), id);
      const framePath = path.join(recordingPath, `frame_${frameNumber.padStart(4, '0')}.jpg`);
      
      try {
        const frameBuffer = await fs.readFile(framePath);
        reply.type('image/jpeg');
        return reply.send(frameBuffer);
      } catch (readError) {
        return reply.code(404).send(createErrorResponse('Frame not found'));
      }

    } catch (error) {
      fastify.log.error({ error }, 'Error retrieving frame');
      return reply.code(500).send(createErrorResponse('Internal server error retrieving frame'));
    }
  });

  // GET /status - Get streaming status and buffer info
  fastify.get('/status', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                bufferSize: { type: 'number' },
                maxBufferSize: { type: 'number' },
                connectedViewers: { type: 'number' },
                uptime: { type: 'number' }
              }
            }
          }        }
      }
    }
  }, async (_request, reply) => {
    return reply.send(createSuccessResponse({
      bufferSize: frameBuffer.getFrameCount(),
      maxBufferSize: 300,
      connectedViewers: liveViewers.size,
      uptime: process.uptime()
    }));
  });
};

// Helper functions for device auto-registration
function extractDeviceIdFromUserAgent(userAgent: string): string | null {
  // Try to extract device ID from User-Agent header
  const match = userAgent.match(/ESP32[_-]?([A-Z0-9_-]+)/i);
  return match ? `ESP32-${match[1]}` : null;
}

export default streamRoutes;
