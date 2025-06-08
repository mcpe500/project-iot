export const sensorDataSchema = {
  type: 'object',
  required: ['deviceId', 'timestamp'],
  properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 50 },
    timestamp: { type: 'number', minimum: 0 },
    temperature: { type: 'number', minimum: -100, maximum: 100 },
    humidity: { type: 'number', minimum: 0, maximum: 100 },
    pressure: { type: 'number', minimum: 0 },
    lightLevel: { type: 'number', minimum: 0, maximum: 100 },
    motionDetected: { type: 'boolean' },
    airQuality: { type: 'number', minimum: 0, maximum: 500 }
  },
  additionalProperties: true
} as const;

export const commandSchema = {
  type: 'object',
  required: ['deviceId', 'type', 'payload'],
  properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 50 },
    type: { type: 'string', minLength: 1, maxLength: 50 },
    payload: { type: 'object' },
    userId: { type: 'string', maxLength: 50 }
  },
  additionalProperties: false
} as const;

export const noteCreateSchema = {
  type: 'object',
  required: ['title', 'content'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    content: { type: 'string', minLength: 1, maxLength: 5000 },
    userId: { type: 'string', maxLength: 50 }
  },
  additionalProperties: false
} as const;

export const noteUpdateSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    content: { type: 'string', minLength: 1, maxLength: 5000 },
    userId: { type: 'string', maxLength: 50 }
  },
  additionalProperties: false,
  minProperties: 1
} as const;

export const deviceStatusSchema = {
  type: 'object',
  required: ['deviceId', 'status'],
  properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 50 },
    status: { type: 'string', enum: ['online', 'offline', 'error'] },
    metadata: { type: 'object' }
  },
  additionalProperties: false
} as const;

// Gemini AI Schemas
export const geminiPromptSchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 10000 },
    context: { type: 'string', maxLength: 2000 },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    maxTokens: { type: 'number', minimum: 1, maximum: 8192 },
    userId: { type: 'string', maxLength: 50 }
  },
  additionalProperties: false
} as const;

export const geminiAnalysisSchema = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: 10000 },
    context: { type: 'string', maxLength: 2000 },
    sensorData: { type: 'object' },
    userId: { type: 'string', maxLength: 50 }
  },
  additionalProperties: false
} as const;
