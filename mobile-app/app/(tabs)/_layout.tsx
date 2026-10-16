import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '@/constants/theme';

/**
 * Floating glass tab bar — the 2026 premium pattern:
 * detached pill, hairline border, cyan glow, active icon in a tinted orb.
 */
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Theme.colors.primary,
        tabBarInactiveTintColor: Theme.colors.onSurfaceVariant,
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: styles.label,
        tabBarIconStyle: styles.icon,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'GUARDIAN',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconOrb, focused && styles.iconOrbActive]}>
              <MaterialCommunityIcons
                name={focused ? 'shield-check' : 'shield-check-outline'}
                size={23}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }) => (
            <View style={[styles.iconOrb, focused && styles.iconOrbActive]}>
              <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} />
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 26,
    height: 78,
    borderRadius: 26,
    backgroundColor: 'rgba(20, 20, 38, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderTopWidth: 1,
    elevation: 14,
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    paddingTop: 8,
  },
  label: {
    fontFamily: Theme.fonts.label,
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  icon: { marginTop: 6 },
  iconOrb: {
    width: 44,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOrbActive: {
    backgroundColor: 'rgba(0, 227, 253, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.25)',
  },
});
