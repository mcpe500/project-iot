import { promises as fs } from 'fs';
import path from 'path';

// Device registry interfaces
export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceType: 'camera' | 'valve' | 'master';
  status: 'online' | 'offline' | 'error' | 'maintenance';
  ipAddress: string;
  lastHeartbeat: number;
  uptime: number;
  freeHeap: number;
  wifiRssi?: number;
  errorCount: number;
  capabilities?: string[];
}

export interface SystemStatus {
  devicesOnline: number;
  devicesTotal: number;
  systemUptime: number;
  totalCommandsSent: number;
  totalCommandsFailed: number;
  backendConnected: boolean;
  lastBackendSync: number;
  systemLoad: number;
}

class DataService {
  private dataDir: string;
  private devicesFile: string;
  private systemStatusFile: string;
  private imagesDir: string;
  private videosDir: string;
  private recordingsDir: string;
  
  private deviceRegistry = new Map<string, DeviceInfo>();
  private systemStatus: SystemStatus = {
    devicesOnline: 0,
    devicesTotal: 0,
    systemUptime: Date.now(),
    totalCommandsSent: 0,
    totalCommandsFailed: 0,
    backendConnected: true,
    lastBackendSync: Date.now(),
    systemLoad: 0
  };

  constructor() {
    this.dataDir = path.join(process.cwd(), 'data');
    this.devicesFile = path.join(this.dataDir, 'devices.json');
    this.systemStatusFile = path.join(this.dataDir, 'system-status.json');
    this.imagesDir = path.join(this.dataDir, 'images');
    this.videosDir = path.join(this.dataDir, 'videos');
    this.recordingsDir = path.join(this.dataDir, 'recordings');
  }

  async initialize(): Promise<void> {
    console.log('🔧 Initializing data service...');
    
    try {
      // Create data directories
      await this.ensureDirectoryExists(this.dataDir);
      await this.ensureDirectoryExists(this.imagesDir);
      await this.ensureDirectoryExists(this.videosDir);
      await this.ensureDirectoryExists(this.recordingsDir);
      
      // Load existing data
      await this.loadDevices();
      await this.loadSystemStatus();
      
      // Start background tasks
      this.startStaleDeviceMonitoring();
      this.startPeriodicSave();
      
      console.log('✅ Data service initialized successfully');
      console.log(`📁 Data directory: ${this.dataDir}`);
      console.log(`📷 Images directory: ${this.imagesDir}`);
      console.log(`🎥 Videos directory: ${this.videosDir}`);
      console.log(`📼 Recordings directory: ${this.recordingsDir}`);
    } catch (error) {
      console.error('❌ Failed to initialize data service:', error);
      throw error;
    }
  }

  private async ensureDirectoryExists(dir: string): Promise<void> {
    try {
      await fs.access(dir);
    } catch {
      await fs.mkdir(dir, { recursive: true });
      console.log(`📂 Created directory: ${dir}`);
    }
  }

  // Device Management
  async loadDevices(): Promise<void> {
    try {
      const data = await fs.readFile(this.devicesFile, 'utf8');
      const devicesArray = JSON.parse(data) as DeviceInfo[];
      
      this.deviceRegistry.clear();
      devicesArray.forEach(device => {
        this.deviceRegistry.set(device.deviceId, device);
      });
      
      console.log(`📱 Loaded ${devicesArray.length} devices from storage`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('📱 No existing devices file found, starting with empty registry');
      } else {
        console.error('❌ Error loading devices:', error);
      }
    }
  }

  async saveDevices(): Promise<void> {
    try {
      const devicesArray = Array.from(this.deviceRegistry.values());
      await fs.writeFile(this.devicesFile, JSON.stringify(devicesArray, null, 2));
      console.log(`💾 Saved ${devicesArray.length} devices to storage`);
    } catch (error) {
      console.error('❌ Error saving devices:', error);
      throw error;
    }
  }

  async loadSystemStatus(): Promise<void> {
    try {
      const data = await fs.readFile(this.systemStatusFile, 'utf8');
      const savedStatus = JSON.parse(data) as SystemStatus;
      
      // Merge with current status, preserving runtime values
      this.systemStatus = {
        ...savedStatus,
        systemUptime: Date.now(), // Reset uptime
        backendConnected: true,
        lastBackendSync: Date.now()
      };
      
      console.log('📊 Loaded system status from storage');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.log('📊 No existing system status file found, starting with defaults');
      } else {
        console.error('❌ Error loading system status:', error);
      }
    }
  }

  async saveSystemStatus(): Promise<void> {
    try {
      await fs.writeFile(this.systemStatusFile, JSON.stringify(this.systemStatus, null, 2));
    } catch (error) {
      console.error('❌ Error saving system status:', error);
    }
  }

  // Device Registry Operations
  getDevice(deviceId: string): DeviceInfo | undefined {
    return this.deviceRegistry.get(deviceId);
  }

  getAllDevices(): DeviceInfo[] {
    return Array.from(this.deviceRegistry.values());
  }

  async setDevice(deviceId: string, device: DeviceInfo): Promise<void> {
    this.deviceRegistry.set(deviceId, device);
    await this.saveDevices();
    this.updateSystemStatus();
  }

  async deleteDevice(deviceId: string): Promise<boolean> {
    const deleted = this.deviceRegistry.delete(deviceId);
    if (deleted) {
      await this.saveDevices();
      this.updateSystemStatus();
    }
    return deleted;
  }

  deviceExists(deviceId: string): boolean {
    return this.deviceRegistry.has(deviceId);
  }

  // System Status
  getSystemStatus(): SystemStatus {
    this.updateSystemStatus();
    return { ...this.systemStatus };
  }

  private updateSystemStatus(): void {
    const devices = Array.from(this.deviceRegistry.values());
    this.systemStatus.devicesOnline = devices.filter(d => d.status === 'online').length;
    this.systemStatus.devicesTotal = devices.length;
    this.systemStatus.lastBackendSync = Date.now();
  }

  async incrementCommandsSent(): Promise<void> {
    this.systemStatus.totalCommandsSent++;
    await this.saveSystemStatus();
  }

  async incrementCommandsFailed(): Promise<void> {
    this.systemStatus.totalCommandsFailed++;
    await this.saveSystemStatus();
  }

  // File Storage Operations
  async saveImage(deviceId: string, imageBuffer: Buffer, mimeType: string = 'image/jpeg'): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = mimeType.includes('jpeg') ? 'jpg' : 'png';
    const filename = `${deviceId}_${timestamp}.${extension}`;
    const filepath = path.join(this.imagesDir, filename);
    
    await fs.writeFile(filepath, imageBuffer);
    console.log(`📷 Saved image: ${filename} (${imageBuffer.length} bytes)`);
    
    return filename;
  }

  async saveRecording(deviceId: string, frames: Buffer[], recordingId: string): Promise<string> {
    const recordingDir = path.join(this.recordingsDir, recordingId);
    await this.ensureDirectoryExists(recordingDir);
      const manifest = {
      recordingId,
      deviceId,
      timestamp: new Date().toISOString(),
      frameCount: frames.length,
      frames: [] as string[]
    };

    // Save individual frames
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (frame) {
        const frameFilename = `frame_${String(i).padStart(4, '0')}.jpg`;
        const framePath = path.join(recordingDir, frameFilename);
        await fs.writeFile(framePath, frame);
        manifest.frames.push(frameFilename);
      }
    }

    // Save manifest
    const manifestPath = path.join(recordingDir, 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    
    console.log(`📼 Saved recording: ${recordingId} (${frames.length} frames)`);
    return recordingId;
  }

  async getRecordings(): Promise<Array<{ recordingId: string; deviceId: string; timestamp: string; frameCount: number }>> {
    try {
      const recordings = [];
      const recordingDirs = await fs.readdir(this.recordingsDir);
      
      for (const dir of recordingDirs) {
        try {
          const manifestPath = path.join(this.recordingsDir, dir, 'manifest.json');
          const manifestData = await fs.readFile(manifestPath, 'utf8');
          const manifest = JSON.parse(manifestData);
          
          recordings.push({
            recordingId: manifest.recordingId,
            deviceId: manifest.deviceId,
            timestamp: manifest.timestamp,
            frameCount: manifest.frameCount
          });
        } catch {
          // Skip invalid recording directories
        }
      }
      
      return recordings.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch {
      return [];
    }
  }

  // Auto-registration
  async autoRegisterDevice(deviceId: string, ipAddress: string): Promise<DeviceInfo> {
    const device: DeviceInfo = {
      deviceId,
      deviceName: `Auto-registered ${deviceId}`,
      deviceType: 'camera',
      status: 'online',
      ipAddress,
      lastHeartbeat: Date.now(),
      uptime: 0,
      freeHeap: 0,
      errorCount: 0,
      capabilities: ['streaming', 'auto-registered']
    };
    
    await this.setDevice(deviceId, device);
    console.log(`🤖 Auto-registered device: ${deviceId} from ${ipAddress}`);
    
    return device;
  }

  // Background Tasks
  private startStaleDeviceMonitoring(): void {
    setInterval(async () => {
      const now = Date.now();
      const staleThreshold = 2 * 60 * 1000; // 2 minutes
      let hasChanges = false;
      
      for (const [deviceId, device] of this.deviceRegistry.entries()) {
        if (now - device.lastHeartbeat > staleThreshold && device.status === 'online') {
          device.status = 'offline';
          this.deviceRegistry.set(deviceId, device);
          hasChanges = true;
          console.log(`⏰ Device ${deviceId} marked as offline due to stale heartbeat`);
        }
      }
      
      if (hasChanges) {
        await this.saveDevices();
        this.updateSystemStatus();
      }
    }, 30000); // Check every 30 seconds
  }

  private startPeriodicSave(): void {
    // Save system status every 5 minutes
    setInterval(async () => {
      await this.saveSystemStatus();
    }, 5 * 60 * 1000);
  }

  // Getters for directory paths
  getDataDir(): string {
    return this.dataDir;
  }

  getImagesDir(): string {
    return this.imagesDir;
  }

  getVideosDir(): string {
    return this.videosDir;
  }

  getRecordingsDir(): string {
    return this.recordingsDir;
  }
}

// Export singleton instance
export const dataService = new DataService();
