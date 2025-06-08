import type { SensorData, Device, Command, Note } from '@/types';

/**
 * In-memory data store - easily replaceable with database implementation
 * This provides a clean abstraction that can be swapped for PostgreSQL, InfluxDB, etc.
 */
export class DataStore {
  private sensorData: Map<string, SensorData[]> = new Map();
  private devices: Map<string, Device> = new Map();
  private commands: Map<string, Command> = new Map();
  private notes: Map<number, Note> = new Map();
  private nextNoteId = 1;

  // Sensor Data Operations
  async saveSensorData(data: SensorData): Promise<void> {
    const deviceData = this.sensorData.get(data.deviceId) || [];
    deviceData.push(data);
    
    // Keep only last 1000 readings per device
    if (deviceData.length > 1000) {
      deviceData.splice(0, deviceData.length - 1000);
    }
    
    this.sensorData.set(data.deviceId, deviceData);
    
    // Update device last seen
    const device = this.devices.get(data.deviceId);
    if (device) {
      device.lastSeen = data.timestamp;
      device.status = 'online';
    } else {
      // Auto-register new device
      this.devices.set(data.deviceId, {
        id: data.deviceId,
        name: `Device ${data.deviceId}`,
        type: 'sensor',
        status: 'online',
        lastSeen: data.timestamp
      });
    }
  }

  async getLatestSensorData(): Promise<Record<string, SensorData>> {
    const latest: Record<string, SensorData> = {};
    
    for (const [deviceId, dataArray] of this.sensorData.entries()) {
      if (dataArray.length > 0) {
        latest[deviceId] = dataArray[dataArray.length - 1]!;
      }
    }
    
    return latest;
  }

  async getSensorDataHistory(deviceId: string, limit = 100): Promise<SensorData[]> {
    const data = this.sensorData.get(deviceId) || [];
    return data.slice(-limit);
  }

  // Device Operations
  async getDevices(): Promise<Device[]> {
    return Array.from(this.devices.values());
  }

  async updateDeviceStatus(deviceId: string, status: Device['status'], metadata?: Record<string, any>): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) {
      device.status = status;
      device.lastSeen = Date.now();
      if (metadata) {
        device.metadata = { ...device.metadata, ...metadata };
      }
    }
  }

  // Command Operations
  async saveCommand(command: Command): Promise<void> {
    this.commands.set(command.id, command);
  }

  async getCommand(id: string): Promise<Command | undefined> {
    return this.commands.get(id);
  }

  async getPendingCommands(deviceId?: string): Promise<Command[]> {
    const commands = Array.from(this.commands.values());
    return commands.filter(cmd => 
      cmd.status === 'pending' && 
      (deviceId ? cmd.deviceId === deviceId : true)
    );
  }

  async updateCommandStatus(id: string, status: Command['status']): Promise<void> {
    const command = this.commands.get(id);
    if (command) {
      command.status = status;
    }
  }

  // Notes Operations
  async createNote(noteData: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Promise<Note> {
    const note: Note = {
      ...noteData,
      id: this.nextNoteId++,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    this.notes.set(note.id, note);
    return note;
  }

  async getNotes(): Promise<Note[]> {
    return Array.from(this.notes.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async updateNote(id: number, updates: Partial<Omit<Note, 'id' | 'createdAt'>>): Promise<Note | null> {
    const note = this.notes.get(id);
    if (!note) return null;

    const updatedNote = {
      ...note,
      ...updates,
      updatedAt: Date.now()
    };

    this.notes.set(id, updatedNote);
    return updatedNote;
  }

  async deleteNote(id: number): Promise<boolean> {
    return this.notes.delete(id);
  }

  // System Operations
  getSystemStats() {
    const connectedDevices = Array.from(this.devices.values())
      .filter(device => device.status === 'online').length;
    
    const allSensorData = Array.from(this.sensorData.values()).flat();
    const lastDataReceived = allSensorData.length > 0 
      ? Math.max(...allSensorData.map(data => data.timestamp))
      : 0;

    return {
      uptime: process.uptime(),
      connectedDevices,
      lastDataReceived,
      totalDevices: this.devices.size,
      totalDataPoints: allSensorData.length,
      totalCommands: this.commands.size,
      totalNotes: this.notes.size
    };
  }
}

// Singleton instance
export const dataStore = new DataStore();
