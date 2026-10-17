import React from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TextInputProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Floxly } from '../../constants/floxly';

interface Props extends Omit<TextInputProps, 'style'> {
  icon: string;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Floxly-style pill input: dark translucent rounded field
 * with a leading icon, like the reference login screen.
 */
export default function FloxlyInput({ icon, containerStyle, ...rest }: Props) {
  return (
    <View style={[styles.wrap, containerStyle]}>
      <MaterialCommunityIcons
        name={icon as any}
        size={20}
        color="rgba(255,255,255,0.55)"
        style={styles.icon}
      />
      <TextInput
        style={styles.input}
        placeholderTextColor={Floxly.colors.pillPlaceholder}
        {...rest}
      />
    </View>
  );
}

export function FloxlyLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Floxly.colors.pill,
    borderWidth: 1,
    borderColor: Floxly.colors.pillBorder,
    borderRadius: 18,
    paddingHorizontal: 18,
    height: 58,
  },
  icon: { marginRight: 12 },
  input: {
    flex: 1,
    color: '#fff',
    fontFamily: Floxly.fonts.body,
    fontSize: 15,
    height: '100%',
  },
  label: {
    color: Floxly.colors.subtext,
    fontFamily: Floxly.fonts.label,
    fontSize: 12,
    letterSpacing: 1.4,
    marginBottom: 8,
    marginLeft: 6,
  },
});
