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
  Dimensions,
  Modal
} from 'react-native';
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { CONFIG } from './config';
import { Video, ResizeMode } from 'expo-av';

// Interface for media items (videos or images)
interface MediaItem {
  id: string;          // original filename, unique
  name: string;        // display name, can be derived from filename
  url: string;         // full URL to media
  createdAt: string;   // ISO string
  type: 'video' | 'image';
  frameCount?: number; // For videos (from backend) or images (placeholder)
  size?: number;       // File size (placeholder or from backend if available)
  durationText?: string; // For display
}

type ActiveTab = 'videos' | 'frames';

export default function RecordingsScreen() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('videos');

  // State for video player modal
  const [isVideoPlayerVisible, setIsVideoPlayerVisible] = useState(false);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    loadMedia(activeTab, true);
  }, [activeTab]);

  const loadMedia = async (tabType: ActiveTab, initialLoad = false) => {
    if (initialLoad) setLoading(true);
    setError(null);

    let endpoint = '';
    if (tabType === 'videos') {
      endpoint = `${CONFIG.BACKEND_URL}/api/v1/stream/recordings`;
    } else {
      endpoint = `${CONFIG.BACKEND_URL}/api/v1/stream/frames`;
    }

    try {
      const response = await axios.get(endpoint);
      let rawItems: any[] = [];

      if (response.data && response.data.success === true && Array.isArray(response.data.data)) {
        rawItems = response.data.data;
      } else if (Array.isArray(response.data)) {
        rawItems = response.data;
        console.warn(`Backend at ${endpoint} returned an array directly. Expected { success: true, data: [...] }. Proceeding with direct array.`);
      } else {
        throw new Error(`Unexpected response structure from ${endpoint}`);
      }
      
      const transformedItems: MediaItem[] = rawItems.map((item: any) => {
        let createdAt = item.createdAt;
        let frameCount = item.frameCount;
        let name = item.filename;
        let type: 'video' | 'image' = tabType === 'videos' ? 'video' : 'image';

        if (tabType === 'frames') {
          const timestampMatch = item.filename.match(/_(\d+)\.(jpg|jpeg|png)$/i);
          const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : Date.now();
          createdAt = new Date(timestamp).toISOString();
          frameCount = 1;
        }
        
        return {
          id: item.filename,
          name: name,
          url: `${CONFIG.BACKEND_URL}${item.url}`,
          createdAt: createdAt || new Date(0).toISOString(),
          type: type,
          frameCount: frameCount,
          size: item.size || 0,
          durationText: type === 'video' ? getDurationText(frameCount || 0, item.fps || 10) : '1 frame'
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setMediaItems(transformedItems);

    } catch (err) {
      console.error(`Error loading ${tabType}:`, err);
      let errorMessage = `Failed to load ${tabType}. `;
      if (axios.isAxiosError(err) && !err.response) {
        errorMessage += 'Cannot connect to the server. Please check the backend and network connection.';
      } else if (axios.isAxiosError(err) && err.response?.status === 404 && tabType === 'frames') {
        errorMessage += 'The endpoint for image frames might not be implemented on the backend.';
      } else if (err instanceof Error) { // Type guard for Error
        errorMessage += err.message;
      } else {
        errorMessage += 'An unknown error occurred.';
      }
      setError(errorMessage);
      setMediaItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadMedia(activeTab);
  }, [activeTab]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handlePlayVideo = (url: string) => {
    setSelectedVideoUrl(url);
    setIsVideoPlayerVisible(true);
  };

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

  const getDurationText = (frameCount: number, fps: number = 10) => {
    if (frameCount === 0) return '0s (0 frames)';
    if (frameCount === 1) return '1 frame';
    const seconds = Math.max(1, Math.round(frameCount / fps)); 
    return `${seconds}s (${frameCount} frames at ~${fps}fps)`;
  };

  const showMediaDetails = (item: MediaItem) => {
    Alert.alert(
      item.type === 'video' ? 'Video Recording Details' : 'Image Frame Details',
      `Name: ${item.name}\n` +
      `Type: ${item.type}\n` +
      `Created: ${formatDate(item.createdAt)}\n` +
      (item.type === 'video' ? `Duration: ${item.durationText}\n` : '') +
      `Frames: ${item.frameCount || (item.type === 'image' ? 1 : 'N/A')}\n` +
      `Size: ${formatFileSize(item.size || 0)}\n` +
      `URL: ${item.url}`,
      [
        (item.type === 'video' && item.url ? { 
            text: 'Play Video', 
            onPress: () => handlePlayVideo(item.url), style: 'default' 
        } : null),
        { text: 'OK', style: 'cancel' }
      ].filter(Boolean) as any
    );
  };

  const renderMediaItem = ({ item }: { item: MediaItem }) => (
    <TouchableOpacity
      style={styles.recordingItem}
      onPress={() => {
        if (item.type === 'video' && item.url) {
          handlePlayVideo(item.url);
        } else {
          showMediaDetails(item);
        }
      }}
    >
      <View style={styles.recordingIcon}>
        <IconSymbol 
          name={item.type === 'video' ? "video.fill" : "photo.fill"} 
          size={24} 
          color={item.type === 'video' ? "#4CAF50" : "#007AFF"} 
        />
      </View>
      
      <View style={styles.recordingInfo}>
        <ThemedText style={styles.recordingName} numberOfLines={1}>
          {item.name}
        </ThemedText>
        <ThemedText style={styles.recordingDetails}>
          {formatDate(item.createdAt)}
        </ThemedText>
        <ThemedText style={styles.recordingMeta}>
          {item.type === 'video' ? item.durationText : `Frame • ${formatFileSize(item.size || 0)}`}
        </ThemedText>
      </View>

      <View style={styles.recordingActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => showMediaDetails(item)}
        >
          <IconSymbol name="info.circle" size={20} color="#2196F3" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol 
        name={activeTab === 'videos' ? "video.slash" : "photo.on.rectangle.angled"} 
        size={64} 
        color="#666" 
      />
      <ThemedText style={styles.emptyTitle}>
        {activeTab === 'videos' ? 'No Video Recordings Yet' : 'No Image Frames Found'}
      </ThemedText>
      <ThemedText style={styles.emptySubtitle}>
        {activeTab === 'videos' 
          ? 'Video recordings will appear here after you save them from the live stream.'
          : 'Image frames from the live stream will appear here. Ensure the backend endpoint is active.'}
      </ThemedText>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => loadMedia(activeTab)}
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
          loadMedia(activeTab);
        }}
      >
        <Text style={styles.refreshButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  if (loading && mediaItems.length === 0) {
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
      
      {/* Video Player Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={isVideoPlayerVisible}
        onRequestClose={() => {
          setIsVideoPlayerVisible(false);
          setSelectedVideoUrl(null);
        }}
      >
        <View style={styles.videoModalContainer}>
          {selectedVideoUrl && (
            <Video
              source={{ uri: selectedVideoUrl }}
              rate={1.0}
              volume={1.0}
              isMuted={false}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              style={styles.videoPlayer}
              onError={(error) => {
                console.error('Video playback error:', error);
                Alert.alert('Playback Error', 'Could not play this video.');
                setIsVideoPlayerVisible(false);
              }}
            />
          )}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              setIsVideoPlayerVisible(false);
              setSelectedVideoUrl(null);
            }}
          >
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <View style={styles.header}>
        <ThemedText type="title" style={styles.title}>Recordings</ThemedText>
        <TouchableOpacity
          style={styles.refreshIconButton}
          onPress={() => {
            setRefreshing(true);
            loadMedia(activeTab);
          }}
          disabled={refreshing}
        >
          <IconSymbol name="arrow.clockwise" size={20} color="#4CAF50" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'videos' && styles.activeTabButton]}
          onPress={() => handleTabChange('videos')}
        >
          <IconSymbol name="play.rectangle.fill" size={16} color={activeTab === 'videos' ? "#fff" : "#4CAF50"} />
          <Text style={[styles.tabButtonText, activeTab === 'videos' && styles.activeTabButtonText]}>
            Video Recordings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'frames' && styles.activeTabButton]}
          onPress={() => handleTabChange('frames')}
        >
          <IconSymbol name="photo.stack.fill" size={16} color={activeTab === 'frames' ? "#fff" : "#007AFF"} />
          <Text style={[styles.tabButtonText, activeTab === 'frames' && styles.activeTabButtonText]}>
            Image Frames
          </Text>
        </TouchableOpacity>
      </View>

      {error && !refreshing ? (
        renderErrorState()
      ) : (
        <FlatList
          data={mediaItems}
          renderItem={renderMediaItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={mediaItems.length === 0 && !loading ? styles.emptyList : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={['#4CAF50']}
              tintColor="#4CAF50"
            />
          }
          ListEmptyComponent={!loading ? renderEmptyState : null}
          showsVerticalScrollIndicator={false}
        />
      )}
      {refreshing && <ActivityIndicator style={styles.bottomLoader} size="small" color="#4CAF50" />}
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
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#1a1a1a',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeTabButton: {
    backgroundColor: '#333',
    borderColor: '#555',
  },
  tabButtonText: {
    color: '#ccc',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  bottomLoader: {
    marginVertical: 10,
  },
  // Styles for Video Player Modal
  videoModalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayer: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height * 0.8,
  },
  closeButton: {
    position: 'absolute',
    top: StatusBar.currentHeight ? StatusBar.currentHeight + 20 : 60,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 20,
  },
  closeButtonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
