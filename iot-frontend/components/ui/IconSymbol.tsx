import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleProp, TextStyle } from 'react-native';

type IconName =
  | 'camera' | 'camera.fill'
  | 'chart.bar.xaxis' | 'chart.bar'
  | 'cpu.fill' | 'cpu'
  | 'play.rectangle.on.rectangle.fill' | 'play.rectangle.on.rectangle'
  | 'video.fill' | 'video'
  | 'lan-connect' | 'lan-disconnect'
  | 'alert-circle-outline'
  | 'refresh'
  | 'wifi-off'
  | string; // Allow any string as fallback

const sfSymbolToIoniconsMap: Record<string, string> = {
  'camera.fill': 'camera',
  'camera': 'camera-outline',
  'chart.bar.xaxis': 'bar-chart',
  'chart.bar': 'bar-chart-outline',
  'cpu.fill': 'hardware-chip',
  'cpu': 'hardware-chip-outline',
  'play.rectangle.on.rectangle.fill': 'play-circle',
  'play.rectangle.on.rectangle': 'play-circle-outline',
  'video.fill': 'videocam',
  'video': 'videocam-outline',
  'lan-connect': 'wifi',
  'lan-disconnect': 'wifi-off-outline',
  'alert-circle-outline': 'alert-circle-outline',
  'refresh': 'refresh-outline',
  'wifi-off': 'wifi-off'
};

type Props = {
  name: IconName;
  size: number;
  color: string;
  style?: StyleProp<TextStyle>;
};

export const IconSymbol: React.FC<Props> = ({ name, size, color, style }) => {
  const iconName = sfSymbolToIoniconsMap[name] || 'help-circle-outline';
  return <Ionicons name={iconName as any} size={size} color={color} style={style} />;
};
