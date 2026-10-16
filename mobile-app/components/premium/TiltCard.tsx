import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, GestureResponderEvent } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Theme } from '../../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** max tilt in degrees at the card edge */
  maxTilt?: number;
  borderRadius?: number;
  /** touch-following specular highlight */
  glare?: boolean;
}

/**
 * 3D tilt card (Aceternity-style): the card physically tilts toward the
 * finger with spring physics, and a specular highlight follows the touch.
 * Pure reanimated — no gesture-handler needed, works on web too.
 */
export default function TiltCard({
  children,
  style,
  maxTilt = 9,
  borderRadius = Theme.roundness.lg,
  glare = true,
}: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const gx = useSharedValue(0.5);
  const gy = useSharedValue(0.5);
  const glareOpacity = useSharedValue(0);

  const spring = useMemo(() => ({ damping: 16, stiffness: 220 }), []);

  const onTouch = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX, locationY } = e.nativeEvent;
      if (!size.w || !size.h) return;
      const px = locationX / size.w - 0.5;
      const py = locationY / size.h - 0.5;
      rx.value = withSpring(-py * maxTilt * 2, spring);
      ry.value = withSpring(px * maxTilt * 2, spring);
      gx.value = locationX / size.w;
      gy.value = locationY / size.h;
      glareOpacity.value = withTiming(0.55, { duration: 140 });
    },
    [size, maxTilt, rx, ry, gx, gy, glareOpacity, spring]
  );

  const reset = useCallback(() => {
    rx.value = withSpring(0, spring);
    ry.value = withSpring(0, spring);
    glareOpacity.value = withTiming(0, { duration: 320 });
  }, [rx, ry, glareOpacity, spring]);

  const tiltStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateX: `${rx.value}deg` },
      { rotateY: `${ry.value}deg` },
    ],
  }));

  const glareStyle = useAnimatedStyle(() => ({
    opacity: glareOpacity.value,
    transform: [
      { translateX: gx.value * size.w - 80 },
      { translateY: gy.value * size.h - 80 },
    ],
  }));

  return (
    <Animated.View
      onTouchStart={onTouch}
      onTouchMove={onTouch}
      onTouchEnd={reset}
      onTouchCancel={reset}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize({ w: width, h: height });
      }}
      style={[style, tiltStyle]}
    >
      <View style={[styles.clip, { borderRadius }]}>
        {children}
        {glare && (
          <Animated.View pointerEvents="none" style={[styles.glare, glareStyle]}>
            <LinearGradient
              colors={['rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
              style={styles.glareGrad}
            />
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden', flex: 1 },
  glare: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 160,
    height: 160,
    borderRadius: 80,
  },
  glareGrad: { flex: 1, borderRadius: 80 },
});
