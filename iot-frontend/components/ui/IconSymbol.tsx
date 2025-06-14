// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type IconMapping = Record<string, ComponentProps<typeof MaterialIcons>['name']>;
type IconSymbolName = string;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  'house.fill': 'home',
  'paperplane.fill': 'send',
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'symbol': 'code',
  'function': 'functions',
  'video': 'videocam',
  'image': 'image',
  'loading': 'autorenew',
  'solid': 'crop-square',
  'filter': 'filter',
  'contain': 'fullscreen-exit',
  'text': 'text-fields',
  'cancel': 'cancel',
  'repeat': 'repeat',
  'anchor': 'anchor',
  'link': 'link',
  'at': 'alternate-email',
  'sort': 'sort',
  'map': 'map',
  'details': 'details',
  'head': 'headset',
  'lan-connect': 'lan',
  'lan-disconnect': 'lan-disconnected',
  'alert-circle-outline': 'error-outline',
  'refresh': 'refresh',
  'antenna': 'antenna',
  'information-circle-outline': 'info-outline',
  'videocam-off-outline': 'videocam-off',
  'refresh-outline': 'refresh',
  'sync-outline': 'sync',
  'film-outline': 'movie',
  'images-outline': 'collections',
  'blank': 'crop-free'
} as any as IconMapping;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
