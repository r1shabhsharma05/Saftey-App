import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '@/constants/theme';
import SpotlightTabBar from '@/components/SpotlightTabBar';

/**
 * Spotlight tab bar — the @coding.stella "Floating Spotlight Tab Menu
 * with Laser Scanner" ported to React Native (see
 * components/SpotlightTabBar.tsx for the tokens). Same 3 routes,
 * labels and icons as before; the cyan orb is gone, replaced by the
 * indicator bar + beam + laser scan on the active tab.
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <SpotlightTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: '#ffffff',
        tabBarInactiveTintColor: '#55596b',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'GUARDIAN',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name={focused ? 'shield-check' : 'shield-check-outline'}
              size={22}
              color={color}
              style={focused ? styles.iconGlow : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'CONTACTS',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={22}
              color={color}
              style={focused ? styles.iconGlow : undefined}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={22}
              color={color}
              style={focused ? styles.iconGlow : undefined}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  // The web's drop-shadow(0 0 5px rgba(255,255,255,0.3)) on the
  // active icon. Ionicons renders Text, so a text shadow is the glow.
  iconGlow: {
    textShadowColor: 'rgba(255, 255, 255, 0.3)',
    textShadowRadius: 5,
    textShadowOffset: { width: 0, height: 0 },
  },
});
