import type { SensorData, Device, Command, Note, DashboardData, WebSocketMessage } from '@/types';
import { dataStore } from '@/models/dataStore';
import { EventEmitter } from 'events';

export class IoTService extends EventEmitter {
  private readonly maxDeviceOfflineTime = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    // Check for offline devices every minute
    setInterval(() => this.checkDeviceStatus(), 60000);
  }

  async processSensorData(data: SensorData): Promise<void> {
    // Validate data ranges and sanitize
    const sanitizedData = this.sanitizeSensorData(data);
    
    // Save to store
    await dataStore.saveSensorData(sanitizedData);
    
    // Emit real-time update
    const wsMessage: WebSocketMessage = {
      type: 'sensor-data',
      payload: sanitizedData,
      timestamp: Date.now()
    };
    
    this.emit('websocket-broadcast', wsMessage);
  }

  async getDashboardData(): Promise<DashboardData> {
    const [devices, latestSensorData] = await Promise.all([
      dataStore.getDevices(),
      dataStore.getLatestSensorData()
    ]);

    const systemStatus = dataStore.getSystemStats();

    return {
      devices,
      latestSensorData,
      systemStatus: {
        uptime: systemStatus.uptime,
        connectedDevices: systemStatus.connectedDevices,
        lastDataReceived: systemStatus.lastDataReceived
      }
    };
  }

  async getSensorHistory(deviceId: string, limit?: number): Promise<SensorData[]> {
    return dataStore.getSensorDataHistory(deviceId, limit);
  }

  async executeCommand(commandData: Omit<Command, 'id' | 'timestamp' | 'status'>): Promise<Command> {
    const command: Command = {
      ...commandData,
      id: this.generateCommandId(),
      timestamp: Date.now(),
      status: 'pending'
    };

    await dataStore.saveCommand(command);

    // Emit command to device via WebSocket
    const wsMessage: WebSocketMessage = {
      type: 'command-result',
      payload: { command, action: 'new-command' },
      timestamp: Date.now()
    };

    this.emit('websocket-broadcast', wsMessage);
    
    // Simulate command acknowledgment (in real implementation, ESP32 would respond)
    setTimeout(async () => {
      await this.updateCommandStatus(command.id, 'acknowledged');
    }, 1000);

    return command;
  }

  async updateCommandStatus(commandId: string, status: Command['status']): Promise<void> {
    await dataStore.updateCommandStatus(commandId, status);
    
    const command = await dataStore.getCommand(commandId);
    if (command) {
      const wsMessage: WebSocketMessage = {
        type: 'command-result',
        payload: { command, action: 'status-update' },
        timestamp: Date.now()
      };
      
      this.emit('websocket-broadcast', wsMessage);
    }
  }

  async getPendingCommands(deviceId?: string): Promise<Command[]> {
    return dataStore.getPendingCommands(deviceId);
  }

  async createNote(noteData: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    return dataStore.createNote(noteData);
  }

  async getNotes(): Promise<Note[]> {
    return dataStore.getNotes();
  }

  async updateNote(id: number, updates: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note | null> {
    return dataStore.updateNote(id, updates);
  }

  async deleteNote(id: number): Promise<boolean> {
    return dataStore.deleteNote(id);
  }

  getMediaConfig() {
    return {
      videoStreamUrl: 'http://localhost:8080/stream.mjpg', // Example stream URL
      imageUrls: [
        '/api/v1/media/camera/latest.jpg',
        '/api/v1/media/sensors/graph.png'
      ],
      thumbnailUrls: [
        '/api/v1/media/camera/thumb.jpg'
      ],
      refreshInterval: 5000 // 5 seconds
    };
  }

  private sanitizeSensorData(data: SensorData): SensorData {
    const sanitized = { ...data };
    
    // Ensure timestamp is current if not provided or invalid
    if (!sanitized.timestamp || sanitized.timestamp > Date.now() + 60000) {
      sanitized.timestamp = Date.now();
    }

    // Validate and clamp sensor values
    if (typeof sanitized.temperature === 'number') {
      sanitized.temperature = Math.max(-100, Math.min(100, sanitized.temperature));
    }
    
    if (typeof sanitized.humidity === 'number') {
      sanitized.humidity = Math.max(0, Math.min(100, sanitized.humidity));
    }
    
    if (typeof sanitized.pressure === 'number') {
      sanitized.pressure = Math.max(0, sanitized.pressure);
    }
    
    if (typeof sanitized.lightLevel === 'number') {
      sanitized.lightLevel = Math.max(0, Math.min(100, sanitized.lightLevel));
    }

    return sanitized;
  }

  private async checkDeviceStatus(): Promise<void> {
    const devices = await dataStore.getDevices();
    const now = Date.now();
    
    for (const device of devices) {
      if (device.status === 'online' && 
          (now - device.lastSeen) > this.maxDeviceOfflineTime) {
        
        await dataStore.updateDeviceStatus(device.id, 'offline');
        
        // Emit device status change
        const wsMessage: WebSocketMessage = {
          type: 'device-status',
          payload: { deviceId: device.id, status: 'offline' },
          timestamp: now
        };
        
        this.emit('websocket-broadcast', wsMessage);
      }
    }
  }

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const iotService = new IoTService();
