import React, { useState, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  Dimensions,
  SafeAreaView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { Picker } from '@react-native-picker/picker';
import { useTheme } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { getSensorData, getDevices } from '../../services/api';
import { CONFIG } from '../../config';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Colors } from '../../constants/Colors';

// Interface definitions (keep these as they are)
interface SensorDataItem {
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
}
interface SensorUpdateMessage extends SensorDataItem {
  deviceId: string;
}
interface DeviceItem {
  deviceId: string;
  deviceName: string;
  deviceType: string;
}

// Chart color config fallback
const defaultChartColors = {
  temp: '#FF6384',
  humidity: '#36A2EB',
  distance: '#FFCE56',
  light: '#4BC0C0',
};

type ChartColorsType = typeof defaultChartColors;

type MetricKey = keyof Pick<SensorDataItem, 'temperature' | 'humidity' | 'distance' | 'lightLevel'>;

type MetricCardProps = {
  title: string;
  unit: string;
  metric: MetricKey;
};

const SensorDataPage: React.FC = () => {
  const [sensorData, setSensorData] = useState<SensorDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  const theme = useTheme();
  const colorScheme = useColorScheme();
  // Use chart colors from Colors if available, else fallback
  const chartColors: ChartColorsType = (Colors[colorScheme ?? 'light'] as any).chart || defaultChartColors;
  const styles = useMemo(() => createStyles(theme.colors, colorScheme), [theme, colorScheme]);

  // --- Data Fetching and WebSocket Logic ---

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const response = await getDevices();
        const deviceList = response.data?.devices || [];
        setDevices(deviceList);
        if (deviceList.length > 0 && !selectedDevice) {
          setSelectedDevice(deviceList[0].deviceId);
        }
      } catch (error) {
        console.error('Error fetching devices:', error);
      }
    };
    fetchDevices();
  }, []);

  useEffect(() => {
    if (!selectedDevice) return;
    let isMounted = true;

    const fetchData = async () => {
      if (!isMounted) return;
      setLoading(true);
      try {
        const response = await getSensorData(selectedDevice);
        if (isMounted) {
          const data = Array.isArray(response.data) ? response.data : (response.data as any)?.data || [];
          // Sort data by timestamp and keep the last 50 points
          const sortedData = data.sort((a: SensorDataItem, b: SensorDataItem) => a.timestamp - b.timestamp).slice(-50);
          setSensorData(sortedData);
        }
      } catch (error) {
        console.error('Error fetching initial sensor data:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    // Setup WebSocket for real-time updates, removing the old setInterval
    const ws = new WebSocket(`${CONFIG.WS_URL}sensor-updates`);
    ws.onmessage = (event) => {
      try {
        const message: SensorUpdateMessage = JSON.parse(event.data);
        if (message.deviceId === selectedDevice && isMounted) {
          setSensorData(prev => [...prev.slice(-49), message]); // Efficiently keep array size at 50
        }
      } catch (e) {
        console.error('Error processing WebSocket message:', e);
      }
    };

    return () => {
      isMounted = false;
      ws.close();
    };
  }, [selectedDevice]);

  // --- Chart and UI Helper Functions ---

  const prepareChartData = (metric: MetricKey) => {
    if (sensorData.length === 0) return { labels: [], datasets: [{ data: [0] }] };
    
    return {
      labels: [], // Hide labels on the chart for a cleaner look
      datasets: [{
        data: sensorData.map(item => item[metric]),
        color: (opacity = 1) => {
          switch(metric) {
            case 'temperature': return chartColors.temp;
            case 'humidity': return chartColors.humidity;
            case 'distance': return chartColors.distance;
            case 'lightLevel': return chartColors.light;
            default: return theme.colors.text;
          }
        },
        strokeWidth: 3,
      }],
    };
  };

  const getMetricStats = (metric: MetricKey) => {
    if (sensorData.length === 0) return { current: 0, min: 0, max: 0 };
    const values = sensorData.map(item => item[metric]);
    return {
      current: values[values.length - 1] || 0,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  };

  // --- Child Components ---

  const MetricCard: React.FC<MetricCardProps> = ({ title, unit, metric }) => {
    const stats = getMetricStats(metric);
    const chartData = prepareChartData(metric);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.valueText}>{stats.current.toFixed(1)}{unit}</Text>
        </View>
        <View style={styles.chartContainer}>
          {sensorData.length > 1 ? (
            <LineChart
              data={chartData}
              width={Dimensions.get('window').width - 40}
              height={120}
              withVerticalLines={false}
              withHorizontalLines={false}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              withShadow={true}
              chartConfig={{
                backgroundGradientFrom: theme.colors.card,
                backgroundGradientTo: theme.colors.card,
                color: (opacity = 1) => `rgba(134, 65, 244, ${opacity})`, // Dummy color, overridden in dataset
                propsForBackgroundLines: { stroke: 'transparent' },
              }}
              bezier
              style={styles.chart}
            />
          ) : (
            <View style={styles.noDataContainer}>
              <Text style={styles.noDataText}>Waiting for data...</Text>
            </View>
          )}
        </View>
        <View style={styles.statsRow}>
          <Text style={styles.statText}>Min: {stats.min.toFixed(1)}{unit}</Text>
          <Text style={styles.statText}>Max: {stats.max.toFixed(1)}{unit}</Text>
        </View>
      </View>
    );
  };
  
  // --- Render Logic ---

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading Sensor Data...</Text>
      </View>
    );
  }

  const selectedDeviceName = devices.find(d => d.deviceId === selectedDevice)?.deviceName || selectedDevice;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContentContainer}>
        <View style={styles.header}>
          <Text style={styles.title}>Sensor Dashboard</Text>
          <Text style={styles.subtitle}>Displaying data for</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedDevice}
              onValueChange={(itemValue: string) => setSelectedDevice(itemValue)}
              style={styles.picker}
              itemStyle={styles.pickerItem}
              dropdownIconColor={theme.colors.text}
            >
              {devices.map((device) => (
                <Picker.Item
                  key={device.deviceId}
                  label={device.deviceName || device.deviceId}
                  value={device.deviceId}
                />
              ))}
            </Picker>
            <Ionicons
              name="chevron-down"
              size={20}
              color={theme.colors.text}
              style={styles.pickerIcon}
            />
          </View>
        </View>

        {devices.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.loadingText}>No devices found.</Text>
          </View>
        ) : (
          <>
            <MetricCard title="Temperature" unit="°C" metric="temperature" />
            <MetricCard title="Humidity" unit="%" metric="humidity" />
            <MetricCard title="Distance" unit="cm" metric="distance" />
            <MetricCard title="Light Level" unit=" lx" metric="lightLevel" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: any, scheme: string) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scrollContentContainer: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 16, alignItems: 'stretch' },
  title: { fontSize: 32, fontWeight: 'bold', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 16, color: colors.text, textAlign: 'center', opacity: 0.7, marginBottom: 16, marginTop: 4 },
  
  pickerContainer: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    position: 'relative', // for icon positioning
  },
  picker: {
    width: '100%',
    height: 55,
    color: colors.text,
    // On Android, we hide the default picker text to show our custom label
    ...(Platform.OS === 'android' && { color: 'transparent', backgroundColor: 'transparent' }),
  },
  pickerItem: {
    color: colors.text, // For iOS dropdown items
    backgroundColor: colors.card,
  },
  pickerIcon: {
    position: 'absolute',
    right: 16,
    // The picker text will overlay this on iOS, which is fine.
    // On Android, this becomes the visible interactive element.
  },

  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: scheme === 'dark' ? 0.3 : 0.08,
    shadowRadius: 12,
    elevation: 5,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  valueText: { fontSize: 26, fontWeight: 'bold', color: colors.primary },
  
  chartContainer: { height: 120, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  chart: { marginLeft: -16 }, // Offset to make the chart fill the card width
  
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
  statText: { fontSize: 14, color: colors.text, opacity: 0.8 },
  
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
  loadingText: { color: colors.text, fontSize: 16, marginTop: 10 },
  
  noDataContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  noDataText: { color: colors.text, fontStyle: 'italic', opacity: 0.7 },
});

export default SensorDataPage;