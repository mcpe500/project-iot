import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { useLocalSearchParams } from 'expo-router';

// Interface for media items (videos or images)
interface MediaItem {
  id: string;
  name: string; // User-facing display name
  url: string;
  type: 'video' | 'image'; // Literal type
  createdAt: string;
  size?: number;
  filename: string; // Original filename from backend (item.name or item.id)
  frameCount?: number; // Optional: number of frames
  durationText?: string; // Optional: human-readable duration like "1:23"
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
  const [videoStatus, setVideoStatus] = useState<AVPlaybackStatus | null>(null);
  const videoPlayerRef = useRef<Video>(null);

  const params = useLocalSearchParams<{ videoUrl?: string; videoName?: string; initialTab?: ActiveTab }>();

  useEffect(() => {
    const { initialTab: tabFromParams } = params;
    if (tabFromParams && tabFromParams !== activeTab) {
      setActiveTab(tabFromParams);
    }
  }, [params.initialTab]);

  useEffect(() => {
    loadMedia(activeTab, mediaItems.length === 0);

    const { videoUrl: urlFromParams } = params;
    if (urlFromParams && activeTab === 'videos') {
      const videoNameFromParams = params.videoName || 'Video';
      handlePlayVideo(urlFromParams);
    }
  }, [activeTab, params.videoUrl, params.videoName]);

  const loadMedia = useCallback(async (tabType: ActiveTab, initialLoad = false) => {
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
        const apiUrl = CONFIG.BACKEND_URL;
        
        let originalFilename: string = item.name || item.id; // Prefer item.name, then item.id
        if (typeof originalFilename !== 'string' || originalFilename.trim() === '') {
          originalFilename = `unknown_${tabType}_${Date.now()}${tabType === 'frames' ? '.jpg' : '.mp4'}`;
          console.warn(`Item received without valid name/id. Using fallback filename: ${originalFilename}`, item);
        }

        let nameToDisplay: string;
        let timestampMs: number;
        let frameCountVal: number | undefined = undefined;
        let durationTextVal: string | undefined = undefined;

        if (tabType === 'frames') {
          const match = originalFilename.match(/(\d{13,})\.jpg$/) || originalFilename.match(/_(\d{13,})\.jpg$/);
          if (match && match[1]) {
            timestampMs = parseInt(match[1], 10);
          } else if (item.createdAt && typeof item.createdAt === 'string') {
            timestampMs = Date.parse(item.createdAt);
          } else if (typeof item.createdAt === 'number') { // Handle if createdAt is already a timestamp
            timestampMs = item.createdAt; 
          } else {
            timestampMs = Date.now();
          }
          if (isNaN(timestampMs)) timestampMs = Date.now();
          nameToDisplay = `Frame ${new Date(timestampMs).toLocaleString()}`;
          frameCountVal = 1; // An image is considered 1 frame
        } else { // videos
          nameToDisplay = params.videoName && item.url === params.videoUrl ? params.videoName : originalFilename; 
          if (item.createdAt && typeof item.createdAt === 'string') {
            timestampMs = Date.parse(item.createdAt);
          } else if (typeof item.createdAt === 'number') {
            timestampMs = item.createdAt;
          } else {
            timestampMs = Date.now();
          }
          if (isNaN(timestampMs)) timestampMs = Date.now();
          
          // Populate frameCount and durationText if backend provides them for videos
          if (typeof item.frameCount === 'number') {
            frameCountVal = item.frameCount;
          }
          if (typeof item.durationSeconds === 'number') {
            const minutes = Math.floor(item.durationSeconds / 60);
            const seconds = Math.floor(item.durationSeconds % 60);
            durationTextVal = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          } else if (typeof item.durationText === 'string') { // Or if backend sends durationText directly
            durationTextVal = item.durationText;
          }
        }
        
        const idStr = String(item.id || originalFilename);
        const createdAtStr = item.createdAt ? String(item.createdAt) : new Date(timestampMs).toISOString();
        const urlStr = item.url ? (item.url.startsWith('http') ? item.url : `${apiUrl}${item.url}`) : '';
        if (!item.url) {
            console.warn(`Item '${originalFilename}' missing URL.`, item);
        }

        const mediaItem: MediaItem = {
          id: idStr,
          name: nameToDisplay,
          url: urlStr,
          type: tabType === 'videos' ? 'video' : 'image', // Assign literal type
          createdAt: createdAtStr,
          size: typeof item.size === 'number' ? item.size : undefined,
          filename: originalFilename,
          frameCount: frameCountVal,
          durationText: durationTextVal,
        };
        return mediaItem;
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      setMediaItems(transformedItems);

    } catch (err) {
      console.error(`Error loading ${tabType}:`, err);
      let errorMessage = `Failed to load ${tabType}. `;
      if (axios.isAxiosError(err) && !err.response) {
        errorMessage += 'Cannot connect to the server. Please check the backend and network connection.';
      } else if (axios.isAxiosError(err) && err.response?.status === 404 && tabType === 'frames') {
        errorMessage += 'The endpoint for image frames might not be implemented on the backend.';
      } else if (err instanceof Error) {
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
  }, [activeTab, params.videoName, params.videoUrl]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadMedia(activeTab);
  }, [activeTab]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handlePlayVideo = (url: string) => {
    if (!url) {
      Alert.alert("Error", "Video URL is invalid.");
      console.error("handlePlayVideo called with invalid URL:", url);
      return;
    }
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
          if (videoPlayerRef.current) {
            videoPlayerRef.current.unloadAsync();
          }
        }}
      >
        <View style={styles.videoModalContainer}>
          {selectedVideoUrl && (
            <Video
              ref={videoPlayerRef}
              source={{ uri: selectedVideoUrl }}
              rate={1.0}
              volume={1.0}
              isMuted={false}
              resizeMode={ResizeMode.CONTAIN}
              useNativeControls
              style={styles.videoPlayer}
              onPlaybackStatusUpdate={status => setVideoStatus(() => status)}
              onError={(errorMessage: string) => { // Corrected type to string
                console.error('Video player error:', errorMessage);
                Alert.alert("Video Error", `Could not play video: ${errorMessage}`);
                setIsVideoPlayerVisible(false); // Close modal on error
                setSelectedVideoUrl(null);
              }}
            />
          )}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => {
              setIsVideoPlayerVisible(false);
              setSelectedVideoUrl(null);
              if (videoPlayerRef.current) {
                videoPlayerRef.current.unloadAsync();
              }
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
