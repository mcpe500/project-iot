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
  Modal,
  Dimensions
} from 'react-native';
import axios from 'axios';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/IconSymbol';
import { CONFIG } from '@/config';
import { VideoView, useVideoPlayer, VideoContentFit } from 'expo-video';

interface MediaItem {
  id: string;
  name: string;
  url: string;
  type: 'video' | 'image';
  createdAt: string;
  size?: number;
  filename: string;
}

type ActiveTab = 'videos' | 'frames';

export default function ExploreScreen() {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('videos');
  const [isVideoPlayerVisible, setIsVideoPlayerVisible] = useState(false);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState<string | null>(null);

  // Always call useVideoPlayer at the top level
  const player = useVideoPlayer(
    selectedVideoUrl ? { uri: selectedVideoUrl } : { uri: '' },
    player => { if (selectedVideoUrl) player.play(); }
  );

  // --- Video Player Modal Logic ---
  const renderVideoModal = () => {
    if (!selectedVideoUrl) return null;
    return (
      <Modal
        animationType="slide"
        visible={isVideoPlayerVisible}
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => setIsVideoPlayerVisible(false)}
      >
        <View style={styles.videoModalContainer}>
          <VideoView
            player={player}
            style={styles.videoPlayer}
            contentFit="contain"
            nativeControls
          />
          <TouchableOpacity style={styles.closeButton} onPress={() => setIsVideoPlayerVisible(false)}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  };

  const loadMedia = useCallback(async (tab: ActiveTab, isInitialLoad = false) => {
    if (isInitialLoad) setLoading(true);
    setError(null);
    const endpoint = tab === 'videos'
      ? `${CONFIG.BACKEND_URL}/api/v1/stream/recordings`
      : `${CONFIG.BACKEND_URL}/api/v1/stream/frames`;

    try {
      const response = await axios.get(endpoint, { timeout: 10000 });
      let rawItems: any[] = [];
      
      if (response.data && response.data.success === true && Array.isArray(response.data.data)) {
        rawItems = response.data.data;
      } else if (Array.isArray(response.data)) {
        rawItems = response.data;
      } else {
        throw new Error('Invalid data structure from server.');
      }
      
      const transformedItems: MediaItem[] = rawItems.map((item: any) => {
        const apiUrl = CONFIG.BACKEND_URL;
        const originalFilename = item.id || item.name || `unknown_${Date.now()}`;
        const nameToDisplay = item.name || originalFilename;

        return {
          id: originalFilename,
          name: nameToDisplay,
          url: item.url ? (item.url.startsWith('http') ? item.url : `${apiUrl}${item.url}`) : '',
          type: tab === 'videos' ? 'video' : 'image' as 'video' | 'image',
          createdAt: item.createdAt || new Date().toISOString(),
          size: item.size,
          filename: originalFilename,
        };
      }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      setMediaItems(transformedItems);
    } catch (err) {
      console.error(`Error loading ${tab}:`, err);
      setError(axios.isAxiosError(err) && !err.response ? 
        'Cannot connect to the server.' : 'Failed to load media.');
      setMediaItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadMedia(activeTab, true);
  }, [activeTab]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadMedia(activeTab);
  }, [activeTab, loadMedia]);

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
      await axios.delete(endpoint);
      
      // Optimistic UI update
      setMediaItems(prev => prev.filter(item => item.filename !== filename));
    } catch (err) {
      console.error(`Error deleting video ${filename}:`, err);
      Alert.alert('Error', 'Failed to delete the recording.');
      // Re-fetch data to revert UI
      loadMedia('videos');
    }
  };

  const confirmDelete = (item: MediaItem) => {
    Alert.alert(
      'Delete Recording',
      `Are you sure you want to delete "${item.filename}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteVideo(item.filename) },
      ]
    );
  };

  const renderMediaItem = ({ item }: { item: MediaItem }) => (
    <TouchableOpacity
      style={styles.mediaItem}
      onPress={() => item.type === 'video' ? handlePlayVideo(item.url) : null}
    >
      <View style={styles.mediaIcon}>
        <IconSymbol name={item.type === 'video' ? "video" : "image"} size={24} color={item.type === 'video' ? "#4CAF50" : "#007AFF"} />
      </View>
      <View style={styles.mediaInfo}>
        <Text style={styles.mediaName} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.mediaDetails}>
          {new Date(item.createdAt).toLocaleString()}
        </Text>
      </View>
      {item.type === 'video' && (
        <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.deleteButton}>
          <IconSymbol name="trash-can-outline" size={22} color="#FF6347" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centered}>
          <IconSymbol name="alert-circle-outline" size={48} color="#FF4444" />
          <ThemedText style={styles.emptyTitle}>Connection Error</ThemedText>
          <ThemedText style={styles.emptySubtitle}>{error}</ThemedText>
          <TouchableOpacity style={styles.refreshButton} onPress={() => loadMedia(activeTab, true)}>
            <Text style={styles.refreshButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (mediaItems.length === 0) {
      return (
        <View style={styles.centered}>
          <IconSymbol name={activeTab === 'videos' ? "video-off" : "image-off-outline"} size={48} color="#666" />
          <ThemedText style={styles.emptyTitle}>No {activeTab} found</ThemedText>
          <ThemedText style={styles.emptySubtitle}>Pull down to refresh</ThemedText>
        </View>
      );
    }
    return (
      <FlatList
        data={mediaItems}
        renderItem={renderMediaItem}
        keyExtractor={(item) => item.id}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />}
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a1a" />
      {renderVideoModal()}

      <View style={styles.header}>
        <ThemedText style={styles.title}>Media Library</ThemedText>
      </View>

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'videos' && styles.activeTab]}
          onPress={() => setActiveTab('videos')}
        >
          <Text style={[styles.tabText, activeTab === 'videos' && styles.activeTabText]}>Videos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'frames' && styles.activeTab]}
          onPress={() => setActiveTab('frames')}
        >
          <Text style={[styles.tabText, activeTab === 'frames' && styles.activeTabText]}>Frames</Text>
        </TouchableOpacity>
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
    paddingTop: (StatusBar.currentHeight || 20) + 10,
    paddingBottom: 15,
    paddingHorizontal: 20,
    backgroundColor: '#1a1a1a',
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    paddingVertical: 10,
  },
  tabButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginHorizontal: 10,
    borderRadius: 20,
  },
  activeTab: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    color: '#ccc',
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 15,
  },
  emptySubtitle: {
    color: '#ccc',
    fontSize: 14,
    marginTop: 5,
    textAlign: 'center',
  },
  refreshButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    marginTop: 20,
  },
  refreshButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  list: {
    flex: 1,
  },
  mediaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1C1C1E',
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 16,
    borderRadius: 12,
  },
  mediaIcon: {
    marginRight: 16,
  },
  mediaInfo: {
    flex: 1,
  },
  mediaName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  mediaDetails: {
    color: '#8E8E93',
    fontSize: 13,
    marginTop: 4,
  },
  deleteButton: {
    padding: 8,
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
