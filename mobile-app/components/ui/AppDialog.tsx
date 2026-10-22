import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import Reanimated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Theme } from '../../constants/theme';
import { registerDialogHost, type AppDialogRequest } from '../../utils/dialog';

/**
 * The one dialog host for the whole app (mounted in the root layout).
 * Replaces raw Alert.alert system dialogs with a themed card that
 * matches the app's glass/dark design — see utils/dialog.ts.
 */
export default function AppDialogHost() {
  const [dialog, setDialog] = useState<AppDialogRequest | null>(null);

  useEffect(() => registerDialogHost(setDialog), []);

  if (!dialog) return null;
  const buttons =
    dialog.buttons && dialog.buttons.length > 0 ? dialog.buttons : [{ text: 'OK' }];
  const close = () => setDialog(null);

  return (
    <Modal transparent visible animationType="none" onRequestClose={close}>
      <Reanimated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <Reanimated.View entering={ZoomIn.duration(180)} style={styles.card}>
          <Text style={styles.title}>{dialog.title}</Text>
          {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
          <View style={styles.actions}>
            {buttons.map((b, i) => (
              <TouchableOpacity
                key={`${b.text}-${i}`}
                style={[
                  styles.btn,
                  b.style === 'destructive' && styles.btnDestructive,
                  b.style === 'cancel' && styles.btnCancel,
                ]}
                onPress={() => {
                  close();
                  b.onPress?.();
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.btnText,
                    b.style === 'destructive' && styles.btnTextDestructive,
                    b.style === 'cancel' && styles.btnTextCancel,
                  ]}
                >
                  {b.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Reanimated.View>
      </Reanimated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 4, 12, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(19, 19, 36, 0.98)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(129, 236, 255, 0.22)',
    padding: 22,
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  title: {
    fontFamily: Theme.fonts.headline,
    fontSize: 18,
    color: Theme.colors.onSurface,
    marginBottom: 8,
  },
  message: {
    fontFamily: Theme.fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: Theme.colors.onSurfaceVariant,
  },
  actions: { marginTop: 18, gap: 10 },
  btn: {
    backgroundColor: Theme.colors.primaryContainer,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnDestructive: { backgroundColor: Theme.colors.errorContainer },
  btnCancel: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  btnText: {
    fontFamily: Theme.fonts.label,
    fontSize: 13,
    letterSpacing: 1,
    fontWeight: 'bold',
    color: '#06222b',
  },
  btnTextDestructive: { color: '#fff' },
  btnTextCancel: { color: Theme.colors.onSurfaceVariant },
});
