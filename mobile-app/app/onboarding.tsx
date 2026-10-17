import React from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import FloxlyBackground from '../components/floxly/FloxlyBackground';
import { Floxly } from '../constants/floxly';

const { width } = Dimensions.get('window');

/**
 * Onboarding — Floxly reference screen 1, adapted for SafeLife AI:
 * vivid blue gradient, glowing protection orb, headline, Skip + arrow CTA.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const goLogin = () => router.replace('/login');

  return (
    <FloxlyBackground>
      <View style={styles.root}>
        {/* Top-left brand */}
        <Animated.View entering={FadeIn.duration(500)} style={styles.brandRow}>
          <MaterialCommunityIcons name="shield-check" size={26} color="#fff" />
          <Text style={styles.brandText}>SafeLife AI</Text>
        </Animated.View>

        {/* Protection orb visual */}
        <Animated.View entering={FadeIn.duration(700)} style={styles.orbWrap}>
          <View style={styles.orbOuter}>
            <LinearGradient
              colors={['rgba(124, 196, 255, 0.55)', 'rgba(34, 211, 238, 0.08)']}
              style={styles.orb}
            >
              <View style={styles.orbInner}>
                <MaterialCommunityIcons
                  name="shield-check"
                  size={110}
                  color="#fff"
                />
              </View>
            </LinearGradient>
          </View>
          {/* Orbiting dots */}
          <View style={[styles.orbitDot, styles.orbit1]} />
          <View style={[styles.orbitDot, styles.orbit2]} />
          <View style={[styles.orbitDot, styles.orbit3]} />
        </Animated.View>

        {/* Copy */}
        <Animated.View entering={FadeInUp.delay(150).duration(500)} style={styles.copy}>
          <Text style={styles.kicker}>STAY PROTECTED</Text>
          <Text style={styles.headline}>
            Safety in{'\n'}<Text style={styles.headlineAccent}>Every</Text> Moment
          </Text>
          <View style={styles.metaRow}>
            <View style={styles.avatarStack}>
              <View style={[styles.miniAvatar, { backgroundColor: '#4a9eff' }]}>
                <Ionicons name="person" size={14} color="#fff" />
              </View>
              <View style={[styles.miniAvatar, { backgroundColor: '#22d3ee', marginLeft: -10 }]}>
                <Ionicons name="person" size={14} color="#fff" />
              </View>
              <View style={[styles.miniAvatar, { backgroundColor: '#7cc4ff', marginLeft: -10 }]}>
                <Ionicons name="person" size={14} color="#fff" />
              </View>
            </View>
            <Text style={styles.metaText}>24/7{'\n'}Guardian network</Text>
          </View>
        </Animated.View>

        {/* Bottom actions */}
        <Animated.View entering={FadeInUp.delay(300).duration(500)} style={styles.footer}>
          <Pressable onPress={goLogin} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
          <Pressable onPress={goLogin} style={({ pressed }) => [pressed && styles.pressed]}>
            <LinearGradient colors={Floxly.gradients.cta} style={styles.arrowBtn}>
              <Ionicons name="arrow-forward" size={26} color="#fff" />
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </View>
    </FloxlyBackground>
  );
}

const ORB = Math.min(width * 0.72, 300);

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 28, paddingTop: 64, paddingBottom: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandText: {
    color: '#fff',
    fontFamily: Floxly.fonts.headline,
    fontSize: 22,
  },
  orbWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 36,
    height: ORB + 40,
  },
  orbOuter: {
    shadowColor: '#7cc4ff',
    shadowOpacity: 0.7,
    shadowRadius: 60,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbInner: {
    width: ORB * 0.62,
    height: ORB * 0.62,
    borderRadius: (ORB * 0.62) / 2,
    backgroundColor: 'rgba(10, 30, 70, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitDot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22d3ee',
    shadowColor: '#22d3ee',
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  orbit1: { top: 30, left: width * 0.16 },
  orbit2: { bottom: 52, right: width * 0.14, backgroundColor: '#fff' },
  orbit3: { top: '52%', left: width * 0.08, width: 8, height: 8, borderRadius: 4 },
  copy: { marginTop: 12 },
  kicker: {
    color: Floxly.colors.subtext,
    fontFamily: Floxly.fonts.label,
    fontSize: 12,
    letterSpacing: 3,
    marginBottom: 12,
  },
  headline: {
    color: '#fff',
    fontFamily: Floxly.fonts.headline,
    fontSize: 40,
    lineHeight: 46,
  },
  headlineAccent: { color: Floxly.colors.accent },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 22, gap: 14 },
  avatarStack: { flexDirection: 'row' },
  miniAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: {
    color: Floxly.colors.subtext,
    fontFamily: Floxly.fonts.body,
    fontSize: 13,
    lineHeight: 17,
  },
  footer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  skip: {
    color: Floxly.colors.subtext,
    fontFamily: Floxly.fonts.body,
    fontSize: 16,
    paddingBottom: 14,
  },
  arrowBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#22d3ee',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  pressed: { opacity: 0.8 },
});
