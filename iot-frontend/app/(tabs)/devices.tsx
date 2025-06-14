import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Text,
  Alert,
  RefreshControl,
  ActivityIndicator,
  StatusBar,
  Switch,
  ScrollView
} from 'react-native';
import api from '@/services/api';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG, getHttpURL } from '@/app/config';

interface Device {
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

interface SystemStatus {
  devicesOnline: number;
  devicesTotal: number;
  systemUptime: number;
  totalCommandsSent: number;
  totalCommandsFailed: number;
  backendConnected: boolean;
  lastBackendSync: number;
  systemLoad: number;
}

interface DeviceCommand {
  deviceId: string;
  command: string;
  params?: any;
}

export default function DevicesScreen() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);

  useEffect(() => {
    loadDevices();
    loadSystemStatus();
    
    // Auto-refresh every 5 seconds
    const interval = setInterval(() => {
      loadDevices();
      loadSystemStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);
  const loadDevices = async () => {
    try {
      const response = await api.get('/api/v1/devices/devices');
      if (response.data) {
        setDevices(response.data);
        setError(null);
      } else {
        setError('Failed to load devices');
      }
    } catch (error) {
      console.error('Error loading devices:', error);
      if (!refreshing) {
        setError('Failed to connect to server. Please check your backend connection.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };
  const loadSystemStatus = async () => {
    try {
      const response = await api.get('/api/v1/devices/system/status');
      
      if (response.data.success) {
        setSystemStatus(response.data.data.systemStatus);
      }
    } catch (error) {
      console.error('Error loading system status:', error);
    }
  };

  const sendCommand = async (deviceId: string, command: string, params?: any) => {
    setSendingCommand(deviceId);    try {
      const payload: DeviceCommand = {
        deviceId,
        command,
        params
      };

      const response = await api.post('/api/v1/control/command', payload);

      if (response.data.success) {
        Alert.alert('Success', `Command "${command}" sent to ${deviceId}`);
        // Refresh devices to get updated status
        loadDevices();
      } else {
        Alert.alert('Error', response.data.error || 'Failed to send command');
      }
    } catch (error) {
      console.error('Error sending command:', error);
      Alert.alert('Error', 'Failed to send command to device');
    } finally {
      setSendingCommand(null);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDevices();
    loadSystemStatus();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return '#4CAF50';
      case 'offline': return '#757575';
      case 'error': return '#F44336';
      case 'maintenance': return '#FF9800';
      default: return '#757575';
    }
  };
  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType) {
      case 'camera': return 'camera.fill';
      case 'valve': return 'drop.fill';
      case 'master': return 'cpu.fill';
      default: return 'questionmark.circle.fill';
    }
  };

  const formatUptime = (uptimeSeconds: number) => {
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatMemory = (bytes: number) => {
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatLastSeen = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  const renderCameraControls = (device: Device) => (
    <View style={styles.controlsContainer}>
      <TouchableOpacity
        style={[styles.controlButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'cam_start_stream')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Start Stream</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.controlButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'cam_stop_stream')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Stop Stream</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.controlButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'cam_take_photo')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Take Photo</Text>
      </TouchableOpacity>
    </View>
  );

  const renderValveControls = (device: Device) => (
    <View style={styles.controlsContainer}>
      <TouchableOpacity
        style={[styles.controlButton, styles.successButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'valve_open')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Open Valve</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.controlButton, styles.dangerButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'valve_close')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Close Valve</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.controlButton, styles.warningButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'valve_emergency_stop')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Emergency Stop</Text>
      </TouchableOpacity>
    </View>
  );

  const renderMasterControls = (device: Device) => (
    <View style={styles.controlsContainer}>
      <TouchableOpacity
        style={[styles.controlButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'status_request')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Get Status</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        style={[styles.controlButton, { opacity: sendingCommand === device.deviceId ? 0.5 : 1 }]}
        onPress={() => sendCommand(device.deviceId, 'ping')}
        disabled={sendingCommand === device.deviceId}
      >
        <Text style={styles.controlButtonText}>Ping Devices</Text>
      </TouchableOpacity>
    </View>
  );

  const renderDevice = ({ item: device }: { item: Device }) => (
    <View style={styles.deviceCard}>
      <View style={styles.deviceHeader}>
        <View style={styles.deviceInfo}>
          <IconSymbol 
            name={getDeviceIcon(device.deviceType)} 
            size={24} 
            color={getStatusColor(device.status)} 
          />
          <View style={styles.deviceDetails}>
            <ThemedText style={styles.deviceName}>{device.deviceName}</ThemedText>
            <ThemedText style={styles.deviceType}>{device.deviceType.toUpperCase()}</ThemedText>
          </View>
        </View>
        
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(device.status) }]}>
          <Text style={styles.statusText}>{device.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.deviceStats}>
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>IP Address</Text>
          <Text style={styles.statValue}>{device.ipAddress}</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Uptime</Text>
          <Text style={styles.statValue}>{formatUptime(device.uptime)}</Text>
        </View>
        
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Free Memory</Text>
          <Text style={styles.statValue}>{formatMemory(device.freeHeap)}</Text>
        </View>
        
        {device.wifiRssi && (
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>WiFi Signal</Text>
            <Text style={styles.statValue}>{device.wifiRssi} dBm</Text>
          </View>
        )}
        
        <View style={styles.statItem}>
          <Text style={styles.statLabel}>Last Seen</Text>
          <Text style={styles.statValue}>{formatLastSeen(device.lastHeartbeat)}</Text>
        </View>
        
        {device.errorCount > 0 && (
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Errors</Text>
            <Text style={[styles.statValue, styles.errorText]}>{device.errorCount}</Text>
          </View>
        )}
      </View>

      {device.status === 'online' && (
        <>
          {device.deviceType === 'camera' && renderCameraControls(device)}
          {device.deviceType === 'valve' && renderValveControls(device)}
          {device.deviceType === 'master' && renderMasterControls(device)}
        </>
      )}
    </View>
  );

  const renderSystemStatus = () => {
    if (!systemStatus) return null;

    return (
      <View style={styles.systemStatusCard}>
        <ThemedText style={styles.sectionTitle}>System Status</ThemedText>
        
        <View style={styles.systemStats}>
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{systemStatus.devicesOnline}/{systemStatus.devicesTotal}</Text>
            <Text style={styles.systemStatLabel}>Devices Online</Text>
          </View>
          
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{systemStatus.systemLoad}%</Text>
            <Text style={styles.systemStatLabel}>System Load</Text>
          </View>
          
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{systemStatus.totalCommandsSent}</Text>
            <Text style={styles.systemStatLabel}>Commands Sent</Text>
          </View>
          
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{systemStatus.totalCommandsFailed}</Text>
            <Text style={styles.systemStatLabel}>Command Failures</Text>
          </View>
        </View>
        
        <View style={styles.connectionStatus}>
          <View style={[styles.connectionIndicator, { 
            backgroundColor: systemStatus.backendConnected ? '#4CAF50' : '#F44336' 
          }]} />
          <Text style={styles.connectionText}>
            Backend {systemStatus.backendConnected ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
      </View>
    );
  };

  if (error && !refreshing) {
    return (
      <ThemedView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Device Management</ThemedText>
        </View>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setError(null);
              setLoading(true);
              loadDevices();
              loadSystemStatus();
            }}
          >
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Device Management</ThemedText>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <ThemedText style={styles.loadingText}>Loading devices...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Device Management</ThemedText>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={onRefresh}
        >
          <IconSymbol name="arrow.clockwise" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#4CAF50']}
            tintColor="#4CAF50"
          />
        }
      >
        {renderSystemStatus()}
        
        <ThemedText style={styles.sectionTitle}>Connected Devices</ThemedText>
        
        {devices.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>No devices found</ThemedText>
            <ThemedText style={styles.emptySubtext}>
              Make sure your ESP32 devices are powered on and connected to the network
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={devices}
            renderItem={renderDevice}
            keyExtractor={(item) => item.deviceId}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
          />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 50,
    paddingBottom: 15,
    backgroundColor: '#1a1a1a',
  },
  title: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  refreshButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    marginTop: 16,
  },
  systemStatusCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  systemStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  systemStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  systemStatValue: {
    color: '#4CAF50',
    fontSize: 20,
    fontWeight: 'bold',
  },
  systemStatLabel: {
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectionIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  connectionText: {
    color: '#fff',
    fontSize: 14,
  },
  deviceCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  deviceDetails: {
    marginLeft: 12,
    flex: 1,
  },
  deviceName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  deviceType: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  deviceStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  statItem: {
    width: '50%',
    marginBottom: 8,
  },
  statLabel: {
    color: '#aaa',
    fontSize: 12,
  },
  statValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  errorText: {
    color: '#F44336',
  },
  controlsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  controlButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 8,
  },
  successButton: {
    backgroundColor: '#4CAF50',
  },
  dangerButton: {
    backgroundColor: '#F44336',
  },
  warningButton: {
    backgroundColor: '#FF9800',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
});
