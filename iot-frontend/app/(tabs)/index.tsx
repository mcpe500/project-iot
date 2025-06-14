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
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG, getWebSocketURL, getHttpURL } from '@/app/config';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function LiveStreamScreen() {
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [isRecording, setIsRecording] = useState(false);
  const [lastFrameTime, setLastFrameTime] = useState<number | null>(null);
  const [fps, setFps] = useState(0);
  const frameCountRef = useRef(0);
  const lastFpsCalcTimeRef = useRef(Date.now());

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null); // Changed NodeJS.Timeout to number

  const api = axios.create({
    baseURL: CONFIG.BACKEND_URL,
    timeout: 10000, // 10 second timeout
    headers: {
      'Content-Type': 'application/json',
    }
  });

  useEffect(() => {
    connectWebSocket();

    const fpsInterval = setInterval(() => {
      const now = Date.now();
      const timeDiff = now - lastFpsCalcTimeRef.current;
      const currentFps = frameCountRef.current / (timeDiff / 1000);

      setFps(currentFps);
      setLastFrameTime(now);

      frameCountRef.current = 0;
      lastFpsCalcTimeRef.current = now;
    }, 1000);

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      clearInterval(fpsInterval);
    };
  }, []);

  const connectWebSocket = () => {
    try {
      setConnectionStatus('Connecting...');
      const wsUrl = `${getWebSocketURL('/api/v1/stream/live')}?apiKey=${CONFIG.API_KEY}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('Connected');
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'frame' && data.data) {
          setCurrentFrame(data.data);
          frameCountRef.current++;
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
          console.log(`ℹ️ WebSocket close code ${event.code}: ${closeCodeExplanations[event.code]}`);
        }
        
        setIsConnected(false);
        setConnectionStatus('Disconnected');
        
        // Attempt to reconnect after delay
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isConnected && wsRef.current?.readyState !== WebSocket.OPEN) {
            console.log('🔁 Attempting to reconnect WebSocket...');
            connectWebSocket();
          }
        }, CONFIG.RECONNECT_DELAY_MS); // setTimeout returns a number in browser-like envs
      };

      ws.onerror = () => {
        setIsConnected(false);
        setConnectionStatus('Connection Error');
      };
    } catch (error) {
      setConnectionStatus('Connection Error');
    }
  };

  const saveRecording = async () => {
    if (isRecording) return;

    try {
      setIsRecording(true);
      const response = await api.post('/api/v1/stream/record');

      if (response.data.success && response.data.data?.recordingId) {
        Alert.alert(
          'Recording Saved',
          `ID: ${response.data.data.recordingId}\nFrames: ${response.data.data.frameCount}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', response.data.message || 'Failed to save recording. Please try again.');
      }
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.message || error.message || 'Failed to save recording. Check connection and backend server.'
      );
    } finally {
      setIsRecording(false);
    }
  };

  const getStatusColorAndIcon = () => {
    if (isConnected) return { color: '#4CAF50', iconName: 'wifi' as const, text: 'Live' };
    if (connectionStatus === 'Connecting...') return { color: '#FFC107', iconName: 'arrow.triangle.2.circlepath' as const, text: 'Connecting...' };
    return { color: '#F44336', iconName: 'wifi.slash' as const, text: 'Offline' };
  };
  const { color: statusColor, iconName: statusIcon, text: statusText } = getStatusColorAndIcon();

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.header}>
        <Text style={styles.title}>Live Stream</Text>
        <View style={[styles.statusIndicator, { backgroundColor: statusColor }]}>
          <IconSymbol name={statusIcon} size={14} color="#fff" style={{ marginRight: statusText ? 6 : 0 }} />
          {statusText && <Text style={styles.statusText}>{statusText}</Text>}
        </View>
      </View>

      <View style={styles.streamContainer}>
        {currentFrame ? (
          <Image
            source={{ uri: `data:image/jpeg;base64,${currentFrame}` }}
            style={styles.liveImage}
            resizeMode="contain"
          />
        ) : (
          <View style={styles.noStreamContainer}>
            <IconSymbol name="video.slash.fill" size={64} color="#444" />
            <Text style={styles.noStreamText}>{isConnected ? "Waiting for stream..." : "Stream Offline"}</Text>
          </View>
        )}
      </View>

      <View style={styles.controlsContainer}>
        <View style={styles.statsContainer}>
          <Text style={styles.fpsText}>FPS: {fps.toFixed(1)}</Text>
          <Text style={styles.lastFrameText}>
            Last frame: {lastFrameTime ? new Date(lastFrameTime).toLocaleTimeString() : 'N/A'}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.recordButton, isRecording && styles.recordButtonDisabled]}
          onPress={saveRecording}
          disabled={isRecording || !isConnected}
        >
          {isRecording ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <IconSymbol name="record.circle" size={20} color={isConnected ? "#fff" : "#888"} />
          )}
          <Text style={[styles.recordButtonText, (!isConnected && !isRecording) && { color: "#888" }]}>
            {isRecording ? 'Saving...' : 'Save Recording'}
          </Text>
        </TouchableOpacity>
      </View>
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
    paddingTop: (StatusBar.currentHeight || 0) + 15,
    paddingBottom: 15,
    backgroundColor: '#121212',
    borderBottomWidth: 1,
    borderBottomColor: '#222',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 15,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  streamContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0c0c0c',
    margin: 8,
    borderRadius: 8,
    overflow: 'hidden',
  },
  liveImage: {
    width: '100%',
    height: '100%',
  },
  noStreamContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noStreamText: {
    color: '#777',
    marginTop: 16,
    fontSize: 16,
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 20,
    backgroundColor: '#121212',
    borderTopWidth: 1,
    borderTopColor: '#222',
  },
  statsContainer: {
    flex: 1,
  },
  fpsText: {
    color: '#ccc',
    fontSize: 13,
  },
  lastFrameText: {
    color: '#aaa',
    fontSize: 11,
    marginTop: 2,
  },
  recordButton: {
    flexDirection: 'row',
    backgroundColor: '#E53935',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 150,
  },
  recordButtonDisabled: {
    backgroundColor: '#B0BEC5',
  },
  recordButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
  },
});
