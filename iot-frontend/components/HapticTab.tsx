import React from 'react';
import { Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

/**
 * A custom tab bar button that provides haptic feedback on press.
 * It correctly handles props from React Navigation by only using what is
 * necessary for the Pressable, avoiding type conflicts.
 */
export const HapticTab = (props: BottomTabBarButtonProps): React.ReactElement => {
  // We destructure only the props we need. `children` contains the icon and label.
  // This avoids passing down incompatible props (like 'ref') to the Pressable.
  const { children, style, onPress } = props;

  return (
    <Pressable
      style={style} // The style from the navigator is crucial for layout.
      onPress={(e) => {
        // Provide haptic feedback. This is a "fire-and-forget" async call.
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

        // Call the original onPress function from the navigator if it exists.
        onPress?.(e);
      }}
    >
      {children}
    </Pressable>
  );
};
