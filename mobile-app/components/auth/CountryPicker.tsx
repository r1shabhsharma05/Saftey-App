// Country picker for the auth forms — a tappable selected country
// that opens a short list. No new dependency: a plain option list.
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { COUNTRY_OPTIONS, type CountryOption } from '../../utils/phone';

interface CountryPickerProps {
  value: CountryOption;
  onChange: (country: CountryOption) => void;
}

export default function CountryPicker({ value, onChange }: CountryPickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.button} onPress={() => setOpen((o) => !o)} hitSlop={6}>
        <Text style={styles.label} numberOfLines={1}>
          {value.code} {value.dial}
        </Text>
        <Text style={styles.chevron}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.list}>
          {COUNTRY_OPTIONS.map((c) => (
            <Pressable
              key={`${c.code}-${c.dial}`}
              style={styles.option}
              onPress={() => {
                onChange(c);
                setOpen(false);
              }}
              hitSlop={4}
            >
              <Text style={[styles.optionText, c.code === value.code && c.dial === value.dial && styles.optionSelected]}>
                {c.name} ({c.dial})
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 104, zIndex: 10 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 18,
    paddingHorizontal: 12,
    height: 58,
  },
  label: { color: '#fff', fontSize: 14 },
  chevron: { color: '#a1a1aa', fontSize: 10 },
  list: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    backgroundColor: '#18181b',
    borderWidth: 1,
    borderColor: '#27272a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  option: { paddingHorizontal: 12, paddingVertical: 10 },
  optionText: { color: '#d4d4d8', fontSize: 13 },
  optionSelected: { color: '#fff', fontWeight: '700' },
});
