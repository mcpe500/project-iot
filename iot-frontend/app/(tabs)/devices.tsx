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
} from 'react-native';
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
// import { IconSymbol, IconName } from '@/components/IconSymbol';
import { CONFIG } from '@/config';
import { pingBuzzer, requestBuzzer } from '@/services/api';
import { IconName } from '@/components/IconSymbol';
import { IconSymbol } from '@/components/ui/IconSymbol';

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

  const api = axios.create({
    baseURL: CONFIG.BACKEND_URL,
    timeout: 10000,
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const [devicesResponse, statusResponse] = await Promise.all([
        api.get('/api/v1/devices'),
        api.get('/api/v1/system/status'),
      ]);

      if (devicesResponse.data && Array.isArray(devicesResponse.data.devices)) {
        setDevices(devicesResponse.data.devices);
      } else {
        console.warn('Unexpected devices data format:', devicesResponse.data);
        setDevices([]);
      }

      if (statusResponse.data && typeof statusResponse.data.status === 'object') {
        setSystemStatus(statusResponse.data.status);
      } else {
        console.warn('Unexpected system status data format:', statusResponse.data);
        setSystemStatus(null);
      }

      if (!devicesResponse.data || !statusResponse.data) {
        setError('Failed to load some data. Endpoints might be missing.');
      }
    } catch (err: any) {
      console.error('Error loading device data:', err);
      setError(
        err.message ||
          'Failed to connect to the server. Ensure backend is running and API endpoints for devices & system status are available.'
      );
      setDevices([]);
      setSystemStatus(null);
    } finally {
      if (!isRefresh) setLoading(false);
      setRefreshing(false);
    }
  };

  const sendCommand = async (deviceId: string, command: string, params?: any) => {
    const commandId = `${deviceId}_${command}_${JSON.stringify(params || {})}`;
    setSendingCommand(commandId);
    try {
      console.log(`Sending command: ${command} to device ${deviceId} with params:`, params);
      
      if (command === 'buzzer_ping') {
        // Use the buzzer request endpoint instead of ping
        const response = await api.post('/api/v1/buzzer/request', { deviceId });
        if (response.data.success) {
          Alert.alert('Success', `Buzzer request sent to ${deviceId}`);
        } else {
          throw new Error(response.data.error || 'Failed to send buzzer request');
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        Alert.alert('Success', `Command "${command}" sent to device ${deviceId}.`);
      }
    } catch (error: any) {
      console.error(`Error sending command ${command} to device ${deviceId}:`, error);
      Alert.alert('Error', `Failed to send command "${command}". ${error.message || ''}`);
    } finally {
      setSendingCommand(null);
    }
  };

  const onRefresh = useCallback(() => {
    loadData(true);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === 'online') return '#4CAF50';
    if (status === 'offline') return '#F44336';
    if (status === 'error') return '#FF9800';
    if (status === 'maintenance') return '#2196F3';
    return '#9E9E9E';
  };

  const getDeviceIcon = (deviceType: string): IconName => {
    if (deviceType === 'camera') return 'camera';
    if (deviceType === 'valve') return 'valve';
    if (deviceType === 'master') return 'server';
    return 'help-circle-outline';
  };

  const formatUptime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return 'N/A';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    let str = '';
    if (d > 0) str += `${d}d `;
    if (h > 0) str += `${h}h `;
    if (m > 0 || (d === 0 && h === 0)) str += `${m}m`;
    return str.trim() || '0m';
  };

  const formatLastSeen = (timestamp: number) => {
    if (!timestamp || isNaN(timestamp)) return 'N/A';
    const now = Date.now();
    const diffSeconds = Math.floor((now - timestamp) / 1000);
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  const renderDeviceItem = ({ item }: { item: Device }) => {
    const isCamera = item.deviceType === 'camera';
    const commands = [
      { name: 'Restart', action: 'restart', style: styles.warningButton, icon: 'restart' as IconName },
      ...(isCamera
        ? [{ name: 'Snapshot', action: 'snapshot', style: styles.successButton, icon: 'camera-iris' as IconName }]
        : []),
      { name: 'Ping', action: 'buzzer_ping', style: styles.controlButton, icon: 'bell' as IconName },
    ];

    return (
      <View style={styles.deviceCard}>
        <View style={styles.deviceHeader}>
          <View style={styles.deviceInfo}>
            <IconSymbol name={getDeviceIcon(item.deviceType)} size={28} color={getStatusColor(item.status)} />
            <View style={styles.deviceDetails}>
              <Text style={styles.deviceName}>{item.deviceName || item.deviceId}</Text>
              <Text style={styles.deviceType}>{item.deviceType}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
            <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
          </View>
        </View>
        <View style={styles.deviceStats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>IP Address</Text>
            <Text style={styles.statValue}>{item.ipAddress || 'N/A'}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Uptime</Text>
            <Text style={styles.statValue}>{formatUptime(item.uptime)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Free Heap</Text>
            <Text style={styles.statValue}>
              {item.freeHeap ? `${(item.freeHeap / 1024).toFixed(1)} KB` : 'N/A'}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Last Seen</Text>
            <Text style={styles.statValue}>{formatLastSeen(item.lastHeartbeat)}</Text>
          </View>
          {item.wifiRssi !== undefined && (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>WiFi RSSI</Text>
              <Text style={styles.statValue}>{item.wifiRssi} dBm</Text>
            </View>
          )}
          {item.errorCount > 0 && (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Errors</Text>
              <Text style={[styles.statValue, styles.errorText]}>{item.errorCount}</Text>
            </View>
          )}
        </View>
        {item.capabilities && item.capabilities.length > 0 && (
          <View>
            <Text style={styles.sectionSubtitle}>Capabilities:</Text>
            <Text style={styles.capabilitiesText}>{item.capabilities.join(', ')}</Text>
          </View>
        )}
        <View style={styles.controlsContainer}>
          {commands.map((cmd) => {
            const cmdId = `${item.deviceId}_${cmd.action}_${JSON.stringify({})}`;
            const isLoading = sendingCommand === cmdId;
            return (
              <TouchableOpacity
                key={cmd.action}
                style={[
                  styles.controlButtonBase,
                  cmd.style,
                  (isLoading || item.status === 'offline') && styles.disabledButton,
                ]}
                onPress={() => sendCommand(item.deviceId, cmd.action)}
                disabled={isLoading || item.status === 'offline'}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#fff" style={{ marginRight: 6 }} />
                ) : (
                  <IconSymbol name={cmd.icon} size={14} color="#fff" style={{ marginRight: 6 }} />
                )}
                <Text style={styles.controlButtonText}>{cmd.name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  const renderSystemStatus = () => {
    if (!systemStatus) return null;
    const {
      backendConnected,
      devicesOnline,
      devicesTotal,
      systemUptime,
      totalCommandsSent,
      totalCommandsFailed,
      lastBackendSync,
      systemLoad,
    } = systemStatus;
    const connectionIconName: IconName = backendConnected ? 'lan-connect' : 'lan-disconnect';
    return (
      <View style={styles.systemStatusCard}>
        <View style={styles.systemStats}>
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{devicesOnline || 0}</Text>
            <Text style={styles.systemStatLabel}>Devices Online</Text>
          </View>
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>{devicesTotal || 0}</Text>
            <Text style={styles.systemStatLabel}>Total Devices</Text>
          </View>
          <View style={styles.systemStatItem}>
            <Text style={styles.systemStatValue}>
              {systemLoad ? `${(systemLoad * 100).toFixed(0)}%` : 'N/A'}
            </Text>
            <Text style={styles.systemStatLabel}>System Load</Text>
          </View>
        </View>
        <View style={styles.connectionStatus}>
          <IconSymbol
            name={connectionIconName}
            size={16}
            color={backendConnected ? '#4CAF50' : '#F44336'}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.connectionText}>
            Backend: {backendConnected ? 'Connected' : 'Disconnected'}
            {backendConnected && lastBackendSync
              ? ` (Synced ${formatLastSeen(lastBackendSync)})`
              : ''}
          </Text>
        </View>
        <Text style={styles.detailText}>System Uptime: {formatUptime(systemUptime)}</Text>
        <Text style={styles.detailText}>
          Commands: {totalCommandsSent} Sent, {totalCommandsFailed} Failed
        </Text>
      </View>
    );
  };

  if (loading && devices.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading Devices...</Text>
      </View>
    );
  }

  if (error && devices.length === 0 && !refreshing) {
    return (
      <View style={styles.errorContainer}>
        <IconSymbol name="alert-circle-outline" size={48} color="#F44336" />
        <Text style={styles.emptyTitle}>Connection Error</Text>
        <Text style={styles.emptySubtext}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => loadData(false)}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.header}>
        <Text style={styles.title}>Device Management</Text>
        <TouchableOpacity onPress={() => loadData(true)} style={styles.refreshButton} disabled={refreshing}>
          {refreshing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <IconSymbol name="refresh" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
      <FlatList
        data={devices}
        renderItem={renderDeviceItem}
        keyExtractor={(item) => item.deviceId}
        ListHeaderComponent={renderSystemStatus}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <IconSymbol name="wifi-off" size={64} color="#666" />
              <Text style={styles.emptyTitle}>No Devices Found</Text>
              <Text style={styles.emptySubtext}>
                Pull down to refresh or check backend connection.
              </Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={['#4CAF50']}
            tintColor="#4CAF50"
          />
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: (StatusBar.currentHeight || 0) + 15,
    paddingBottom: 15,
    backgroundColor: '#121212',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  refreshButton: { padding: 8 },
  content: { flex: 1 },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    marginTop: 20,
    paddingHorizontal: 16,
  },
  sectionSubtitle: {
    color: '#bbb',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
    marginTop: 8,
  },
  capabilitiesText: { color: '#999', fontSize: 12, marginBottom: 10 },
  systemStatusCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  systemStats: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  systemStatItem: { alignItems: 'center', flex: 1 },
  systemStatValue: { color: '#4CAF50', fontSize: 18, fontWeight: 'bold' },
  systemStatLabel: { color: '#aaa', fontSize: 11, textAlign: 'center', marginTop: 4 },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  connectionIndicator: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  connectionText: { color: '#ddd', fontSize: 13 },
  detailText: { color: '#ccc', fontSize: 12, marginTop: 2, textAlign: 'center' },
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
  deviceInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  deviceDetails: { marginLeft: 12, flex: 1 },
  deviceName: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  deviceType: { color: '#aaa', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  statusText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  deviceStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 10,
    marginTop: 10,
  },
  statItem: { width: '50%', marginBottom: 8, paddingRight: 8 },
  statLabel: { color: '#888', fontSize: 11, marginBottom: 1 },
  statValue: { color: '#ddd', fontSize: 13, fontWeight: '500' },
  errorText: { color: '#FF7043', fontWeight: 'bold' },
  controlsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    paddingTop: 12,
  },
  controlButtonBase: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 90,
    justifyContent: 'center',
  },
  controlButton: { backgroundColor: '#2196F3' },
  successButton: { backgroundColor: '#4CAF50' },
  dangerButton: { backgroundColor: '#F44336' },
  warningButton: { backgroundColor: '#FF9800' },
  disabledButton: { backgroundColor: '#555' },
  controlButtonText: { color: '#fff', fontSize: 12, fontWeight: 'bold', marginLeft: 4 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  loadingText: { color: '#fff', marginTop: 16, fontSize: 16 },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#000',
  },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginTop: 20, textAlign: 'center' },
  emptySubtext: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  retryButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    minHeight: 200,
  },
});
