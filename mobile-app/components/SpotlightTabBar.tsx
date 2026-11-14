// Floating tab bar — the @coding.stella "Floating Spotlight Tab Menu"
// ported to React Native, Apple-ified: Liquid Glass material (BlurView,
// tint follows the device scheme), sentence-case single-word labels,
// filled icons when focused. The laser scan (1.15s on every tap) and
// the spotlight beam are removed: a tab switch is a 100+/day action
// and gets no animation (animate-expo frequency gate, HIG motion.md).
// Press feedback is a 0.97 scale in 100ms; the selected tab is shown
// by tint alone (HIG tab-bars.md).
import React from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Theme } from '@/constants/theme';

interface Sizes {
  barH: number;
  padH: number;
}

const sizesFor = (compact: boolean): Sizes =>
  compact ? { barH: 58, padH: 10 } : { barH: 66, padH: 16 };

interface TabProps {
  focused: boolean;
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel?: string;
}

function SpotlightTab({ focused, label, icon, onPress, onLongPress, accessibilityLabel }: TabProps) {
  const pressScale = useSharedValue(1);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressScale.value = withTiming(0.97, { duration: 100 });
      }}
      onPressOut={() => {
        pressScale.value = withTiming(1, { duration: 100 });
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
    >
      <Reanimated.View style={[styles.content, pressStyle]}>
        {icon}
        <Text
          style={[
            styles.label,
            { color: focused ? Theme.colors.primaryText : Theme.colors.onSurfaceVariant },
          ]}
        >
          {label}
        </Text>
      </Reanimated.View>
    </Pressable>
  );
}

export default function SpotlightTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const scheme = useColorScheme();
  const sizes = sizesFor(width <= 480);

  return (
    <View
      style={[
        styles.bar,
        {
          height: sizes.barH,
          paddingHorizontal: sizes.padH,
          backgroundColor:
            scheme === 'light' ? 'rgba(255,255,255,0.72)' : 'rgba(28,28,30,0.72)',
        },
      ]}
    >
      <BlurView intensity={50} tint={scheme === 'light' ? 'light' : 'dark'} style={styles.blur}>
        {state.routes.map((route) => {
          const descriptor = descriptors[route.key];
          const focused = state.routes[state.index]?.key === route.key;
          const label = descriptor.options.title ?? route.name;
          const color = focused ? Theme.colors.primaryText : Theme.colors.onSurfaceVariant;
          const icon = descriptor.options.tabBarIcon?.({ focused, color, size: 22 });
          return (
            <SpotlightTab
              key={route.key}
              focused={focused}
              label={label}
              icon={icon}
              accessibilityLabel={descriptor.options.tabBarAccessibilityLabel}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (focused) return;
                if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
            />
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 26,
    borderRadius: 9999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Theme.colors.outlineVariant,
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  blur: { flex: 1, flexDirection: 'row' },
  button: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    ...Theme.type.caption2,
    fontWeight: '600',
  },
});
