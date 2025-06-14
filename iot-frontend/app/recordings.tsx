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
import { useLocalSearchParams, router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { IconSymbol } from '@/components/IconSymbol';
import { CONFIG } from '@/services/config';

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
    // Create video player with expo-video
  const player = useVideoPlayer(selectedVideoUrl || '', player => {
    player.loop = true;
  });

  // Update player source when selectedVideoUrl changes
  useEffect(() => {
    if (selectedVideoUrl && player) {
      player.replace(selectedVideoUrl);
    }
  }, [selectedVideoUrl, player]);

  const params = useLocalSearchParams<{ videoUrl?: string; videoName?: string; initialTab?: ActiveTab }>();

  useEffect(() => {
    if (params.initialTab && params.initialTab !== activeTab) {
      setActiveTab(params.initialTab);
    } else {
      loadMedia(activeTab, true);
    }
  }, [params.initialTab]);

  useEffect(() => {
    loadMedia(activeTab, mediaItems.length === 0);
  }, [activeTab]);
  
  const loadMedia = useCallback(async (tabType: ActiveTab, initialLoad = false) => {
    if (initialLoad) setLoading(true);
    setError(null);

    const endpoint = tabType === 'videos'
      ? `${CONFIG.BACKEND_URL}/api/v1/stream/recordings`
      : `${CONFIG.BACKEND_URL}/api/v1/stream/frames`;
      
      try {
      const response = await axios.get(endpoint, { timeout: 10000 });
      let rawItems: any[] = [];

      // Handle both response formats
      if (response.data && response.data.success === true && Array.isArray(response.data.data)) {
        rawItems = response.data.data;
      } else if (Array.isArray(response.data)) {
        rawItems = response.data;
      } else {
        throw new Error(`Unexpected response structure from ${endpoint}`);
      }
      
      const transformedItems: MediaItem[] = rawItems.map((item: any) => {
        const apiUrl = CONFIG.BACKEND_URL;
        const originalFilename = item.id || item.name || `unknown_${Date.now()}`;
        const nameToDisplay = item.name || originalFilename;

        return {
          id: originalFilename,
          name: nameToDisplay,
          url: item.url ? (item.url.startsWith('http') ? item.url : `${apiUrl}${item.url}`) : '',
          type: tabType === 'videos' ? 'video' : 'image' as 'video' | 'image',
          createdAt: item.createdAt || new Date().toISOString(),
          size: item.size,
          filename: originalFilename,
          frameCount: item.frameCount,
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setMediaItems(transformedItems);

    } catch (err) {
      console.error(`Error loading ${tabType}:`, err);
      let errorMessage = `Failed to load ${tabType}. `;
      if (axios.isAxiosError(err)) {
        errorMessage += err.response ? `Server responded with status ${err.response.status}.` : 'Cannot connect to the server.';
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
  }, []);

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
      return;
    }
    setSelectedVideoUrl(url);
    setIsVideoPlayerVisible(true);
  };
  
  const handleDeleteVideo = async (filename: string) => {
    try {
      const endpoint = `${CONFIG.BACKEND_URL}/api/v1/stream/recordings/${filename}`;
      const response = await axios.delete(endpoint);
      
      if (response.data.success) {
        Alert.alert('Success', `Recording '${filename}' deleted.`);
        // Refresh the list from the server to ensure consistency
        loadMedia('videos');
      } else {
        throw new Error(response.data.error || 'Failed to delete video.');
      }
    } catch (err) {
      console.error(`Error deleting video ${filename}:`, err);
      const message = axios.isAxiosError(err) && err.response?.data?.error
        ? err.response.data.error
        : 'An error occurred while deleting the file.';
      Alert.alert('Error', message);
    }
  };

  const confirmDelete = (item: MediaItem) => {
    Alert.alert(
      'Delete Recording',
      `Are you sure you want to delete "${item.filename}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteVideo(item.filename) },
      ]
    );
  };
  
  const formatDate = (dateString: string) => new Date(dateString).toLocaleString();
  
  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][i]}`;
  };
  
  const renderMediaItem = ({ item }: { item: MediaItem }) => (
    <TouchableOpacity style={styles.recordingItem} onPress={() => item.type === 'video' && handlePlayVideo(item.url)}>
        <View style={styles.recordingIcon}>
            <IconSymbol name={item.type === 'video' ? "video" : "image"} size={24} color={item.type === 'video' ? "#4CAF50" : "#007AFF"} />
        </View>
        <View style={styles.recordingInfo}>
            <ThemedText style={styles.recordingName} numberOfLines={1}>{item.name}</ThemedText>
            <ThemedText style={styles.recordingDetails}>{formatDate(item.createdAt)}</ThemedText>
            <ThemedText style={styles.recordingMeta}>{formatFileSize(item.size)}</ThemedText>
        </View>
        <View style={styles.recordingActions}>
            {/* Delete button for videos */}
            {item.type === 'video' && (
                <TouchableOpacity style={styles.actionButton} onPress={() => confirmDelete(item)}>
                    <IconSymbol name="trash-can-outline" size={22} color="#FF6347" />
                </TouchableOpacity>
            )}
        </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol name={activeTab === 'videos' ? "video-off" : "image-off-outline"} size={64} color="#666" />
      <ThemedText style={styles.emptyTitle}>{activeTab === 'videos' ? 'No Recordings Found' : 'No Frames Found'}</ThemedText>
      <ThemedText style={styles.emptySubtitle}>Pull down to refresh or try again later.</ThemedText>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.emptyContainer}>
      <IconSymbol name="alert-circle-outline" size={64} color="#FF4444" />
      <ThemedText style={styles.emptyTitle}>Connection Error</ThemedText>
      <ThemedText style={styles.emptySubtitle}>{error}</ThemedText>
      <TouchableOpacity style={styles.refreshButton} onPress={() => loadMedia(activeTab, true)}>
        <Text style={styles.refreshButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  const renderContent = () => {
    if (loading) {
      return <ActivityIndicator size="large" color="#4CAF50" style={{ marginTop: 50 }} />;
    }
    if (error) {
      return renderErrorState();
    }
    return (
      <FlatList
        data={mediaItems}
        renderItem={renderMediaItem}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={mediaItems.length === 0 ? styles.emptyList : {}}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} tintColor="#4CAF50" />}
        ListEmptyComponent={renderEmptyState}
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      {selectedVideoUrl && (
        <Modal
          animationType="slide"
          visible={isVideoPlayerVisible}
          supportedOrientations={['portrait', 'landscape']}
          onRequestClose={() => setIsVideoPlayerVisible(false)}
        >          <View style={styles.videoModalContainer}>
            <VideoView
              style={styles.videoPlayer}
              player={player}
              allowsFullscreen
              showsTimecodes
            />
            <TouchableOpacity style={styles.closeButton} onPress={() => setIsVideoPlayerVisible(false)}>
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
        {['videos', 'frames'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabButton, activeTab === tab && styles.activeTabButton]}
            onPress={() => handleTabChange(tab as ActiveTab)}
          >
            <IconSymbol name={tab === 'videos' ? "film" : "image-multiple"} size={18} color={activeTab === tab ? '#fff' : '#ccc'} />
            <Text style={[styles.tabButtonText, activeTab === tab && styles.activeTabButtonText]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {renderContent()}
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
    paddingTop: (StatusBar.currentHeight || 20) + 10,
    paddingBottom: 15,
    backgroundColor: '#1a1a1a',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  refreshIconButton: {
    padding: 8,
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
    backgroundColor: '#1C1C1E',
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 16,
    borderRadius: 12,
  },
  recordingIcon: {
    marginRight: 16,
  },
  recordingInfo: {
    flex: 1,
  },
  recordingName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  recordingDetails: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 4,
  },
   recordingMeta: {
    color: '#888',
    fontSize: 12,
     marginTop: 4,
  },
  recordingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  actionButton: {
    padding: 8,
    marginLeft: 8,
    borderRadius: 20,
    backgroundColor: '#2C2C2E',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginTop: -60,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
  },
  emptySubtitle: {
    color: '#ccc',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 12,
  },
  refreshButton: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: 20,
    paddingVertical: 10,
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
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
  },
  activeTabButton: {
    backgroundColor: '#007AFF',
  },
  tabButtonText: {
    color: '#ccc',
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  activeTabButtonText: {
    color: '#fff',
  },
  videoModalContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  closeButton: {
    position: 'absolute',
    top: (StatusBar.currentHeight || 40) + 10,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 10,
    borderRadius: 20,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
  },
});
