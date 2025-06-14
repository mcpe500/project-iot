import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleProp, TextStyle } from 'react-native'; // Changed ViewStyle to TextStyle

// Define a mapping for icon names if you want to abstract them
// For now, we'll assume the name passed is a valid MaterialCommunityIcons name
export type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface IconSymbolProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>; // Changed ViewStyle to TextStyle
}

const IconSymbol: React.FC<IconSymbolProps> = ({ name, size = 24, color = '#000', style }) => {
  return <MaterialCommunityIcons name={name} size={size} color={color} style={style} />;
};

export { IconSymbol }; // Use named export for consistency if preferred
// export default IconSymbol; // Or default export
