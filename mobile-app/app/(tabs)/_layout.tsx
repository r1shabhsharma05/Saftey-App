import { Tabs } from 'expo-router';
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/constants/theme';
import SpotlightTabBar from '@/components/SpotlightTabBar';

/**
 * Spotlight tab bar — the @coding.stella floating tab menu ported to
 * React Native (see components/SpotlightTabBar.tsx). Same 3 routes;
 * labels are sentence-case single words, icons are filled when focused
 * (HIG tab-bars.md). One icon set (Ionicons) for the whole dashboard.
 */
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <SpotlightTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: Theme.colors.primaryText,
        tabBarInactiveTintColor: Theme.colors.onSurfaceVariant,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Guardian',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'shield-checkmark' : 'shield-checkmark-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
