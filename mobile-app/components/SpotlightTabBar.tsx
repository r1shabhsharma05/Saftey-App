// Floating Spotlight Tab Menu with Laser Scanner — port of the
// @coding.stella web component ("Naviagtion Tab Menu Vol 1") to React
// Native. Tokens are exact from the source (style.css): pill bg
// #121319, border #1e202a, radius full, height 66 (58 under 480px),
// inactive icon #55596b, active white. The active tab gets the top
// indicator bar (36x4, glow), the trapezoid spotlight beam (white
// 16%, blurred, fading downward, scales open from the top), the laser
// scan line (46x2, top→bottom once per activation, 1.15s), the icon
// lift (-2px) and the press scale (0.94). The scan re-runs on every
// tap, including re-tapping the active tab (web script parity).
//
// Mapped onto SafeLife's 3 existing tabs only (GUARDIAN / CONTACTS /
// PROFILE) — the demo's heart/plus/bell tabs have no screens here and
// are not added. Labels are kept (the web demo is icon-only, but the
// app's tabs carry labels). The icon "thicker stroke" is the filled
// glyph variant (Ionicons has no stroke-width prop); the glow is a
// text shadow, the web's drop-shadow equivalent.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Defs, FeGaussianBlur, Filter, LinearGradient, Polygon, Stop, Svg } from 'react-native-svg';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Theme } from '@/constants/theme';

const NAV_BG = '#121319';
const NAV_BORDER = '#1e202a';
const ICON_INACTIVE = '#55596b';
const ICON_ACTIVE = '#ffffff';
const EASE = Easing.bezier(0.16, 1, 0.3, 1);
const SCAN_DURATION = 1150;

interface Sizes {
  barH: number;
  padH: number;
  indicatorW: number;
  beamW: number;
  beamH: number;
  scanW: number;
}

const sizesFor = (compact: boolean): Sizes =>
  compact
    ? { barH: 58, padH: 10, indicatorW: 30, beamW: 56, beamH: 53, scanW: 40 }
    : { barH: 66, padH: 16, indicatorW: 36, beamW: 66, beamH: 60, scanW: 46 };

// Trapezoid beam: narrow top, wide bottom (the web's clip-path
// polygon(26% 0, 74% 0, 96% 100%, 4% 100%)). The gradient is the
// web's downward mask (opaque to 20%, transparent at the bottom);
// the filter is its 4px blur.
function Beam({ w, h }: { w: number; h: number }) {
  const points = `${w * 0.26},0 ${w * 0.74},0 ${w * 0.96},${h} ${w * 0.04},${h}`;
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id="beamFade" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <Stop offset="0.2" stopColor="#ffffff" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </LinearGradient>
        <Filter id="beamBlur">
          <FeGaussianBlur stdDeviation="4" />
        </Filter>
      </Defs>
      <Polygon points={points} fill="url(#beamFade)" filter="url(#beamBlur)" />
    </Svg>
  );
}

interface TabProps {
  focused: boolean;
  label: string;
  icon: React.ReactNode;
  scanNonce: number;
  sizes: Sizes;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel?: string;
}

function SpotlightTab({
  focused,
  label,
  icon,
  scanNonce,
  sizes,
  onPress,
  onLongPress,
  accessibilityLabel,
}: TabProps) {
  const { barH, indicatorW, beamW, beamH, scanW } = sizes;
  const pressScale = useSharedValue(1);
  const indOpacity = useSharedValue(focused ? 1 : 0);
  const indY = useSharedValue(focused ? 0 : -6);
  const beamOpacity = useSharedValue(focused ? 0.95 : 0);
  const beamScaleY = useSharedValue(focused ? 1 : 0.1);
  const scanY = useSharedValue(0);
  const scanOpacity = useSharedValue(0);
  const scanScaleX = useSharedValue(0.4);
  const iconY = useSharedValue(focused ? -2 : 0);

  useEffect(() => {
    indOpacity.value = withTiming(focused ? 1 : 0, { duration: focused ? 400 : 350 });
    indY.value = withTiming(focused ? 0 : -6, { duration: focused ? 600 : 500, easing: EASE });
    beamOpacity.value = withTiming(focused ? 0.95 : 0, { duration: focused ? 500 : 350 });
    beamScaleY.value = withTiming(focused ? 1 : 0.1, { duration: focused ? 850 : 500, easing: EASE });
    iconY.value = withTiming(focused ? -2 : 0, { duration: 500, easing: EASE });
    if (!focused) {
      scanOpacity.value = 0;
      scanY.value = 0;
      scanScaleX.value = 0.4;
    }
  }, [focused]);

  // Laser scan: top 4px → bottom, 1.15s, once per activation. Keyframes
  // mirror the web's laserScanOnce (20% / 65% / 100%).
  useEffect(() => {
    if (!focused || scanNonce === 0) return;
    const travel = barH - 10;
    scanY.value = 0;
    scanOpacity.value = 0;
    scanScaleX.value = 0.4;
    scanY.value = withTiming(travel, { duration: SCAN_DURATION, easing: EASE });
    scanOpacity.value = withSequence(
      withTiming(0.95, { duration: 230 }),
      withTiming(0.8, { duration: 517 }),
      withTiming(0, { duration: 403 })
    );
    scanScaleX.value = withSequence(
      withTiming(0.85, { duration: 230 }),
      withTiming(1, { duration: 517 }),
      withTiming(0.5, { duration: 403 })
    );
  }, [scanNonce, focused]);

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indOpacity.value,
    transform: [{ translateY: indY.value }],
  }));
  const beamStyle = useAnimatedStyle(() => ({
    opacity: beamOpacity.value,
    // Scale about the top edge (the beam opens downward from the bar).
    transform: [{ translateY: -beamH / 2 }, { scaleY: beamScaleY.value }, { translateY: beamH / 2 }],
  }));
  const scanStyle = useAnimatedStyle(() => ({
    opacity: scanOpacity.value,
    transform: [{ translateY: scanY.value }, { scaleX: scanScaleX.value }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: iconY.value }],
  }));

  return (
    <Pressable
      style={styles.button}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        pressScale.value = withTiming(0.94, { duration: 220, easing: EASE });
      }}
      onPressOut={() => {
        pressScale.value = withTiming(1, { duration: 220, easing: EASE });
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
    >
      <Reanimated.View style={[styles.content, pressStyle]}>
        <View style={styles.lamp} pointerEvents="none">
          <Reanimated.View style={[styles.indicator, { width: indicatorW }, indicatorStyle]} />
          <Reanimated.View style={[styles.beam, beamStyle]}>
            <Beam w={beamW} h={beamH} />
          </Reanimated.View>
          <Reanimated.View style={[styles.scan, { width: scanW, marginLeft: -scanW / 2 }, scanStyle]} />
        </View>
        <Reanimated.View style={iconStyle}>{icon}</Reanimated.View>
        <Text style={[styles.label, { color: focused ? ICON_ACTIVE : ICON_INACTIVE }]}>{label}</Text>
      </Reanimated.View>
    </Pressable>
  );
}

export default function SpotlightTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { width } = useWindowDimensions();
  const sizes = sizesFor(width <= 480);
  // Scan trigger per route. Starts empty: the mount effect below fires
  // the initial tab's scan once (the web activates its initial tab on load).
  const [scanNonce, setScanNonce] = useState<Record<string, number>>({});

  useEffect(() => {
    const route = state.routes[state.index];
    if (route) setScanNonce((prev) => ({ ...prev, [route.key]: (prev[route.key] ?? 0) + 1 }));
  }, [state.index]);

  return (
    <View style={[styles.bar, { height: sizes.barH, paddingHorizontal: sizes.padH }]}>
      {state.routes.map((route) => {
        const descriptor = descriptors[route.key];
        const focused = state.routes[state.index]?.key === route.key;
        const label = descriptor.options.title ?? route.name;
        const color = focused ? ICON_ACTIVE : ICON_INACTIVE;
        const icon = descriptor.options.tabBarIcon?.({ focused, color, size: 22 });
        return (
          <SpotlightTab
            key={route.key}
            focused={focused}
            label={label}
            icon={icon}
            scanNonce={scanNonce[route.key] ?? 0}
            sizes={sizes}
            accessibilityLabel={descriptor.options.tabBarAccessibilityLabel}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (focused) {
                // Re-tapping the active tab re-runs the laser scan.
                setScanNonce((prev) => ({ ...prev, [route.key]: (prev[route.key] ?? 0) + 1 }));
                return;
              }
              if (!event.defaultPrevented) navigation.navigate(route.name, route.params);
            }}
            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 26,
    flexDirection: 'row',
    backgroundColor: NAV_BG,
    borderWidth: 1,
    borderColor: NAV_BORDER,
    borderRadius: 9999,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.8,
    shadowRadius: 50,
    shadowOffset: { width: 0, height: 24 },
    elevation: 14,
  },
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
  lamp: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    height: 4,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: ICON_ACTIVE,
    shadowColor: ICON_ACTIVE,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  beam: {
    position: 'absolute',
    top: 4,
    alignSelf: 'center',
  },
  scan: {
    position: 'absolute',
    top: 4,
    left: '50%',
    height: 2,
    borderRadius: 999,
    backgroundColor: ICON_ACTIVE,
    shadowColor: ICON_ACTIVE,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  label: {
    fontFamily: Theme.fonts.label,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
});
