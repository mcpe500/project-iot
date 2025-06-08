import { test, expect } from 'bun:test';
import { createSuccessResponse, createErrorResponse, sanitizeDeviceId } from '../src/utils/helpers';

test('createSuccessResponse creates correct format', () => {
  const response = createSuccessResponse({ test: 'data' });
  
  expect(response.success).toBe(true);
  expect(response.data).toEqual({ test: 'data' });
  expect(response.timestamp).toBeTypeOf('number');
  expect(response.error).toBeUndefined();
});

test('createErrorResponse creates correct format', () => {
  const response = createErrorResponse('Test error message');
  
  expect(response.success).toBe(false);
  expect(response.error).toBe('Test error message');
  expect(response.timestamp).toBeTypeOf('number');
  expect(response.data).toBeUndefined();
});

test('sanitizeDeviceId removes invalid characters', () => {
  expect(sanitizeDeviceId('device123')).toBe('device123');
  expect(sanitizeDeviceId('device-test_01')).toBe('device-test_01');
  expect(sanitizeDeviceId('device@#$%^&*()')).toBe('device');
  expect(sanitizeDeviceId('device with spaces')).toBe('devicewithspaces');
});

test('sanitizeDeviceId limits length', () => {
  const longId = 'a'.repeat(100);
  const sanitized = sanitizeDeviceId(longId);
  expect(sanitized.length).toBeLessThanOrEqual(50);
});
