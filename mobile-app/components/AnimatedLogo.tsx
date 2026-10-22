import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, {
  FadeInUp,
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';

/**
 * The SafeLife animated logo — gradient-ring guardian orb with sonar
 * pulse rings, a spring entrance, and a staggered wordmark. Used as
 * the app-open intro (root layout) so launching the app feels alive
 * instead of dropping the user on a default static splash.
 */
export default function AnimatedLogo({
  size = 118,
  withWordmark = true,
}: {
  size?: number;
  withWordmark?: boolean;
}) {
  const ringA = useSharedValue(0);
  const ringB = useSharedValue(0);

  useEffect(() => {
    const start = (sv: typeof ringA, delay: number) => {
      sv.value = withDelay(
        delay,
        withRepeat(
          withTiming(1, { duration: 2300, easing: Easing.out(Easing.ease) }),
          -1,
          false
        )
      );
    };
    start(ringA, 250);
    start(ringB, 1400);
  }, [ringA, ringB]);

  const ringStyleA = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ringA.value * 0.6 }],
    opacity: 0.5 * (1 - ringA.value),
  }));
  const ringStyleB = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + ringB.value * 0.6 }],
    opacity: 0.5 * (1 - ringB.value),
  }));

  const ringBase = {
    width: size,
    height: size,
    borderRadius: size / 2,
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.stage, { width: size * 1.75, height: size * 1.75 }]}>
        <Reanimated.View style={[styles.sonar, ringBase, ringStyleA]} />
        <Reanimated.View style={[styles.sonar, ringBase, ringStyleB]} />
        <Reanimated.View entering={ZoomIn.springify().damping(13).stiffness(160)}>
          <LinearGradient
            colors={Theme.gradients.primary}
            style={[styles.orb, ringBase]}
          >
            <View style={[styles.orbInner, { borderRadius: size / 2 - 4 }]}>
              <MaterialCommunityIcons
                name="shield-check"
                size={size * 0.54}
                color={Theme.colors.primary}
              />
            </View>
          </LinearGradient>
        </Reanimated.View>
      </View>
      {withWordmark && (
        <>
          <Reanimated.Text
            entering={FadeInUp.delay(220).duration(480)}
            style={styles.wordmark}
          >
            SafeLife
          </Reanimated.Text>
          <Reanimated.Text
            entering={FadeInUp.delay(380).duration(480)}
            style={styles.tagline}
          >
            GUARDIAN NETWORK
          </Reanimated.Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  sonar: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: Theme.colors.primary,
  },
  orb: {
    padding: 3,
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  orbInner: {
    flex: 1,
    backgroundColor: 'rgba(8, 20, 38, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    marginTop: 6,
    fontFamily: Theme.fonts.headline,
    fontSize: 34,
    letterSpacing: 0.5,
    color: Theme.colors.onSurface,
  },
  tagline: {
    marginTop: 6,
    fontFamily: Theme.fonts.label,
    fontSize: 11,
    letterSpacing: 4,
    color: Theme.colors.primary,
  },
});
