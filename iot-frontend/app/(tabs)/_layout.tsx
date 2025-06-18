import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useTheme } from '@react-navigation/native';
import { Colors } from '@/constants/Colors';
import { HapticTab } from '@/components/HapticTab';
import TabBarBackground from '@/components/ui/TabBarBackground';
import { useColorScheme } from '@/hooks/useColorScheme';
import { IconSymbol } from '@/components/ui/IconSymbol';

// import { HapticTab } from '../components/HapticTab';
// import { IconSymbol } from '../components/ui/IconSymbol';
// import TabBarBackground from '../components/ui/TabBarBackground';
// import { useColorScheme } from '../hooks/useColorScheme';
// import { Colors } from '../constants/Colors';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        tabBarInactiveTintColor: Colors[colorScheme ?? 'light'].tabIconDefault,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: () => <TabBarBackground />,
        tabBarStyle: {
          backgroundColor: colorScheme === 'dark' ? Colors.dark.card : Colors.light.card,
          borderTopColor: colorScheme === 'dark' ? Colors.dark.border : Colors.light.border,
          position: 'absolute',
          elevation: 0,
          shadowOpacity: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Live',
          tabBarIcon: ({ color, focused }) => <IconSymbol size={28} name={focused ? 'camera.fill' : 'camera'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="sensor-data"
        options={{
          title: 'Sensors',
          tabBarIcon: ({ color, focused }) => <IconSymbol size={28} name={focused ? 'chart.bar.xaxis' : 'chart.bar'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="devices"
        options={{
          title: 'Devices',
          tabBarIcon: ({ color, focused }) => <IconSymbol size={28} name={focused ? 'cpu.fill' : 'cpu'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, focused }) => <IconSymbol size={28} name={focused ? 'play.rectangle.on.rectangle.fill' : 'play.rectangle.on.rectangle'} color={color} />,
        }}
      />
    </Tabs>
  );
}
