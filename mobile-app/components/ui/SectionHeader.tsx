import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Theme } from '../../constants/theme';

interface Props {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}

/**
 * Plain section title (HIG lists-and-tables.md): no tinted icon box,
 * no tracked caps. An icon, when given, renders plain at 18px.
 */
export default function SectionHeader({ icon, title, right }: Props) {
  return (
    <View style={styles.row}>
      {icon}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: {
    flex: 1,
    ...Theme.type.title3,
    color: Theme.colors.onSurface,
  },
  right: {},
});
