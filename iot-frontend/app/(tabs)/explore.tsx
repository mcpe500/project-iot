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

interface Recording {
  id: string;
  name: string;
  frameCount: number;
  createdAt: string;
  size: number;
}

export default function RecordingsScreen() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRecordings();
  }, []);

  const loadRecordings = async () => {
    try {
      setError(null);
      const response = await axios.get(`${CONFIG.BACKEND_URL}/api/v1/stream/recordings`);
      
      if (response.data.success) {
        // Sort recordings by creation date (newest first)
        const sortedRecordings = response.data.data.sort((a: Recording, b: Recording) => 
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        setRecordings(sortedRecordings);
      } else {
        setError('Failed to load recordings');
      }
    } catch (error) {
      console.error('Error loading recordings:', error);
      setError('Failed to connect to server. Please check your backend connection.');
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

  const renderRecordingItem = ({ item }: { item: Recording }) => (
    <TouchableOpacity
      style={styles.recordingItem}
      onPress={() => showRecordingDetails(item)}
    >
      <View style={styles.recordingIcon}>
        <IconSymbol name="video.fill" size={24} color="#4CAF50" />
      </View>
      
      <View style={styles.recordingInfo}>
        <ThemedText style={styles.recordingName} numberOfLines={1}>
          {item.name}
        </ThemedText>
        <ThemedText style={styles.recordingDetails}>
          {formatDate(item.createdAt)}
        </ThemedText>
        <ThemedText style={styles.recordingMeta}>
          {getDurationText(item.frameCount)} • {formatFileSize(item.size)}
        </ThemedText>
      </View>

      <View style={styles.recordingActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => showRecordingDetails(item)}
        >
          <IconSymbol name="info.circle" size={20} color="#2196F3" />
        </TouchableOpacity>
      </View>
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

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.header}>
          <ThemedText type="title" style={styles.title}>Recordings</ThemedText>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <ThemedText style={styles.loadingText}>Loading recordings...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Recordings</ThemedText>
        <TouchableOpacity
          style={styles.refreshIconButton}
          onPress={() => {
            setRefreshing(true);
            loadRecordings();
          }}
        >
          <IconSymbol name="arrow.clockwise" size={20} color="#4CAF50" />
        </TouchableOpacity>
      </View>

      {error ? (
        renderErrorState()
      ) : (
        <FlatList
          data={recordings}
          renderItem={renderRecordingItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={recordings.length === 0 ? styles.emptyList : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
              tintColor="#4CAF50"
            />
          }
          ListEmptyComponent={renderEmptyState}
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
