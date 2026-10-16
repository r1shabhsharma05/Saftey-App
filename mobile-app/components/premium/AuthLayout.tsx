import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
} from 'react-native';
import Animated, { FadeInUp, FadeIn } from 'react-native-reanimated';
import { Image } from 'expo-image';
import { Theme } from '../../constants/theme';
import ScreenBackground from './ScreenBackground';

interface Props {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footerText: string;
  footerLink: string;
  onFooterPress: () => void;
}

/**
 * Shared auth shell: ambient background, glowing brand mark,
 * staggered entrance, footer link. Used by login + register.
 */
export default function AuthLayout({
  title,
  subtitle,
  children,
  footerText,
  footerLink,
  onFooterPress,
}: Props) {
  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeIn.duration(500)} style={styles.header}>
            <View style={styles.logoGlow}>
              <Image
                source={require('../../assets/images/icon.png')}
                style={styles.logo}
                contentFit="contain"
              />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(120).springify()} style={styles.form}>
            {children}
          </Animated.View>

          <Animated.View entering={FadeInUp.delay(220).springify()} style={styles.footer}>
            <TouchableOpacity onPress={onFooterPress} activeOpacity={0.7}>
              <Text style={styles.footerText}>
                {footerText} <Text style={styles.footerLink}>{footerLink}</Text>
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: Theme.spacing.lg, paddingTop: 72, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  logoGlow: {
    width: 104,
    height: 104,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 227, 253, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.25)',
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.5,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    marginBottom: 20,
    overflow: 'hidden',
  },
  logo: { width: 104, height: 104 },
  title: {
    fontFamily: Theme.fonts.headline,
    fontSize: 30,
    color: Theme.colors.onSurface,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: Theme.fonts.body,
    fontSize: 14,
    color: Theme.colors.onSurfaceVariant,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  form: { gap: 18 },
  footer: { marginTop: 28, alignItems: 'center' },
  footerText: {
    fontFamily: Theme.fonts.label,
    color: Theme.colors.onSurfaceVariant,
    fontSize: 12,
    letterSpacing: 1,
  },
  footerLink: { color: Theme.colors.primary, fontWeight: '900' },
});
