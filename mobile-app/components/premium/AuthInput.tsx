import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../../constants/theme';

interface Props extends TextInputProps {
  label: string;
  icon: string;
  /** shows the eye toggle */
  secure?: boolean;
}

/**
 * Premium auth field: floating label, icon, focus glow ring.
 * Single source of truth — replaces the duplicated renderInput in login/register.
 */
export default function AuthInput({ label, icon, secure, ...rest }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(!!secure);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View
        style={[
          styles.wrapper,
          focused && styles.wrapperFocused,
        ]}
      >
        <MaterialCommunityIcons
          name={icon as any}
          size={19}
          color={focused ? Theme.colors.primaryContainer : Theme.colors.outline}
        />
        <TextInput
          style={styles.input}
          placeholderTextColor="rgba(255,255,255,0.22)"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCorrect={false}
          spellCheck={false}
          secureTextEntry={secure ? hidden : undefined}
          {...rest}
        />
        {secure && (
          <TouchableOpacity onPress={() => setHidden(!hidden)} hitSlop={12}>
            <Ionicons
              name={hidden ? 'eye' : 'eye-off'}
              size={20}
              color={Theme.colors.outline}
            />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: {
    fontFamily: Theme.fonts.label,
    fontSize: 10,
    fontWeight: '700',
    color: Theme.colors.primary,
    letterSpacing: 2.5,
  },
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  wrapperFocused: {
    borderColor: Theme.colors.primaryContainer,
    backgroundColor: 'rgba(0, 227, 253, 0.06)',
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  input: {
    flex: 1,
    fontFamily: Theme.fonts.body,
    fontSize: 16,
    color: Theme.colors.onSurface,
    padding: 0,
  },
});
