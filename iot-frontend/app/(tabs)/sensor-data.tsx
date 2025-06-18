import React, { useState, useEffect } from 'react';
import { View, ScrollView, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { LineChart } from 'react-native-chart-kit';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { getSensorData, getDevices } from '@/services/api';
import { Dimensions } from 'react-native';
import { CONFIG } from '@/app/config';
import { Picker } from '@react-native-picker/picker';

// Define sensor data type
interface SensorDataItem {
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
}

// WebSocket message type
interface SensorUpdateMessage {
  deviceId: string;
  timestamp: number;
  temperature: number;
  humidity: number;
  distance: number;
  lightLevel: number;
}

// Add device type
interface DeviceItem {
  deviceId: string;
  deviceName: string;
  deviceType: string;
}

interface ApiResponse {
  data: SensorDataItem[] | { data: SensorDataItem[] };
}

const SensorDataPage = () => {
  const [sensorData, setSensorData] = useState<SensorDataItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('1h');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');

  // Fetch device list on mount
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

  // Fetch and update sensor data periodically
  useEffect(() => {
    if (!selectedDevice) return;
    
    let isMounted = true;
    const fetchInterval = setInterval(async () => {
      try {
        const response = await getSensorData(selectedDevice);
        if (isMounted) {
          // Handle API response structure
          const data = Array.isArray(response.data) ?
            response.data :
            (Array.isArray((response.data as any)?.data) ?
              (response.data as any).data : []);
          setSensorData(data);
        }
      } catch (error) {
        console.error('Error fetching sensor data:', error);
      }
    }, 1000); // Update every second
    
    // Initial fetch
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await getSensorData(selectedDevice);
        if (isMounted) {
          // Handle API response structure
          const data = Array.isArray(response.data) ?
            response.data :
            (Array.isArray((response.data as any)?.data) ?
              (response.data as any).data : []);
          setSensorData(data);
        }
      } catch (error) {
        console.error('Error fetching sensor data:', error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    fetchData();
    
    return () => {
      isMounted = false;
      clearInterval(fetchInterval);
    };
  }, [selectedDevice, timeRange]);

  // Set up WebSocket for real-time updates
  useEffect(() => {
    const ws = new WebSocket(`${CONFIG.WS_URL}sensor-updates`);
    
    ws.onopen = () => {
      console.log('WebSocket connected for sensor updates');
    };
    
    ws.onmessage = (event) => {
      try {
        const message: SensorUpdateMessage = JSON.parse(event.data);
        if (message.deviceId === selectedDevice) {
          const { deviceId, ...sensorData } = message;
          setSensorData(prev => [...prev, sensorData]);
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
    
    return () => {
      ws.close();
    };
  }, [selectedDevice]);

  // Prepare chart data
  const prepareChartData = (metric: keyof SensorDataItem) => {
    if (sensorData.length === 0) {
      return {
        labels: [],
        datasets: [{ data: [] }]
      };
    }
    
    const dataPoints = sensorData.slice(-20).map(item => item[metric]);
    const labels = sensorData.slice(-20).map(item => 
      new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
    
    return {
      labels,
      datasets: [{
        data: dataPoints,
        color: (opacity = 1) => {
          switch(metric) {
            case 'temperature': return `rgba(255, 99, 132, ${opacity})`;
            case 'humidity': return `rgba(54, 162, 235, ${opacity})`;
            case 'distance': return `rgba(75, 192, 192, ${opacity})`;
            case 'lightLevel': return `rgba(255, 206, 86, ${opacity})`;
            default: return `rgba(0, 0, 0, ${opacity})`;
          }
        },
        strokeWidth: 2
      }]
    };
  };

  // Calculate min/max/current values
  const getMetricStats = (metric: keyof SensorDataItem) => {
    if (sensorData.length === 0) return { current: 0, min: 0, max: 0 };
    
    const values = sensorData.map(item => item[metric]);
    return {
      current: values[values.length - 1],
      min: Math.min(...values),
      max: Math.max(...values)
    };
  };

  // Metric card component
  const MetricCard = ({ 
    title, 
    value, 
    unit, 
    chartData,
    min,
    max
  }: {
    title: string;
    value: number;
    unit: string;
    chartData: any;
    min: number;
    max: number;
  }) => (
    <ThemedView style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText type="subtitle">{title}</ThemedText>
        <ThemedText style={styles.valueText}>{value.toFixed(1)}{unit}</ThemedText>
      </View>
      
      {chartData.labels.length > 0 ? (
        <LineChart
          data={chartData}
          width={Dimensions.get('window').width - 60}
          height={100}
          withVerticalLines={false}
          withHorizontalLines={false}
          withDots={false}
          withShadow={false}
          chartConfig={{
            backgroundGradientFrom: '#fff',
            backgroundGradientTo: '#fff',
            decimalPlaces: 0,
            color: () => chartData.datasets[0].color(1),
            labelColor: () => '#666',
            propsForLabels: {
              fontSize: 10
            }
          }}
          bezier
          style={styles.chart}
        />
      ) : (
        <View style={styles.noDataContainer}>
          <Text style={styles.noDataText}>No data available</Text>
        </View>
      )}
      
      <View style={styles.statsRow}>
        <Text style={styles.statText}>Min: {min.toFixed(1)}{unit}</Text>
        <Text style={styles.statText}>Max: {max.toFixed(1)}{unit}</Text>
      </View>
    </ThemedView>
  );

  if (loading) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <ThemedText style={styles.loadingText}>Loading sensor data...</ThemedText>
      </ThemedView>
    );
  }

  if (sensorData.length === 0) {
    return (
      <ThemedView style={styles.emptyContainer}>
        <ThemedText>No sensor data available</ThemedText>
      </ThemedView>
    );
  }

  const tempStats = getMetricStats('temperature');
  const humidityStats = getMetricStats('humidity');
  const distanceStats = getMetricStats('distance');
  const lightStats = getMetricStats('lightLevel');

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Sensor Dashboard</ThemedText>
        <View style={styles.controls}>
          {/* Device selector */}
          <Picker
            selectedValue={selectedDevice}
            style={{ height: 40, width: 220, color: '#333', backgroundColor: '#fff', borderRadius: 8 }}
            onValueChange={(itemValue) => setSelectedDevice(itemValue)}
          >
            {devices.map((device) => (
              <Picker.Item key={device.deviceId} label={device.deviceName || device.deviceId} value={device.deviceId} />
            ))}
          </Picker>
        </View>
      </View>
      
      <MetricCard 
        title="Temperature" 
        value={tempStats.current} 
        unit="°C" 
        chartData={prepareChartData('temperature')}
        min={tempStats.min}
        max={tempStats.max}
      />
      
      <MetricCard 
        title="Humidity" 
        value={humidityStats.current} 
        unit="%" 
        chartData={prepareChartData('humidity')}
        min={humidityStats.min}
        max={humidityStats.max}
      />
      
      <MetricCard 
        title="Distance" 
        value={distanceStats.current} 
        unit="cm" 
        chartData={prepareChartData('distance')}
        min={distanceStats.min}
        max={distanceStats.max}
      />
      
      <MetricCard 
        title="Light Level" 
        value={lightStats.current} 
        unit="" 
        chartData={prepareChartData('lightLevel')}
        min={lightStats.min}
        max={lightStats.max}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 15,
    color: '#666',
  },
  card: {
    borderRadius: 16,
    padding: 30,
    backgroundColor: '#f5f5f5',
    marginBottom: 20,
    // Removed duplicate backgroundColor
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  valueText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  chart: {
    borderRadius: 12,
    marginVertical: 15,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  statText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    // Removed duplicate backgroundColor
    padding: 30,
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 10,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noDataContainer: {
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noDataText: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: 14,
  },
});

export default SensorDataPage;