// Test file to verify API configuration
import api from './api';
import { CONFIG } from '@/app/config';

export const testAPIConnection = async () => {
  try {
    console.log('Testing API connection...');
    console.log('Backend URL:', CONFIG.BACKEND_URL);
    console.log('API Key:', CONFIG.API_KEY);
    
    // Test a simple endpoint
    const response = await api.get('/api/v1/devices/devices');
    console.log('API Test Success:', response.status);
    return true;
  } catch (error) {
    console.error('API Test Failed:', error);
    return false;
  }
};

export const testWebSocketConnection = () => {
  return new Promise((resolve, reject) => {
    try {
      const wsUrl = `${CONFIG.WS_URL}/api/v1/stream/live?apiKey=${CONFIG.API_KEY}`;
      console.log('Testing WebSocket connection to:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket test connection successful');
        ws.close();
        resolve(true);
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket test connection failed:', error);
        reject(error);
      };
      
      ws.onclose = (event) => {
        if (event.code === 1000) {
          resolve(true);
        } else {
          reject(new Error(`WebSocket closed with code: ${event.code}`));
        }
      };
      
      // Timeout after 10 seconds
      setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 10000);
      
    } catch (error) {
      console.error('Error creating WebSocket test:', error);
      reject(error);
    }
  });
};
