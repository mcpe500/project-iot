import { test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify from 'fastify';
import { buildTestApp } from './testUtils';

let app: any;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

test('Device Management Integration', async () => {
  // Test device registration
  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/devices/register',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: {
      deviceId: 'test-camera-01',
      deviceName: 'Test Camera',
      deviceType: 'camera',
      ipAddress: '192.168.1.101',
      capabilities: ['stream', 'photo', 'record']
    }
  });

  expect(registerResponse.statusCode).toBe(200);
  const registerData = registerResponse.json();
  expect(registerData.success).toBe(true);
  expect(registerData.data.deviceId).toBe('test-camera-01');

  // Test device list
  const listResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/devices/devices',
    headers: {
      'x-api-key': 'test-api-key'
    }
  });

  expect(listResponse.statusCode).toBe(200);
  const listData = listResponse.json();
  expect(listData.success).toBe(true);
  expect(listData.data.devices).toBeInstanceOf(Array);
  expect(listData.data.devices.length).toBeGreaterThan(0);
});

test('Command System Integration', async () => {
  // Register a test valve device first
  await app.inject({
    method: 'POST',
    url: '/api/v1/devices/register',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: {
      deviceId: 'test-valve-01',
      deviceName: 'Test Valve',
      deviceType: 'valve',
      ipAddress: '192.168.1.102'
    }
  });

  // Send a command
  const commandResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/control/command',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: {
      deviceId: 'test-valve-01',
      type: 'valve_open',
      payload: { position: 100 }
    }
  });

  expect(commandResponse.statusCode).toBe(200);
  const commandData = commandResponse.json();
  expect(commandData.success).toBe(true);
  expect(commandData.data).toHaveProperty('id');
  expect(commandData.data.status).toBe('pending');

  // Check pending commands
  const pendingResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/control/commands/pending?deviceId=test-valve-01',
    headers: {
      'x-api-key': 'test-api-key'
    }
  });

  expect(pendingResponse.statusCode).toBe(200);
  const pendingData = pendingResponse.json();
  expect(pendingData.success).toBe(true);
  expect(pendingData.data.commands).toBeInstanceOf(Array);
  expect(pendingData.data.commands.length).toBeGreaterThan(0);
});

test('Sensor Data Ingestion', async () => {
  const sensorResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/ingest/sensor-data',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'test-api-key'
    },
    payload: {
      deviceId: 'test-camera-01',
      timestamp: Date.now(),
      temperature: 25.5,
      humidity: 60.2,
      freeHeap: 180000,
      wifiRssi: -45
    }
  });

  expect(sensorResponse.statusCode).toBe(200);
  const sensorData = sensorResponse.json();
  expect(sensorData.success).toBe(true);

  // Check if data appears in dashboard
  const dashboardResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard/data',
    headers: {
      'x-api-key': 'test-api-key'
    }
  });

  expect(dashboardResponse.statusCode).toBe(200);
  const dashboardData = dashboardResponse.json();
  expect(dashboardData.success).toBe(true);
  expect(dashboardData.data).toHaveProperty('devices');
  expect(dashboardData.data).toHaveProperty('latestSensorData');
});

test('WebSocket Communication', async () => {
  const ws = new WebSocket('ws://localhost:3000/ws');
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket connection timeout'));
    }, 5000);

    ws.onopen = () => {
      clearTimeout(timeout);
      ws.close();
      resolve(true);
    };

    ws.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
  });
});

test('Stream Endpoint Integration', async () => {
  const streamResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/stream/status',
    headers: {
      'x-api-key': 'test-api-key'
    }
  });

  expect(streamResponse.statusCode).toBe(200);
  const streamData = streamResponse.json();
  expect(streamData.success).toBe(true);
  expect(streamData.data).toHaveProperty('isStreaming');
  expect(streamData.data).toHaveProperty('frameRate');
});

test('Health Check', async () => {
  const healthResponse = await app.inject({
    method: 'GET',
    url: '/health'
  });

  expect(healthResponse.statusCode).toBe(200);
  const healthData = healthResponse.json();
  expect(healthData.success).toBe(true);
  expect(healthData.data).toHaveProperty('status');
  expect(healthData.data.status).toBe('healthy');
});
