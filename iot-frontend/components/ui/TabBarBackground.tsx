import React from 'react';
import { BlurView } from 'expo-blur';
import { StyleSheet } from 'react-native';
import { useTheme } from '@react-navigation/native';

const TabBarBackground: React.FC = () => {
  const theme = useTheme();
  
  return (
    <BlurView
      intensity={90}
      tint={theme.dark ? 'dark' : 'light'}
      style={styles.background}
    />
  );
};

const styles = StyleSheet.create({
  background: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default TabBarBackground;
