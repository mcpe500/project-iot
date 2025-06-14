import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
  Dimensions,
  StatusBar,
} from 'react-native';
import axios from 'axios';
import { useLocalSearchParams } from 'expo-router';
import { VideoView, VideoPlayer, VideoPlayerStatus } from 'expo-video';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/IconSymbol';
import { CONFIG } from '@/app/config';

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
  const [selectedVideoPlayer, setSelectedVideoPlayer] = useState<VideoPlayer | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoPlayerStatus | null>(null);
  const videoPlayerRef = useRef<any>(null);

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

        let originalFilename: string = item.name || item.id;
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
          } else if (typeof item.createdAt === 'number') {
            timestampMs = item.createdAt;
          } else {
            timestampMs = Date.now();
          }
          if (isNaN(timestampMs)) timestampMs = Date.now();
          nameToDisplay = `Frame ${new Date(timestampMs).toLocaleString()}`;
          frameCountVal = 1;
        } else {
          nameToDisplay = params.videoName && item.url === params.videoUrl ? params.videoName : originalFilename;
          if (item.createdAt && typeof item.createdAt === 'string') {
            timestampMs = Date.parse(item.createdAt);
          } else if (typeof item.createdAt === 'number') {
            timestampMs = item.createdAt;
          } else {
            timestampMs = Date.now();
          }
          if (isNaN(timestampMs)) timestampMs = Date.now();

          if (typeof item.frameCount === 'number') {
            frameCountVal = item.frameCount;
          }
          if (typeof item.durationSeconds === 'number') {
            const minutes = Math.floor(item.durationSeconds / 60);
            const seconds = Math.floor(item.durationSeconds % 60);
            durationTextVal = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          } else if (typeof item.durationText === 'string') {
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
          type: tabType === 'videos' ? 'video' : 'image',
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
  }, [activeTab, loadMedia]);

  const handleTabChange = (tab: ActiveTab) => {
    setActiveTab(tab);
  };

  const handlePlayVideo = (url: string) => {
    if (!url) {
      Alert.alert("Error", "Video URL is invalid.");
      console.error("handlePlayVideo called with invalid URL:", url);
      return;
    }
    const player = new VideoPlayer(url);
    setSelectedVideoPlayer(player);
    setIsVideoPlayerVisible(true);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getDurationText = (frameCount?: number, fps: number = 10) => {
    if (frameCount === undefined || frameCount === 0) return '0s (0 frames)';
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
      (item.type === 'video' ? `Duration: ${item.durationText || getDurationText(item.frameCount)}\n` : '') +
      `Frames: ${item.frameCount || (item.type === 'image' ? 1 : 'N/A')}\n` +
      `Size: ${formatFileSize(item.size)}\n` +
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
          name={item.type === 'video' ? "video" : "image"}
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
          {item.type === 'video'
            ? (item.durationText || getDurationText(item.frameCount))
            : `Frame • ${formatFileSize(item.size)}`}
        </ThemedText>
      </View>

      <View style={styles.recordingActions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => showMediaDetails(item)}
        >
          <IconSymbol name="information-outline" size={20} color="#2196F3" />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol
        name={activeTab === 'videos' ? "video-off" : "image-outline"}
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
        onPress={() => loadMedia(activeTab, true)}
      >
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol name="alert-circle-outline" size={64} color="#FF4444" />
      <ThemedText style={styles.emptyTitle}>Connection Error</ThemedText>
      <ThemedText style={styles.emptySubtitle}>
        {error || "An unknown error occurred. Please try again."}
      </ThemedText>
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={() => {
          loadMedia(activeTab, true);
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
          <ThemedText style={styles.title}>Recordings</ThemedText>
          <TouchableOpacity style={styles.refreshIconButton} onPress={onRefresh} disabled={refreshing}>
            <IconSymbol name="refresh" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
          <ThemedText style={styles.loadingText}>Loading Media...</ThemedText>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {selectedVideoPlayer && (
        <Modal
          animationType="slide"
          transparent={false}
          visible={isVideoPlayerVisible}
          onRequestClose={() => {
            selectedVideoPlayer?.pause();
            setIsVideoPlayerVisible(false);
            setSelectedVideoPlayer(null);
            setVideoStatus(null);
          }}
          supportedOrientations={['portrait', 'landscape']}
        >
          <View style={styles.videoModalContainer}>
            <VideoView
              ref={videoPlayerRef}
              style={styles.videoPlayer}
              player={selectedVideoPlayer}
              allowsFullscreen
              allowsPictureInPicture
            />
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                selectedVideoPlayer?.pause();
                setIsVideoPlayerVisible(false);
                setSelectedVideoPlayer(null);
                setVideoStatus(null);
              }}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </Modal>
      )}

      <View style={styles.header}>
        <ThemedText style={styles.title}>Recordings</ThemedText>
        <TouchableOpacity style={styles.refreshIconButton} onPress={onRefresh} disabled={refreshing}>
          <IconSymbol name={refreshing ? "sync" : "refresh"} size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'videos' && styles.activeTabButton]}
          onPress={() => handleTabChange('videos')}
        >
          <IconSymbol name="film" size={18} color={activeTab === 'videos' ? '#fff' : '#ccc'} />
          <Text style={[styles.tabButtonText, activeTab === 'videos' && styles.activeTabButtonText]}>
            Videos
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'frames' && styles.activeTabButton]}
          onPress={() => handleTabChange('frames')}
        >
          <IconSymbol name="image-multiple" size={18} color={activeTab === 'frames' ? '#fff' : '#ccc'} />
          <Text style={[styles.tabButtonText, activeTab === 'frames' && styles.activeTabButtonText]}>
            Frames
          </Text>
        </TouchableOpacity>
      </View>

      {error && !refreshing ? (
        renderErrorState()
      ) : (
        <FlatList
          data={mediaItems}
          renderItem={renderMediaItem}
          keyExtractor={(item) => item.id + item.filename}
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
          ListEmptyComponent={!loading && !refreshing ? renderEmptyState : null}
          showsVerticalScrollIndicator={false}
        />
      )}
      
      {refreshing && mediaItems.length > 0 && (
        <ActivityIndicator style={styles.bottomLoader} size="small" color="#4CAF50" />
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
    paddingTop: (StatusBar.currentHeight || 0) + 10,
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
    backgroundColor: '#000',
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
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#333',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  recordingIcon: {
    marginRight: 16,
    padding: 8,
    backgroundColor: '#2c2c2c',
    borderRadius: 20,
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
    fontSize: 13,
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
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginTop: -50,
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
    borderRadius: 25,
    marginTop: 25,
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
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
    marginVertical: 20,
  },
  videoModalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPlayer: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').width * (9 / 16),
  },
  closeButton: {
    position: 'absolute',
    top: (StatusBar.currentHeight || 0) + 20,
    right: 20,
    backgroundColor: 'rgba(30, 30, 30, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 25,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
