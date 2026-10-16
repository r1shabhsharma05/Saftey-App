import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Theme } from '../../constants/theme';

interface Props {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}

/** Consistent section header: icon in a tinted box + title + optional right slot. */
export default function SectionHeader({ icon, title, right }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.iconBox}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontFamily: Theme.fonts.headline,
    fontSize: 16,
    color: Theme.colors.onSurface,
    letterSpacing: 0.3,
  },
  right: {},
});
