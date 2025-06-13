import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Text,
  Dimensions,
  ActivityIndicator,
  StatusBar,
  ScrollView
} from 'react-native';
import { Image } from 'expo-image';
import api from '@/services/api';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG, getWebSocketURL, getHttpURL } from '@/app/config';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

interface StreamStats {
  fps: number;
  frameCount: number;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'disconnected';
  lastFrameTime: number;
}

interface DeviceStatus {
  deviceId: string;
  deviceType: string;
  status: string;
  isStreaming?: boolean;
}

export default function LiveStreamScreen() {
  const [frame, setFrame] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [streamStats, setStreamStats] = useState<StreamStats>({
    fps: 0,
    frameCount: 0,
    connectionQuality: 'disconnected',
    lastFrameTime: 0
  });
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsCalculation = useRef(Date.now());

  useEffect(() => {
    // Log startup configuration
    console.log('🚀 Live Stream App Starting...', {
      backendUrl: CONFIG.BACKEND_URL,
      wsUrl: CONFIG.WS_URL,
      apiKey: CONFIG.API_KEY ? 'SET' : 'NOT SET',
      timestamp: new Date().toISOString()
    });
    
    // Validate configuration
    if (!CONFIG.API_KEY) {
      console.error('❌ API_KEY not configured!');
      setConnectionStatus('Configuration Error');
      return;
    }
    
    if (!CONFIG.BACKEND_URL || !CONFIG.WS_URL) {
      console.error('❌ Backend URLs not configured!');
      setConnectionStatus('Configuration Error');
      return;
    }
    
    loadDevices();
    connectWebSocket();

    // Update FPS calculation every second
    const fpsInterval = setInterval(updateFpsStats, 1000);

    return () => {
      console.log('🛑 Live Stream App cleaning up...');
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInterval(fpsInterval);
    };
  }, []);

  const loadDevices = async () => {
    try {
      console.log('📱 Loading devices from API...');
      const response = await api.get('/api/v1/devices/devices');
      
      console.log('📊 Devices API response:', {
        success: response.data.success,
        deviceCount: response.data.data?.devices?.length || 0,
        status: response.status
      });
      
      if (response.data.success) {
        const deviceList = response.data.data.devices.map((device: any) => ({
          deviceId: device.deviceId,
          deviceType: device.deviceType,
          status: device.status,
          isStreaming: device.deviceType === 'camera' && device.status === 'online'
        }));
        
        console.log('📋 Processed device list:', deviceList.map((d: DeviceStatus) => ({
          id: d.deviceId,
          type: d.deviceType,
          status: d.status,
          streaming: d.isStreaming
        })));
        
        setDevices(deviceList);
        
        // Auto-select first available camera
        const cameras = deviceList.filter((d: DeviceStatus) => d.deviceType === 'camera' && d.status === 'online');
        console.log(`📹 Found ${cameras.length} online cameras`);
        
        if (cameras.length > 0 && !selectedCamera) {
          console.log(`🎯 Auto-selecting camera: ${cameras[0].deviceId}`);
          setSelectedCamera(cameras[0].deviceId);
        }
      } else {
        console.warn('⚠️ API returned success=false for devices');
      }
    } catch (error) {
      console.error('❌ Error loading devices:', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  };

  const updateFpsStats = () => {
    const now = Date.now();
    const timeDiff = now - lastFpsCalculation.current;
    const currentFps = frameCountRef.current / (timeDiff / 1000);
    
    let quality: StreamStats['connectionQuality'] = 'disconnected';
    if (isConnected) {
      if (currentFps >= 8) quality = 'excellent';
      else if (currentFps >= 5) quality = 'good';
      else if (currentFps >= 1) quality = 'poor';
    }
    
    setStreamStats({
      fps: Math.round(currentFps * 10) / 10,
      frameCount: frameCountRef.current,
      connectionQuality: quality,
      lastFrameTime: now
    });
    
    // Log FPS stats periodically (every 10 seconds when frames are being received)
    if (frameCountRef.current > 0 && Math.floor(now / 10000) !== Math.floor(lastFpsCalculation.current / 10000)) {
      console.log('📊 Stream Stats Update:', {
        fps: Math.round(currentFps * 10) / 10,
        totalFrames: frameCountRef.current,
        quality,
        connected: isConnected,
        timeDiff
      });
    }
    
    frameCountRef.current = 0;
    lastFpsCalculation.current = now;
  };

  const connectWebSocket = () => {
    try {
      console.log('🔌 Starting WebSocket connection...');
      setConnectionStatus('Connecting...');
      
      // Include API key in WebSocket URL as query parameter
      const wsUrl = `${getWebSocketURL('/api/v1/stream/live')}?apiKey=${CONFIG.API_KEY}`;
      console.log('🌐 WebSocket connection details:', {
        url: wsUrl,
        baseWsUrl: CONFIG.WS_URL,
        endpoint: '/api/v1/stream/live',
        apiKey: CONFIG.API_KEY,
        timestamp: new Date().toISOString()
      });
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected successfully!');
        setIsConnected(true);
        setConnectionStatus('Connected');
        
        // Send authentication message
        const authMessage = {
          type: 'auth',
          apiKey: CONFIG.API_KEY,
          timestamp: Date.now()
        };
        console.log('🔐 Sending WebSocket auth message:', authMessage);
        ws.send(JSON.stringify(authMessage));
      };

      ws.onmessage = (event) => {
        try {
          console.log('📨 WebSocket message received:', {
            dataLength: event.data.length,
            timestamp: new Date().toISOString()
          });
          
          const data = JSON.parse(event.data);
          console.log('📦 Parsed WebSocket data:', {
            type: data.type,
            hasData: !!data.data,
            dataSize: data.data ? data.data.length : 0
          });
          
          if (data.type === 'frame' && data.data) {
            setFrame(data.data);
            frameCountRef.current++;
            console.log(`🎥 Frame received #${frameCountRef.current}, size: ${data.data.length} chars`);
          } else if (data.type === 'connected') {
            console.log('✅ WebSocket connection confirmed:', data.message);
          } else if (data.type === 'device-status') {
            console.log('📱 Device status update received');
            loadDevices();
          } else if (data.type === 'auth-success') {
            console.log('🔐 WebSocket authentication successful');
          } else if (data.type === 'auth-error') {
            console.error('🚫 WebSocket authentication failed:', data.message);
          } else {
            console.log('❓ Unknown WebSocket message type:', data.type);
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', {
            error: error instanceof Error ? error.message : String(error),
            rawData: event.data.substring(0, 100)
          });
        }
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
          timestamp: new Date().toISOString()
        });
        
        // Log common close codes with explanations
        const closeCodeExplanations: { [key: number]: string } = {
          1000: 'Normal closure',
          1001: 'Going away',
          1002: 'Protocol error', 
          1003: 'Unsupported data',
          1006: 'Abnormal closure (no close frame)',
          1011: 'Server error',
          1012: 'Service restart',
          1013: 'Try again later',
          1014: 'Bad gateway',
          1015: 'TLS handshake failure'
        };
        
        if (closeCodeExplanations[event.code]) {
          console.log(`📝 Close code meaning: ${closeCodeExplanations[event.code]}`);
        }
        
        setIsConnected(false);
        setConnectionStatus('Disconnected');
        
        // Attempt to reconnect after delay
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('🔄 Attempting to reconnect WebSocket...');
          connectWebSocket();
        }, CONFIG.RECONNECT_DELAY_MS) as any;
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error occurred:', {
          error: error,
          timestamp: new Date().toISOString(),
          readyState: ws.readyState,
          url: `${getWebSocketURL('/api/v1/stream/live')}?apiKey=${CONFIG.API_KEY}`
        });
        
        // Log WebSocket ready states for debugging
        const readyStateNames = {
          0: 'CONNECTING',
          1: 'OPEN', 
          2: 'CLOSING',
          3: 'CLOSED'
        };
        
        console.log(`🔍 WebSocket ready state: ${readyStateNames[ws.readyState as keyof typeof readyStateNames]} (${ws.readyState})`);
        
        setIsConnected(false);
        setConnectionStatus('Connection Error');
      };

    } catch (error) {
      console.error('❌ Error creating WebSocket connection:', {
        error: error instanceof Error ? error.message : String(error),
        intendedUrl: `${getWebSocketURL('/api/v1/stream/live')}?apiKey=${CONFIG.API_KEY}`,
        timestamp: new Date().toISOString()
      });
      setConnectionStatus('Connection Error');
    }
  };

  const saveRecording = async () => {
    if (isRecording) return;

    try {
      console.log('💾 Starting to save recording...');
      setIsRecording(true);
      
      const response = await api.post('/api/v1/stream/record');
      
      console.log('📼 Recording save response:', {
        success: response.data.success,
        recordingId: response.data.data?.recordingId,
        frameCount: response.data.data?.frameCount
      });
      
      if (response.data.success) {
        console.log('✅ Recording saved successfully');
        Alert.alert(
          'Recording Saved',
          `Recording has been saved successfully!\n\nRecording ID: ${response.data.data.recordingId}\nFrames: ${response.data.data.frameCount}`,
          [{ text: 'OK' }]
        );
      } else {
        console.warn('⚠️ Recording save failed - API returned success=false');
        Alert.alert('Error', 'Failed to save recording');
      }
    } catch (error) {
      console.error('❌ Error saving recording:', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
      Alert.alert(
        'Error', 
        'Failed to save recording. Please check your connection to the backend server.'
      );
    } finally {
      setIsRecording(false);
    }
  };

  const startRecording = async () => {
    if (!selectedCamera) {
      Alert.alert('Error', 'No camera selected');
      return;
    }

    try {
      const response = await api.post('/api/v1/stream/start-recording', {
        cameraId: selectedCamera
      });

      if (response.data.success) {
        setIsRecording(true);
        Alert.alert('Success', 'Recording started');
      } else {
        Alert.alert('Error', 'Failed to start recording');
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    try {
      const response = await api.post('/api/v1/stream/stop-recording');

      if (response.data.success) {
        setIsRecording(false);
        Alert.alert('Success', 'Recording stopped and saved');
      } else {
        Alert.alert('Error', 'Failed to stop recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      Alert.alert('Error', 'Failed to stop recording');
    }
  };

  const sendCameraCommand = async (command: string) => {
    if (!selectedCamera) {
      console.warn('⚠️ No camera selected for command');
      return;
    }

    try {
      console.log('📤 Sending camera command:', {
        command,
        deviceId: selectedCamera,
        timestamp: new Date().toISOString()
      });
      
      const response = await api.post('/api/v1/control/command', {
        deviceId: selectedCamera,
        command: command
      });

      console.log('📨 Command response:', {
        success: response.data.success,
        error: response.data.error,
        deviceId: selectedCamera,
        command
      });

      if (response.data.success) {
        console.log('✅ Command sent successfully');
        Alert.alert('Success', `Command "${command}" sent successfully`);
      } else {
        console.warn('⚠️ Command failed:', response.data.error);
        Alert.alert('Error', response.data.error || 'Failed to send command');
      }
    } catch (error) {
      console.error('❌ Error sending command:', {
        error: error instanceof Error ? error.message : String(error),
        command,
        deviceId: selectedCamera,
        timestamp: new Date().toISOString()
      });
      Alert.alert('Error', 'Failed to send command');
    }
  };

  const getQualityColor = (quality: StreamStats['connectionQuality']) => {
    switch (quality) {
      case 'excellent': return '#4CAF50';
      case 'good': return '#8BC34A';
      case 'poor': return '#FF9800';
      case 'disconnected': return '#F44336';
      default: return '#757575';
    }
  };

  const renderCameraSelector = () => {
    const cameras = devices.filter(d => d.deviceType === 'camera');
    
    if (cameras.length === 0) {
      return (
        <View style={styles.noDevicesContainer}>
          <ThemedText style={styles.noDevicesText}>No cameras found</ThemedText>
          <ThemedText style={styles.noDevicesSubtext}>
            Make sure your ESP32-S3 camera is connected and online
          </ThemedText>
        </View>
      );
    }

    return (
      <View style={styles.cameraSelector}>
        <ThemedText style={styles.selectorLabel}>Camera:</ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cameraList}>
          {cameras.map((camera) => (
            <TouchableOpacity
              key={camera.deviceId}
              style={[
                styles.cameraOption,
                {
                  backgroundColor: selectedCamera === camera.deviceId ? '#2196F3' : '#333',
                  opacity: camera.status === 'online' ? 1 : 0.5
                }
              ]}
              onPress={() => camera.status === 'online' && setSelectedCamera(camera.deviceId)}
            >
              <IconSymbol name="camera.fill" size={16} color="#fff" />
              <Text style={styles.cameraOptionText}>{camera.deviceId}</Text>
              <View style={[styles.statusDot, { 
                backgroundColor: camera.status === 'online' ? '#4CAF50' : '#F44336' 
              }]} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  const renderStreamStats = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statItem}>
        <Text style={styles.statValue}>{streamStats.fps}</Text>
        <Text style={styles.statLabel}>FPS</Text>
      </View>
      
      <View style={styles.statItem}>
        <View style={[styles.qualityIndicator, { 
          backgroundColor: getQualityColor(streamStats.connectionQuality) 
        }]} />
        <Text style={styles.statLabel}>{streamStats.connectionQuality.toUpperCase()}</Text>
      </View>
      
      {isRecording && (
        <View style={styles.statItem}>
          <View style={styles.recordingIndicator} />
          <Text style={styles.statLabel}>RECORDING</Text>
        </View>
      )}
    </View>
  );

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'Connected':
        return '#4CAF50';
      case 'Connecting...':
        return '#FF9800';
      default:
        return '#F44336';
    }
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Header */}
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Live Camera Stream</ThemedText>
        <View style={[styles.statusIndicator, { backgroundColor: getConnectionStatusColor() }]}>
          <Text style={styles.statusText}>{connectionStatus}</Text>
        </View>
      </View>

      {/* Video Stream Container */}
      <View style={styles.videoContainer}>
        {frame ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${frame}` }}
            style={styles.videoStream}
            contentFit="contain"
            placeholder={{ blurhash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4' }}
          />
        ) : (
          <View style={styles.placeholderContainer}>
            {isConnected ? (
              <>
                <ActivityIndicator size="large" color="#fff" />
                <ThemedText style={styles.placeholderText}>
                  Waiting for video stream...
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText style={styles.placeholderText}>
                  {connectionStatus}
                </ThemedText>
                <ThemedText style={styles.subtitleText}>
                  Make sure your ESP32 camera is connected and streaming
                </ThemedText>
              </>
            )}
          </View>
        )}
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[
            styles.recordButton,
            { opacity: isRecording ? 0.6 : 1 }
          ]}
          onPress={saveRecording}
          disabled={isRecording || !isConnected}
        >
          {isRecording ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.recordButtonText}>Save Last 30 Seconds</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.reconnectButton}
          onPress={connectWebSocket}
          disabled={isConnected}
        >
          <Text style={styles.reconnectButtonText}>
            {isConnected ? 'Connected' : 'Reconnect'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Stream Info */}
      {frame && (
        <View style={styles.infoContainer}>
          <ThemedText style={styles.infoText}>
            Streaming at ~10 FPS • Resolution: VGA (640x480)
          </ThemedText>
        </View>
      )}
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
  statusIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  noDevicesContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noDevicesText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
  },
  noDevicesSubtext: {
    color: '#aaa',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  cameraSelector: {
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  selectorLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cameraList: {
    flexDirection: 'row',
  },
  cameraOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginRight: 8,
  },
  cameraOptionText: {
    color: '#fff',
    fontSize: 12,
    marginLeft: 6,
    marginRight: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingVertical: 8,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: '#4CAF50',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#aaa',
    fontSize: 10,
    marginTop: 2,
  },
  qualityIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  recordingIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F44336',
    marginBottom: 4,
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  videoStream: {
    width: screenWidth,
    height: (screenWidth * 3) / 4, // 4:3 aspect ratio for VGA
    backgroundColor: '#000',
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  placeholderText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    marginTop: 20,
  },
  subtitleText: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    backgroundColor: '#1a1a1a',
  },
  recordButton: {
    backgroundColor: '#FF4444',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    flex: 1,
    marginRight: 10,
    alignItems: 'center',
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  reconnectButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  reconnectButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  infoContainer: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    backgroundColor: '#1a1a1a',
  },
  infoText: {
    color: '#ccc',
    fontSize: 12,
    textAlign: 'center',
  },
});
