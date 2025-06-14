import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Platform, TextInput } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, CameraType } from 'expo-camera'; // Import CameraType
import * as FileSystem from 'expo-file-system';
// import { API_URL } from '@/app/config'; // Assuming you have your API_URL configured
import { useFocusEffect } from '@react-navigation/native';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG } from '../config';

const MAX_FPS = 10;
const FRAME_INTERVAL_MS = 1000 / MAX_FPS;
const RECONNECT_DELAY_MS = 5000;

interface FrameInfo {
  url: string;
  timestamp: number;
  recognition?: {
    status: string;
    recognizedAs?: string | null;
  };
}

export default function LiveStreamScreen() {
  const [facing, setFacing] = useState<CameraType>('back'); // Use CameraType
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastFrame, setLastFrame] = useState<FrameInfo | null>(null);
  const [fps, setFps] = useState(0);
  const [lastFrameTime, setLastFrameTime] = useState<number | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isRecordLoading, setIsRecordLoading] = useState(false);
  const [isAddingFace, setIsAddingFace] = useState(false);
  const [faceName, setFaceName] = useState('');
  const [showAddFaceModal, setShowAddFaceModal] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsCalcTimeRef = useRef(Date.now());
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected.');
      return;
    }
    console.log('Attempting to connect WebSocket...');
    // const wsUrl = CONFIG.WS_URL.replace(/^http/, 'ws');
    const wsUrl = CONFIG.WS_URL;
    const socket = new WebSocket(`${wsUrl}/`);

    socket.onopen = () => {
      console.log('WebSocket connected');
      setIsStreaming(true);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data.type === 'new_frame') {
          setLastFrame({
            url: `${CONFIG.BACKEND_URL}${data.url}`,
            timestamp: data.timestamp,
            recognition: data.recognition,
          });
          frameCountRef.current++;
          setLastFrameTime(Date.now());
        } else if (data.type === 'connection' && data.status === 'connected') {
          console.log('WebSocket server confirmed connection.');
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setIsStreaming(false);
      if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
      if (!reconnectTimeoutRef.current) {
        console.log(`Attempting to reconnect in ${RECONNECT_DELAY_MS / 1000} seconds...`);
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
      }
    };
    wsRef.current = socket;
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log('LiveStreamScreen focused, connecting WebSocket.');
      connectWebSocket();
      return () => {
        console.log('LiveStreamScreen unfocused, disconnecting WebSocket.');
        if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
        streamIntervalRef.current = null;
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        setIsStreaming(false);
        setLastFrame(null);
        setFps(0);
      };
    }, [connectWebSocket])
  );

  useEffect(() => {
    const fpsInterval = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = (now - lastFpsCalcTimeRef.current) / 1000;
      if (elapsedSeconds > 0) {
        setFps(Math.round(frameCountRef.current / elapsedSeconds));
      }
      frameCountRef.current = 0;
      lastFpsCalcTimeRef.current = now;
    }, 1000);
    return () => clearInterval(fpsInterval);
  }, []);

  const captureAndSendFrame = async () => {
    if (cameraRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: false });
        if (photo && photo.uri) {
          const formData = new FormData();
          formData.append('image', {
            uri: photo.uri,
            name: `frame_${Date.now()}.jpg`,
            type: 'image/jpeg',
          } as any);
          formData.append('deviceId', 'mobile-app-camera');

          fetch(`${CONFIG.BACKEND_URL}/api/v1/stream/stream`, {
            method: 'POST',
            body: formData,
            headers: {
              'Content-Type': 'multipart/form-data',
            },
          })
          .then(response => {
            if (!response.ok) {
              response.json().then(err => console.error('Error sending frame:', err)).catch(() => console.error('Error sending frame and parsing error response'));
            }
          })
          .catch(error => console.error('Error sending frame:', error));
        }
      } catch (error) {
        console.error('Error taking picture:', error);
      }
    }
  };

  const toggleStreaming = () => {
    if (isStreaming && streamIntervalRef.current) {
      clearInterval(streamIntervalRef.current);
      streamIntervalRef.current = null;
      console.log("Stopped sending frames via camera.");
    } else if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      streamIntervalRef.current = setInterval(captureAndSendFrame, FRAME_INTERVAL_MS);
      console.log("Started sending frames via camera.");
    } else {
      Alert.alert("Not Connected", "WebSocket is not connected. Cannot start streaming frames from camera.");
    }
  };

  const handleAddPermittedFace = async () => {
    if (!cameraRef.current) {
      Alert.alert("Error", "Camera not available.");
      return;
    }
    if (!faceName.trim()) {
      Alert.alert("Input Needed", "Please enter a name for the face.");
      return;
    }
    setIsAddingFace(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8, base64: false });
      if (photo && photo.uri) {
        const formData = new FormData();
        formData.append('image', {
          uri: photo.uri,
          name: `${faceName.trim().replace(/\s+/g, '_')}.jpg`,
          type: 'image/jpeg',
        } as any);
        formData.append('name', faceName.trim());

        const response = await fetch(`${CONFIG.BACKEND_URL}/api/v1/recognition/add-permitted-face`, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        const result = await response.json();
        if (response.ok && result.success) {
          Alert.alert("Success", `Face '${faceName}' added successfully.`);
          setShowAddFaceModal(false);
          setFaceName('');
        } else {
          Alert.alert("Error Adding Face", result.error || "Could not add face. Check server logs.");
        }
      }
    } catch (error) {
      console.error('Error adding permitted face:', error);
      Alert.alert("Error", "Failed to capture or send image for face recognition.");
    }
    setIsAddingFace(false);
  };

  const saveRecording = async () => {
    setIsRecordLoading(true);
    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/api/v1/stream/record`, { method: 'POST' });
      const result = await response.json();
      if (response.ok && result.success) {
        Alert.alert("Recording Saved", `Video ID: ${result.data.recordingId}\nFrames: ${result.data.frameCount}`);
      } else {
        Alert.alert("Error Saving Recording", result.error || "Could not save recording.");
      }
    } catch (error) {
      console.error('Error saving recording:', error);
      Alert.alert("Error", "Failed to save recording. Check server connection.");
    }
    setIsRecordLoading(false);
  };

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator size="large" /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>We need your permission to show the camera</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.button}><Text style={styles.buttonText}>Grant Permission</Text></TouchableOpacity>
      </View>
    );
  }

  function toggleCameraFacing() {
    setFacing(current => (current === 'back' ? 'front' : 'back'));
  }

  const getRecognitionStyle = (status?: string) => {
    switch (status) {
      case 'permitted_face':
        return styles.recognitionPermitted;
      case 'unknown_face':
        return styles.recognitionUnknown;
      case 'no_face_detected':
        return styles.recognitionNone;
      case 'recognition_error':
      case 'models_not_loaded':
        return styles.recognitionError;
      default:
        return styles.recognitionPending;
    }
  };

  const getRecognitionText = (recognition?: FrameInfo['recognition']) => {
    if (!recognition) return "Recognition: Pending...";
    switch (recognition.status) {
      case 'permitted_face':
        return `Permitted: ${recognition.recognizedAs || 'Yes'}`;
      case 'unknown_face':
        return "Unknown Face Detected";
      case 'no_face_detected':
        return "No Face Detected";
      case 'recognition_error':
        return "Recognition Error";
      case 'models_not_loaded':
        return "Recognition Models Offline";
      default:
        return `Status: ${recognition.status}`;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Stream</Text>
        <View style={[styles.statusIndicator, isStreaming ? styles.statusOnline : styles.statusOffline]} />
      </View>

      {showAddFaceModal ? (
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add Permitted Face</Text>
            <Text style={styles.modalInstructions}>Position the face clearly in the camera view below and enter a name.</Text>
            <View style={styles.cameraContainerSmall}>
              <CameraView style={styles.cameraSmall} facing={facing} ref={cameraRef} mode="picture" />
            </View>
            <TextInput 
              style={styles.input}
              placeholder="Enter name for the face"
              value={faceName}
              onChangeText={setFaceName}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.button, styles.modalButton]} onPress={() => setShowAddFaceModal(false)} disabled={isAddingFace}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.modalButton]} onPress={handleAddPermittedFace} disabled={isAddingFace}>
                {isAddingFace ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Capture & Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.streamContainer}>
          {lastFrame && lastFrame.url ? (
            <Image source={{ uri: lastFrame.url }} style={styles.streamImage} resizeMode="contain" />
          ) : (
            <View style={styles.noStreamContainer}>
              <Ionicons name="videocam-off-outline" size={64} color="#aaa" />
              <Text style={styles.noStreamText}>{isStreaming ? "Waiting for stream..." : "Stream offline. Connect to WebSocket."}</Text>
            </View>
          )}
        </View>
      )}

      {!showAddFaceModal && (
        <ScrollView style={styles.controlsContainer}>
          <View style={styles.statsContainer}>
            <Text style={styles.statsText}>FPS: {fps}</Text>
            <Text style={styles.statsText}>Last Frame: {lastFrameTime ? new Date(lastFrameTime).toLocaleTimeString() : 'N/A'}</Text>
          </View>
          {lastFrame && lastFrame.recognition && (
            <View style={[styles.recognitionStatus, getRecognitionStyle(lastFrame.recognition.status)]}>
              <Text style={styles.recognitionText}>{getRecognitionText(lastFrame.recognition)}</Text>
            </View>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity onPress={toggleCameraFacing} style={styles.controlButton} disabled={showAddFaceModal}>
              <Ionicons name="camera-reverse-outline" size={28} color="#007AFF" />
              <Text style={styles.controlButtonText}>Flip</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={toggleStreaming} style={styles.controlButton} disabled={showAddFaceModal || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN}>
              <Ionicons name={streamIntervalRef.current ? "stop-circle-outline" : "play-circle-outline"} size={28} color={streamIntervalRef.current ? "#FF3B30" : "#34C759"} />
              <Text style={styles.controlButtonText}>{streamIntervalRef.current ? "Stop Cam" : "Start Cam"}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity 
            onPress={saveRecording} 
            style={[styles.button, styles.recordButton, (isRecordLoading || !isStreaming) && styles.buttonDisabled]} 
            disabled={isRecordLoading || !isStreaming || showAddFaceModal}
          >
            {isRecordLoading ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="record-rec" size={24} color="white" />}
            <Text style={styles.buttonText}>Record Last 30s</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => setShowAddFaceModal(true)} 
            style={[styles.button, (isAddingFace || !permission?.granted) && styles.buttonDisabled]} 
            disabled={isAddingFace || !permission?.granted || (streamIntervalRef.current != null)}
          >
            <MaterialCommunityIcons name="face-recognition" size={24} color="white" />
            <Text style={styles.buttonText}>Add Permitted Face</Text>
          </TouchableOpacity>
          {streamIntervalRef.current != null && <Text style={styles.infoText}>Stop camera stream to add a face.</Text>}

        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusOnline: {
    backgroundColor: '#34C759',
  },
  statusOffline: {
    backgroundColor: '#FF3B30',
  },
  streamContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    margin: 10,
    borderRadius: 8,
    overflow: 'hidden',
  },
  streamImage: {
    width: '100%',
    height: '100%',
  },
  noStreamContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  noStreamText: {
    color: '#aaa',
    marginTop: 10,
    fontSize: 16,
  },
  controlsContainer: {
    paddingHorizontal: 15,
    paddingBottom: 10,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 10,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  statsText: {
    fontSize: 14,
    color: '#555',
  },
  recognitionStatus: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
    alignItems: 'center',
  },
  recognitionText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  recognitionPermitted: { backgroundColor: '#34C759' },
  recognitionUnknown: { backgroundColor: '#FF9500' },
  recognitionNone: { backgroundColor: '#8E8E93' },
  recognitionError: { backgroundColor: '#FF3B30' },
  recognitionPending: { backgroundColor: '#007AFF' },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 10,
  },
  controlButton: {
    alignItems: 'center',
    padding: 10,
  },
  controlButtonText: {
    fontSize: 12,
    color: '#007AFF',
    marginTop: 2,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  recordButton: {
    backgroundColor: '#FF3B30',
  },
  buttonDisabled: {
    backgroundColor: '#BDBDBD',
    elevation: 0,
  },
  message: {
    textAlign: 'center',
    fontSize: 16,
    margin: 20,
  },
  modalContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    width: '95%',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  modalInstructions: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 15,
  },
  cameraContainerSmall: {
    width: '100%',
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 15,
    backgroundColor: '#e0e0e0',
  },
  cameraSmall: {
    flex: 1,
  },
  input: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
    fontSize: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  modalButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  infoText: {
    textAlign: 'center',
    fontSize: 12,
    color: '#666',
    marginBottom: 10,
  },
});
