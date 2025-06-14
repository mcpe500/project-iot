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
  StatusBar
} from 'react-native';
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG } from '../config';
import { useRouter } from 'expo-router'; // Import useRouter

interface Recording {
  id: string;
  name: string;
  frameCount: number;
  createdAt: string;
  size: number;
  url: string;
}

export default function RecordingsScreen() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter(); // Initialize useRouter

  useEffect(() => {
    loadRecordings();
  }, []);

  const loadRecordings = async () => {
    try {
      setLoading(true); // Ensure loading is true at the start of a load
      setError(null);
      const response = await axios.get(`${CONFIG.BACKEND_URL}/api/v1/stream/recordings`);

      if (response.data && Array.isArray(response.data)) {
        const fetchedRecordings = response.data.map((rec: any) => ({
          id: String(rec.id || rec.name), // Ensure id is a string
          name: rec.name,
          frameCount: rec.frameCount || (rec.durationSeconds ? rec.durationSeconds * 10 : 0), // Estimate frameCount if not present
          createdAt: rec.createdAt,
          size: rec.size,
          url: rec.url,
        }));
        setRecordings(fetchedRecordings);
      } else {
        console.warn('Unexpected response data format:', response.data);
        setRecordings([]); // Set to empty array on unexpected format
      }
    } catch (error) {
      console.error('Error loading recordings:', error);
      setError('Failed to connect to server. Please check your backend connection.');
      setRecordings([]); // Clear recordings on error
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRecordings();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDurationText = (frameCount: number) => {
    const seconds = Math.round(frameCount / 10); // Assuming 10 FPS
    return `${seconds}s (${frameCount} frames)`;
  };

  const showRecordingDetails = (recording: Recording) => {
    Alert.alert(
      'Recording Details',
      `Name: ${recording.name}\n` +
      `Created: ${formatDate(recording.createdAt)}\n` +
      `Duration: ${getDurationText(recording.frameCount)}\n` +
      `Frames: ${recording.frameCount}\n` +
      `Size: ${formatFileSize(recording.size)}`,
      [
        { text: 'OK' }
      ]
    );
  };

  const playVideoRecording = (recording: Recording) => {
    if (!recording.url) {
      Alert.alert("Error", "Video URL is missing, cannot play.");
      return;
    }
    console.log(`Navigating to play video: ${recording.name}, URL: ${recording.url}`);
    router.push({
      pathname: "/recordings", // Path to recordings.tsx screen
      params: { videoUrl: recording.url, videoName: recording.name, initialTab: 'videos' },
    });
  };

  const keyExtractor = (item: Recording) => item.id;

  const renderRecordingItem = ({ item }: { item: Recording }) => (
    <TouchableOpacity
      style={styles.recordingItem}
      onPress={() => playVideoRecording(item)} // Updated onPress
    >
      <IconSymbol name="play.rectangle.fill" size={28} color="#4CAF50" style={styles.recordingIcon} />
      <View style={styles.recordingInfo}>
        <Text style={styles.recordingName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.recordingDetails}>
          {formatDate(item.createdAt)} • {formatFileSize(item.size)}
        </Text>
        <Text style={styles.recordingMeta}>
          {getDurationText(item.frameCount)}
        </Text>
      </View>
      <IconSymbol name="chevron.right" size={18} color="#555" />
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol name="video.slash" size={64} color="#666" />
      <ThemedText style={styles.emptyTitle}>No Recordings Yet</ThemedText>
      <ThemedText style={styles.emptySubtitle}>
        Recordings will appear here after you save video from the live stream.
        Go to the Live Stream tab and tap "Save Last 30 Seconds" to create your first recording.
      </ThemedText>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => loadRecordings()}
      >
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol name="exclamationmark.triangle" size={64} color="#FF4444" />
      <ThemedText style={styles.emptyTitle}>Connection Error</ThemedText>
      <ThemedText style={styles.emptySubtitle}>
        {error}
      </ThemedText>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => {
          setLoading(true);
          loadRecordings();
        }}
      >
        <Text style={styles.refreshButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && recordings.length === 0) { // Show loader only if no items yet
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4CAF50" />
        <Text style={styles.loadingText}>Loading Recordings...</Text>
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <View style={styles.header}>
        <Text style={styles.title}>Saved Recordings</Text>
        <TouchableOpacity onPress={onRefresh} style={styles.refreshIconButton} disabled={refreshing}>
          {refreshing ? <ActivityIndicator size="small" color="#fff" /> : <IconSymbol name="arrow.clockwise" size={20} color="#fff" />}
        </TouchableOpacity>
      </View>
      {error && !refreshing ? ( // Show error only if not also refreshing (to avoid flicker)
        renderErrorState()
      ) : (
        <FlatList
          data={recordings}
          renderItem={renderRecordingItem}
          keyExtractor={keyExtractor}
          style={styles.list}
          contentContainerStyle={recordings.length === 0 && !loading ? styles.emptyList : { paddingBottom: 20 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
              tintColor="#4CAF50"
              title="Pull to refresh"
              titleColor="#999"
            />
          }
          ListEmptyComponent={!loading ? renderEmptyState : null} // Show empty state only if not loading
          showsVerticalScrollIndicator={false}
        />
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
  refreshIconButton: {
    padding: 8,
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
  list: {
    flex: 1,
  },
  emptyList: {
    flex: 1,
  },
  recordingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  recordingIcon: {
    marginRight: 12,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  recordingDetails: {
    color: '#ccc',
    fontSize: 14,
    marginBottom: 2,
  },
  recordingMeta: {
    color: '#888',
    fontSize: 12,
  },
  recordingActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionButton: {
    padding: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  refreshButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 20,
    marginTop: 20,
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
