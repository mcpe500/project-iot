import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ScrollView, StyleSheet, View, Text, ActivityIndicator, Dimensions, SafeAreaView, TouchableOpacity, RefreshControl, Animated, Platform } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Picker } from '@react-native-picker/picker';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Colors } from '../../constants/Colors';
import { IconSymbol } from '../../components/ui/IconSymbol';
import { getSensorData, getDevices } from '../../services/api';

interface SensorDataItem {
  id: number;
  deviceId: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
}

interface DeviceItem {
  deviceId: string;
  deviceName: string;
}

type MetricKey = keyof Pick<SensorDataItem, 'temperature' | 'humidity' | 'distance' | 'lightLevel'>;

const screenWidth = Dimensions.get('window').width;

const SensorDataPage: React.FC = () => {
  const [sensorData, setSensorData] = useState<SensorDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(true);
  const fadeAnim = useMemo(() => new Animated.Value(1), []);
  const pulseAnim = useMemo(() => new Animated.Value(1), []);
  const valueAnims = useMemo(() => ({
    temperature: new Animated.Value(0),
    humidity: new Animated.Value(0),
    distance: new Animated.Value(0),
    lightLevel: new Animated.Value(0)
  }), []);

  const colorScheme = useColorScheme() ?? 'light';
  const themeColors = Colors[colorScheme];
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const fetchData = useCallback(async () => {
    if (!selectedDevice || !isLive) return;
    try {
      const response = await getSensorData(selectedDevice);
      let newData;
      if (response && Array.isArray(response)) {
        newData = response;
      } else if (Array.isArray(response.data)) {
        newData = response.data;
      } else {
        newData = [];
      }
      
      const sortedData = newData.sort((a: any, b: any) => a.timestamp - b.timestamp);
      
      // Check for new data by comparing with current state
      const hasNewData = sortedData.length > 0;
      
      console.log('Fetched data:', sortedData.length, 'items, hasNewData:', hasNewData);
      if (sortedData.length > 0) {
        console.log('Latest data:', sortedData[sortedData.length - 1]);
      }
      
      // Always update the data to ensure UI reflects latest state
      setSensorData(sortedData);
      setLastUpdate(new Date());
      
      if (hasNewData) {
        // Animate live indicator pulse
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.3, duration: 150, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true })
        ]).start();
        
        // Animate value changes
        Object.keys(valueAnims).forEach(key => {
          Animated.spring(valueAnims[key as MetricKey], {
            toValue: 1,
            tension: 100,
            friction: 8,
            useNativeDriver: true
          }).start(() => {
            valueAnims[key as MetricKey].setValue(0);
          });
        });
      }
    } catch (error) {
      console.error('Error fetching sensor data:', error);
      setIsLive(false);
      setTimeout(() => setIsLive(true), 5000); // Retry after 5 seconds
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedDevice, isLive, pulseAnim, valueAnims]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        const devResponse = await getDevices();
        const deviceList = devResponse.data?.devices?.filter((d: any) => d.deviceType?.includes('sensor')) || [];
        setDevices(deviceList);
        if (deviceList.length > 0) {
          setSelectedDevice(deviceList[0].deviceId);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.log('No devices connected');
        setDevices([]);
        setLoading(false);
      }
    };
    fetchInitialData();
  }, []);

  useEffect(() => {
    if (selectedDevice && isLive) {
      fetchData();
      const interval = setInterval(fetchData, 1000); // Real-time updates every second
      return () => clearInterval(interval);
    }
  }, [selectedDevice, fetchData, isLive]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, [fetchData]);

  const getMetricColor = (metric: MetricKey) => {
    const colors = {
      temperature: '#FF6B6B',
      humidity: '#4ECDC4',
      distance: '#45B7D1',
      lightLevel: '#FFA726'
    };
    return colors[metric] || themeColors.tint;
  };

  const getStatusColor = (value: number, metric: MetricKey) => {
    const ranges = {
      temperature: { good: [20, 25], warning: [15, 30] },
      humidity: { good: [40, 60], warning: [30, 70] },
      distance: { good: [10, 100], warning: [5, 200] },
      lightLevel: { good: [200, 800], warning: [100, 1000] }
    };
    const range = ranges[metric];
    if (value >= range.good[0] && value <= range.good[1]) return '#4CAF50';
    if (value >= range.warning[0] && value <= range.warning[1]) return '#FF9800';
    return '#F44336';
  };

  const MetricCard: React.FC<{ title: string; unit: string; metric: MetricKey; iconName: string; }> = React.memo(({
    title, unit, metric, iconName
  }) => {
    const dataPoints = useMemo(() => sensorData.slice(-30).map(item => item[metric] || 0), [sensorData, metric]);
    const chartData = useMemo(() => ({
      labels: [],
      datasets: [{
        data: dataPoints.length > 0 ? dataPoints : [0],
        color: () => getMetricColor(metric),
        strokeWidth: 2.5
      }],
    }), [dataPoints, metric]);
    
    const current = dataPoints.length > 0 ? dataPoints[dataPoints.length - 1] : 0;
    const previous = dataPoints.length > 1 ? dataPoints[dataPoints.length - 2] : current;
    const min = dataPoints.length > 0 ? Math.min(...dataPoints) : 0;
    const max = dataPoints.length > 0 ? Math.max(...dataPoints) : 0;
    const avg = dataPoints.length > 0 ? dataPoints.reduce((a, b) => a + b, 0) / dataPoints.length : 0;
    const statusColor = getStatusColor(current, metric);
    const isIncreasing = current > previous;
    const changePercent = previous !== 0 ? ((current - previous) / previous * 100) : 0;

    return (
      <Animated.View style={[styles.card, {
        transform: [{
          scale: valueAnims[metric].interpolate({
            inputRange: [0, 1],
            outputRange: [1, 1.02]
          })
        }]
      }]}>
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: getMetricColor(metric) + '20' }]}>
            <IconSymbol name={iconName} size={24} color={getMetricColor(metric)} />
          </View>
          <View style={styles.titleContainer}>
            <Text style={styles.cardTitle}>{title}</Text>
            <View style={styles.statusRow}>
              <Animated.View style={[styles.statusDot, { 
                backgroundColor: statusColor,
                transform: [{ scale: pulseAnim }]
              }]} />
              {Math.abs(changePercent) > 0.1 && (
                <View style={[styles.trendIndicator, { 
                  backgroundColor: isIncreasing ? '#4CAF50' : '#F44336' 
                }]}>
                  <Text style={styles.trendText}>
                    {isIncreasing ? '↗' : '↘'} {Math.abs(changePercent).toFixed(1)}%
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
        <Animated.View style={[styles.valueContainer, {
          transform: [{
            translateY: valueAnims[metric].interpolate({
              inputRange: [0, 1],
              outputRange: [0, -5]
            })
          }]
        }]}>
          <Text style={[styles.valueText, { color: getMetricColor(metric) }]}>
            {current.toFixed(1)}
            <Text style={styles.unitText}>{unit}</Text>
          </Text>
        </Animated.View>
        {dataPoints.length > 2 && (
          <View style={styles.chartContainer}>
            <LineChart
              data={chartData}
              width={screenWidth - 60}
              height={80}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              withVerticalLines={false}
              withHorizontalLines={false}
              withShadow={false}
              chartConfig={{
                backgroundGradientFrom: 'transparent',
                backgroundGradientTo: 'transparent',
                color: () => getMetricColor(metric),
                strokeWidth: 2.5,
                propsForBackgroundLines: { stroke: 'transparent' },
              }}
              bezier
              style={styles.chart}
            />
          </View>
        )}
        <View style={styles.statsContainer}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Min</Text>
            <Text style={styles.statValue}>{min.toFixed(1)}{unit}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>{avg.toFixed(1)}{unit}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max</Text>
            <Text style={styles.statValue}>{max.toFixed(1)}{unit}</Text>
          </View>
        </View>
      </Animated.View>
    );
  });

  const EmptyState: React.FC<{ icon: string; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconContainer}>
        <IconSymbol name={icon} size={64} color={themeColors.tint} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={themeColors.tint} />
          <Text style={styles.loadingText}>Loading sensor data...</Text>
        </View>
      );
    }

    if (devices.length === 0) {
      return <EmptyState icon="wifi-off" title="No Devices Connected" subtitle="Make sure your IoT devices are online and connected" />;
    }

    if (sensorData.length === 0) {
      return <EmptyState icon="database-off" title="No Data Available" subtitle="Waiting for sensor readings from selected device" />;
    }

    return (
      <>
        <MetricCard title="Temperature" unit="°C" metric="temperature" iconName="thermometer" />
        <MetricCard title="Humidity" unit="%" metric="humidity" iconName="water" />
        <MetricCard title="Distance" unit="cm" metric="distance" iconName="ruler" />
        <MetricCard title="Light Level" unit="lx" metric="lightLevel" iconName="lightbulb-on-outline" />
      </>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContentContainer}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={themeColors.tint} />}
      >
        <View style={styles.header}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>IoT Dashboard</Text>
            <Animated.View style={[styles.liveIndicator, {
              transform: [{ scale: pulseAnim }]
            }]}>
              <Animated.View style={[styles.liveDot, {
                backgroundColor: isLive ? '#4CAF50' : '#FF9800'
              }]} />
              <Text style={styles.liveText}>{isLive ? 'Live' : 'Reconnecting...'}</Text>
            </Animated.View>
          </View>
          {lastUpdate && (
            <Text style={styles.lastUpdate}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </Text>
          )}
          {/* {devices.length > 0 && (
          )} */}

          <View style={styles.deviceSelector}>
            <Text style={styles.selectorLabel}>Device</Text>
            <View style={styles.pickerContainer}>
              <IconSymbol name="devices" size={20} color={themeColors.tint} style={styles.pickerIcon} />
              <Picker
                selectedValue={selectedDevice}
                onValueChange={(itemValue) => setSelectedDevice(itemValue)}
                style={styles.picker}
                itemStyle={styles.pickerItem}
              >
                {devices.map((device) => (
                  <Picker.Item key={device.deviceId} label={device.deviceName || device.deviceId} value={device.deviceId} />
                ))}
              </Picker>
            </View>
          </View>
        </View>
        {renderContent()}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  scrollContentContainer: {
    padding: 16,
    paddingBottom: 100
  },
  header: {
    marginBottom: 24,
    paddingHorizontal: 4,
    paddingTop: 20
  },
  titleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4CAF50',
    marginRight: 6
  },
  liveText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text
  },
  lastUpdate: {
    fontSize: 12,
    color: colors.text,
    opacity: 0.6,
    textAlign: 'center',
    marginBottom: 16
  },
  deviceSelector: {
    marginTop: 8
  },
  selectorLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
    opacity: 0.8
  },
  pickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  pickerIcon: {
    marginRight: 12
  },
  picker: {
    flex: 1,
    height: 50,
    color: colors.text
  },
  pickerItem: {
    color: colors.text,
    fontSize: 16
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  trendIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    opacity: 0.8
  },
  trendText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff'
  },
  valueContainer: {
    alignItems: 'center',
    marginBottom: 16
  },
  valueText: {
    fontSize: 42,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -1
  },
  unitText: {
    fontSize: 24,
    fontWeight: '600',
    opacity: 0.7
  },
  chartContainer: {
    alignItems: 'center',
    marginBottom: 16,
    overflow: 'hidden',
    borderRadius: 12
  },
  chart: {
    borderRadius: 12
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border + '40'
  },
  statItem: {
    alignItems: 'center'
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    opacity: 0.6,
    marginBottom: 4
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.text,
    opacity: 0.7
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.text,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 20
  }
});

export default SensorDataPage;