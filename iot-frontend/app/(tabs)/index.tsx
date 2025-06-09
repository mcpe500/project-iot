import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Alert,
  TouchableOpacity,
  Text,
  Dimensions,
  ActivityIndicator,
  StatusBar
} from 'react-native';
import { Image } from 'expo-image';
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { CONFIG, getWebSocketURL, getHttpURL } from '@/app/config';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function LiveStreamScreen() {
  const [frame, setFrame] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const connectWebSocket = () => {
    try {
      setConnectionStatus('Connecting...');
      const ws = new WebSocket(getWebSocketURL('/api/v1/stream/live'));
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('Connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'frame' && data.data) {
            setFrame(data.data);
          } else if (data.type === 'connected') {
            console.log('WebSocket connection confirmed:', data.message);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        console.log('WebSocket disconnected:', event.code, event.reason);
        setIsConnected(false);
        setConnectionStatus('Disconnected');
        
        // Attempt to reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect...');
          connectWebSocket();
        }, CONFIG.RECONNECT_DELAY_MS) as any;
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
        setConnectionStatus('Connection Error');
      };

    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setConnectionStatus('Connection Error');
    }
  };

  const saveRecording = async () => {
    if (isRecording) return;

    try {
      setIsRecording(true);
      
      const response = await axios.post(getHttpURL('/api/v1/stream/record'));
      
      if (response.data.success) {
        Alert.alert(
          'Recording Saved',
          `Recording has been saved successfully!\n\nRecording ID: ${response.data.data.recordingId}\nFrames: ${response.data.data.frameCount}`,
          [{ text: 'OK' }]
        );
      } else {
        Alert.alert('Error', 'Failed to save recording');
      }
    } catch (error) {
      console.error('Error saving recording:', error);
      Alert.alert(
        'Error', 
        'Failed to save recording. Please check your connection to the backend server.'
      );
    } finally {
      setIsRecording(false);
    }
  };

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
