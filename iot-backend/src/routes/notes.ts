import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { noteCreateSchema, noteUpdateSchema } from '@/schemas';
import { iotService } from '@/services/iotService';
import { createSuccessResponse, createErrorResponse } from '@/utils/helpers';
import type { Note } from '@/types';

export default async function notesRoutes(fastify: FastifyInstance) {
  // GET /api/v1/dashboard/notes
  fastify.get('/', {
    schema: {
      description: 'Get all notes',
      tags: ['Notes'],
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
                  id: { type: 'number' },
                  title: { type: 'string' },
                  content: { type: 'string' },
                  createdAt: { type: 'number' },
                  updatedAt: { type: 'number' },
                  userId: { type: 'string' }
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
      const notes = await iotService.getNotes();
      return reply.send(createSuccessResponse(notes));
    } catch (error) {
      request.log.error({ error }, 'Failed to get notes');
      return reply.status(500).send(createErrorResponse('Failed to get notes'));
    }
  });

  // POST /api/v1/dashboard/notes
  fastify.post<{
    Body: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;
  }>('/', {
    schema: {
      description: 'Create a new note',
      tags: ['Notes'],
      body: noteCreateSchema,
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                title: { type: 'string' },
                content: { type: 'string' },
                createdAt: { type: 'number' },
                updatedAt: { type: 'number' }
              }
            },
            timestamp: { type: 'number' }
          }
        }
      }
    }
  }, async (request: FastifyRequest<{ Body: Omit<Note, 'id' | 'createdAt' | 'updatedAt'> }>, reply: FastifyReply) => {
    try {
      const noteData = request.body;
      const note = await iotService.createNote(noteData);
      
      request.log.info({
        noteId: note.id,
        title: note.title
      }, 'Note created');
      
      return reply.status(201).send(createSuccessResponse(note));
    } catch (error) {
      request.log.error({ error }, 'Failed to create note');
      return reply.status(500).send(createErrorResponse('Failed to create note'));
    }
  });

  // PUT /api/v1/dashboard/notes/:id
  fastify.put<{
    Params: { id: string };
    Body: Partial<Omit<Note, 'id' | 'createdAt'>>;
  }>('/:id', {
    schema: {
      description: 'Update an existing note',
      tags: ['Notes'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9]+$' }
        },
        required: ['id']
      },
      body: noteUpdateSchema
    }
  }, async (request: FastifyRequest<{ Params: { id: string }; Body: Partial<Omit<Note, 'id' | 'createdAt'>> }>, reply: FastifyReply) => {
    try {
      const noteId = parseInt(request.params.id, 10);
      const updates = request.body;
      
      if (isNaN(noteId)) {
        return reply.status(400).send(createErrorResponse('Invalid note ID'));
      }
      
      const updatedNote = await iotService.updateNote(noteId, updates);
      
      if (!updatedNote) {
        return reply.status(404).send(createErrorResponse('Note not found'));
      }
      
      request.log.info({
        noteId,
        updatedFields: Object.keys(updates)
      }, 'Note updated');
      
      return reply.send(createSuccessResponse(updatedNote));
    } catch (error) {
      request.log.error({ error }, 'Failed to update note');
      return reply.status(500).send(createErrorResponse('Failed to update note'));
    }
  });

  // DELETE /api/v1/dashboard/notes/:id
  fastify.delete<{
    Params: { id: string };
  }>('/:id', {
    schema: {
      description: 'Delete a note',
      tags: ['Notes'],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', pattern: '^[0-9]+$' }
        },
        required: ['id']
      }
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    try {
      const noteId = parseInt(request.params.id, 10);
      
      if (isNaN(noteId)) {
        return reply.status(400).send(createErrorResponse('Invalid note ID'));
      }
      
      const deleted = await iotService.deleteNote(noteId);
      
      if (!deleted) {
        return reply.status(404).send(createErrorResponse('Note not found'));
      }
      
      request.log.info({ noteId }, 'Note deleted');
      
      return reply.send(createSuccessResponse({
        message: 'Note deleted successfully',
        noteId
      }));
    } catch (error) {
      request.log.error({ error }, 'Failed to delete note');
      return reply.status(500).send(createErrorResponse('Failed to delete note'));
    }
  });
}
