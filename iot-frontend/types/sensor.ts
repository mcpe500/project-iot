export interface SensorDataItem {
  id: number;
  deviceId: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
  createdAt: string;
  updatedAt: string;
  customData: any;
}