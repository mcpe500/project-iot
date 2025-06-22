import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ENV_CONFIG, getWebSocketUrl } from '../../services/config';

const RECONNECT_DELAY_MS = 3000;

interface RecognitionInfo {
  status: string;
  recognizedAs?: string | null;
}

interface FrameData {
  url: string;
  timestamp: number;
  recognition?: RecognitionInfo;
}

export default function LiveStreamScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  // State for WebSocket connection and stream
  const [isConnected, setIsConnected] = useState(false);
  const [fps, setFps] = useState(0);
  const [lastRecognition, setLastRecognition] = useState<RecognitionInfo | null>(null);

  // --- Image State ---
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null);
  const [nextImageUrl, setNextImageUrl] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  // State for UI controls
  const [isRecordLoading, setIsRecordLoading] = useState(false);
  const [isAddingFace, setIsAddingFace] = useState(false);
  const [faceName, setFaceName] = useState('');
  const [showAddFaceModal, setShowAddFaceModal] = useState(false);

  // Refs for non-rendering logic
  const wsRef = useRef<WebSocket | null>(null);
  const frameCountRef = useRef(0);
  const lastFpsCalcTimeRef = useRef(Date.now());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- WebSocket Connection Logic ---
  const connectWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    console.log('Attempting to connect WebSocket...');
    const wsUrl = getWebSocketUrl('/');
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string);

        // Handle both stream_frame and new_frame message types
        if ((data.type === 'stream_frame' || data.type === 'new_frame') && data.url) {
          const newFrameUrl = `${ENV_CONFIG.BACKEND_URL}${data.url}?t=${Date.now()}`;
          
          // Skip if already loading or same URL
          if (isLoadingRef.current || newFrameUrl === currentImageUrl) return;
          
          isLoadingRef.current = true;
          setNextImageUrl(newFrameUrl);
          
          // Preload image before switching
          Image.prefetch(newFrameUrl)
            .then(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                setCurrentImageUrl(newFrameUrl);
                setNextImageUrl(null);
                frameCountRef.current++;
              }
              isLoadingRef.current = false;
            })
            .catch(() => {
              // Fallback: set directly if prefetch fails
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                setCurrentImageUrl(newFrameUrl);
                setNextImageUrl(null);
                frameCountRef.current++;
              }
              isLoadingRef.current = false;
            });
        }
        
        // Handle recognition results separately
        if (data.type === 'recognition_result' && data.recognition) {
          setLastRecognition(data.recognition);
        }
        
        // Handle combined new_frame with recognition
        if (data.type === 'new_frame' && data.recognition) {
          setLastRecognition(data.recognition);
        }
        
        if (data.type === 'connection' && data.status === 'connected') {
          console.log('WebSocket server confirmed connection.');
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    socket.onerror = (error) => console.error('WebSocket error:', error.message);

    socket.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setCurrentImageUrl(null);
      setNextImageUrl(null);
      isLoadingRef.current = false;
      // Simple, robust reconnect logic
      if (!reconnectTimeoutRef.current) {
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
      }
    };

    wsRef.current = socket;
  }, []);

  // --- Lifecycle and Focus Effects ---
  useFocusEffect(
    useCallback(() => {
      connectWebSocket();
      return () => {
        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        wsRef.current?.close();
        wsRef.current = null;
        setIsConnected(false);
      };
    }, [connectWebSocket])
  );

  useEffect(() => {
    const fpsInterval = setInterval(() => {
      const elapsedSeconds = (Date.now() - lastFpsCalcTimeRef.current) / 1000;
      setFps(elapsedSeconds > 0 ? Math.round(frameCountRef.current / elapsedSeconds) : 0);
      frameCountRef.current = 0;
      lastFpsCalcTimeRef.current = Date.now();
    }, 1000);
    return () => clearInterval(fpsInterval);
  }, []);

  // --- UI Action Handlers ---
  const handleAddPermittedFace = async () => {
    if (!cameraRef.current || !faceName.trim()) {
      Alert.alert("Input Needed", "Camera must be ready and name must not be empty.");
      return;
    }
    setIsAddingFace(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (photo?.uri) {
        const formData = new FormData();
        formData.append('name', faceName.trim());
        formData.append('image', {
          uri: photo.uri,
          name: 'face.jpg',
          type: 'image/jpeg',
        } as any);

        const response = await fetch(`${ENV_CONFIG.BACKEND_URL}/api/v1/recognition/add-permitted-face`, {
          method: 'POST', body: formData,
        });

        const result = await response.json();
        if (response.ok && result.success) {
          Alert.alert("Success", `Face '${faceName}' added.`);
          setShowAddFaceModal(false);
          setFaceName('');
        } else {
          Alert.alert("Error", result.error || "Could not add face.");
        }
      }
    } catch (error) {
      Alert.alert("Error", "Failed to capture or send image.");
    } finally {
      setIsAddingFace(false);
    }
  };

  const saveRecording = async () => {
    setIsRecordLoading(true);
    try {
      const response = await fetch(`${ENV_CONFIG.BACKEND_URL}/api/v1/stream/record`, { method: 'POST' });
      const result = await response.json();
      if (response.ok && result.success) {
        Alert.alert("Recording Saved", `Video ID: ${result.data.recordingId}`);
      } else {
        Alert.alert("Error", result.error || "Could not save recording.");
      }
    } catch (error) {
      Alert.alert("Error", "Failed to save recording.");
    } finally {
      setIsRecordLoading(false);
    }
  };

  // --- Render Logic ---
  if (!permission) return <View style={styles.centered}><ActivityIndicator size="large" /></View>;
  if (!permission.granted) return (
    <View style={styles.centered}>
      <Text style={styles.message}>Camera permission is required.</Text>
      <TouchableOpacity onPress={requestPermission} style={styles.button}><Text style={styles.buttonText}>Grant Permission</Text></TouchableOpacity>
    </View>
  );

  const getRecognitionStyle = (status?: string) => {
    switch (status) {
      case 'permitted_face': return styles.recognitionPermitted;
      case 'unknown_face': return styles.recognitionUnknown;
      default: return styles.recognitionNone;
    }
  };

  const getRecognitionText = (recognition?: RecognitionInfo) => {
    if (!recognition) return "Status: Awaiting Data";
    switch (recognition.status) {
      case 'permitted_face': return `Permitted: ${recognition.recognizedAs || 'Known'}`;
      case 'unknown_face': return "Unknown Face Detected";
      case 'no_face_detected': return "No Face Detected";
      default: return `Status: ${recognition.status}`;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Stream</Text>
        <View style={[styles.statusIndicator, isConnected ? styles.statusOnline : styles.statusOffline]} />
      </View>

      {/* --- ADD FACE MODAL --- */}
      {showAddFaceModal && (
        <View style={styles.modalContainer}>
          <CameraView style={styles.cameraSmall} facing="front" ref={cameraRef} />
          <TextInput style={styles.input} placeholder="Enter name for face" value={faceName} onChangeText={setFaceName} />
          <View style={styles.modalButtons}>
            <TouchableOpacity style={[styles.button, { backgroundColor: '#555' }]} onPress={() => setShowAddFaceModal(false)}><Text style={styles.buttonText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={handleAddPermittedFace} disabled={isAddingFace}>
              {isAddingFace ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Capture & Save</Text>}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* --- MAIN STREAM VIEW --- */}
      {!showAddFaceModal && (
        <>
          <View style={styles.streamContainer}>
            {currentImageUrl ? (
              <Image
                source={{ uri: currentImageUrl }}
                style={styles.streamImage}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color="#aaa" />
                <Text style={styles.noStreamText}>{isConnected ? "Waiting for stream..." : "Connecting..."}</Text>
              </View>
            )}
            
            {/* Hidden preload image */}
            {nextImageUrl && (
              <Image
                source={{ uri: nextImageUrl }}
                style={styles.hiddenImage}
                onLoad={() => {
                  // Image is preloaded and ready
                }}
              />
            )}
          </View>

          <View style={styles.controlsContainer}>
            <View style={styles.statsContainer}>
              <Text style={styles.statsText}>FPS: {fps}</Text>
              <Text style={styles.statsText}>Status: {isConnected ? 'Online' : 'Offline'}</Text>
            </View>

            {lastRecognition && (
              <View style={[styles.recognitionStatus, getRecognitionStyle(lastRecognition.status)]}>
                <Text style={styles.recognitionText}>{getRecognitionText(lastRecognition)}</Text>
              </View>
            )}

            <TouchableOpacity onPress={saveRecording} style={[styles.button, styles.recordButton, !isConnected && styles.buttonDisabled]} disabled={isRecordLoading || !isConnected}>
              <MaterialCommunityIcons name="record-rec" size={24} color="white" />
              <Text style={styles.buttonText}>{isRecordLoading ? "Saving..." : "Save Last 30s"}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowAddFaceModal(true)} style={styles.button}>
              <MaterialCommunityIcons name="face-recognition" size={24} color="white" />
              <Text style={styles.buttonText}>Add Permitted Face</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 15, paddingTop: 50, backgroundColor: '#1C1C1E', borderBottomWidth: 1, borderBottomColor: '#2C2C2E' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  statusIndicator: { width: 12, height: 12, borderRadius: 6 },
  statusOnline: { backgroundColor: '#34C759' },
  statusOffline: { backgroundColor: '#FF3B30' },

  streamContainer: { flex: 1, backgroundColor: '#000', margin: 10, borderRadius: 8, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  streamImage: { width: '100%', height: '100%', backgroundColor: '#000' },
  hiddenImage: { position: 'absolute', width: 1, height: 1, opacity: 0, top: -1000 },
  noStreamText: { color: '#aaa', marginTop: 10, fontSize: 16 },

  controlsContainer: { padding: 15, borderTopWidth: 1, borderTopColor: '#2C2C2E' },
  statsContainer: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 10, backgroundColor: '#1C1C1E', borderRadius: 8, marginBottom: 10 },
  statsText: { fontSize: 14, color: '#E0E0E0' },

  recognitionStatus: { padding: 12, borderRadius: 8, marginBottom: 10, alignItems: 'center' },
  recognitionText: { fontSize: 14, fontWeight: 'bold', color: '#fff' },
  recognitionPermitted: { backgroundColor: '#34C759' },
  recognitionUnknown: { backgroundColor: '#FF9500' },
  recognitionNone: { backgroundColor: '#333' },

  button: { backgroundColor: '#007AFF', padding: 15, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  recordButton: { backgroundColor: '#FF3B30' },
  buttonDisabled: { backgroundColor: '#555' },

  message: { textAlign: 'center', fontSize: 16, margin: 20, color: '#fff' },

  modalContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 10 },
  cameraSmall: { width: '100%', aspectRatio: 3 / 4, borderRadius: 8, overflow: 'hidden', marginBottom: 15 },
  input: { width: '100%', backgroundColor: '#fff', padding: 12, borderRadius: 5, marginBottom: 15, fontSize: 16 },
  modalButtons: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', gap: 10 },
});