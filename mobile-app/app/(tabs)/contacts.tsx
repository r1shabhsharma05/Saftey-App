import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Contacts from 'expo-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { supabase } from '../../utils/supabase';
import { Theme } from '../../constants/theme';
import ScreenBackground from '../../components/ui/ScreenBackground';
import GlassCard from '../../components/ui/GlassCard';
import StatusPill from '../../components/ui/StatusPill';
import SectionHeader from '../../components/ui/SectionHeader';

interface DeviceContact {
  key: string; // normalized phone (last 10 digits) — selection/match key
  name: string;
  phone: string; // display number, as stored on the device
}

/** Match key for a phone number: digits only, last 10 (drops +, country code, spaces). */
const phoneKey = (phone: string) => phone.replace(/[^0-9]/g, '').slice(-10);

export default function EmergencyContactsScreen() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [signedOut, setSignedOut] = useState(false);
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [deviceContacts, setDeviceContacts] = useState<DeviceContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // Signed out is NOT a contacts-permission problem — the old
        // code set permission 'denied' here, so a signed-out user got
        // an "ALLOW CONTACTS" card that could never fix anything.
        setSignedOut(true);
        return;
      }
      setUserId(user.id);

      // Already-saved emergency contacts — used to pre-select rows.
      const { data: saved, error } = await supabase
        .from('emergency_contacts')
        .select('name, phone')
        .eq('user_id', user.id);
      if (error) console.log('Saved contacts fetch failed:', error.message);
      const savedKeys = new Set<string>((saved ?? []).map((c: any) => phoneKey(String(c.phone ?? ''))));

      await loadDeviceContacts(savedKeys);
    } catch (err) {
      console.log('Contacts load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDeviceContacts = async (preSelected: Set<string>) => {
    const { status, canAskAgain: ask } = await Contacts.requestPermissionsAsync();
    setCanAskAgain(ask);
    if (status !== 'granted') {
      setPermission('denied');
      return;
    }
    setPermission('granted');

    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers],
    });

    const byKey = new Map<string, DeviceContact>();
    for (const contact of data) {
      for (const entry of contact.phoneNumbers ?? []) {
        const number = (entry.number || '').trim();
        if (!number) continue;
        const key = phoneKey(number);
        if (key.length < 7 || byKey.has(key)) continue;
        byKey.set(key, {
          key,
          name: contact.name || 'Unknown',
          phone: number,
        });
      }
    }
    const list = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    setDeviceContacts(list);

    // Pre-select rows the user already saved (matched by phone).
    setSelected((prev) => {
      const next = new Set<string>(prev);
      for (const c of list) {
        if (preSelected.has(c.key)) next.add(c.key);
      }
      return next;
    });
  };

  const handleGrantPermission = async () => {
    if (!canAskAgain) {
      Linking.openSettings();
      return;
    }
    setLoading(true);
    try {
      const { data: saved } = userId
        ? await supabase.from('emergency_contacts').select('phone').eq('user_id', userId)
        : { data: null };
      const savedKeys = new Set<string>((saved ?? []).map((c: any) => phoneKey(String(c.phone ?? ''))));
      await loadDeviceContacts(savedKeys);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (!userId) {
      Alert.alert('Not signed in', 'Please sign in again to save emergency contacts.');
      return;
    }
    const chosen = deviceContacts.filter((c) => selected.has(c.key));
    setSaving(true);
    try {
      // Diff-based save. The old flow deleted ALL rows and then
      // inserted the new selection: if the insert failed, the user's
      // saved SOS contacts were gone server-side while the phone kept
      // a stale local cache. Now additions are inserted first and only
      // true removals are deleted — a failure at any step leaves the
      // previously saved set intact. (Keyed by phone: a name edit on
      // an already-saved number is not re-written.)
      const { data: existingRows, error: fetchError } = await supabase
        .from('emergency_contacts')
        .select('id, phone')
        .eq('user_id', userId);
      if (fetchError) throw fetchError;

      const existingKeys = new Set(
        (existingRows ?? []).map((r: any) => phoneKey(String(r.phone ?? '')))
      );
      const chosenKeys = new Set(chosen.map((c) => phoneKey(c.phone)));

      const toInsert = chosen.filter((c) => !existingKeys.has(phoneKey(c.phone)));
      if (toInsert.length > 0) {
        const { error: insertError } = await supabase.from('emergency_contacts').insert(
          toInsert.map((c) => ({ user_id: userId, name: c.name, phone: c.phone }))
        );
        if (insertError) throw insertError;
      }

      const toDeleteIds = (existingRows ?? [])
        .filter((r: any) => !chosenKeys.has(phoneKey(String(r.phone ?? ''))))
        .map((r: any) => r.id);
      if (toDeleteIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('emergency_contacts')
          .delete()
          .in('id', toDeleteIds);
        if (deleteError) throw deleteError;
      }

      // Local cache — the SOS screen reads this at send time.
      await AsyncStorage.setItem(
        'emergencyContacts',
        JSON.stringify(chosen.map((c) => ({ name: c.name, phone: c.phone })))
      );

      Alert.alert(
        'Contacts saved',
        chosen.length > 0
          ? `${chosen.length} contact${chosen.length === 1 ? '' : 's'} will receive your SOS.`
          : 'Your SOS contact list is now empty.'
      );
    } catch (err: any) {
      console.error('Save contacts error:', err);
      Alert.alert('Save failed', err?.message || 'Could not save contacts. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deviceContacts;
    const qDigits = q.replace(/[^0-9]/g, '');
    return deviceContacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        // Phone match only when the query actually has digits: for a
        // name-only query qDigits is '' and ''.includes('') is true for
        // EVERY contact — the old code returned the full list, so search
        // looked completely broken.
        (qDigits.length > 0 && c.phone.replace(/[^0-9]/g, '').includes(qDigits))
    );
  }, [deviceContacts, search]);

  const selectedCount = selected.size;

  return (
    <ScreenBackground>
      <View style={styles.container}>
        <Reanimated.View entering={FadeInUp.duration(500)} style={styles.header}>
          <Text style={styles.headerTitle}>Emergency Contacts</Text>
          <Text style={styles.headerSub}>
            Pick who should be alerted when you trigger SOS. Selected contacts are attached to every SOS alert.
          </Text>
        </Reanimated.View>

        <Reanimated.View entering={FadeInUp.delay(80).duration(500)}>
          <GlassCard style={styles.countCard}>
            <Ionicons name="people" size={20} color={Theme.colors.primary} />
            <Text style={styles.countText}>
              {selectedCount} contact{selectedCount === 1 ? '' : 's'} will receive your SOS
            </Text>
            <StatusPill
              label={selectedCount > 0 ? 'ARMED' : 'EMPTY'}
              color={selectedCount > 0 ? Theme.colors.success : Theme.colors.warning}
              pulse={selectedCount > 0}
            />
          </GlassCard>
        </Reanimated.View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Theme.colors.primary} />
            <Text style={styles.centerText}>LOADING CONTACTS…</Text>
          </View>
        ) : signedOut ? (
          <Reanimated.View entering={FadeInUp.delay(140).duration(500)}>
            <GlassCard style={styles.permCard}>
              <Ionicons name="person-circle-outline" size={30} color={Theme.colors.primary} />
              <Text style={styles.permTitle}>Sign in needed</Text>
              <Text style={styles.permText}>
                You are signed out. Sign in again to choose and save your SOS contacts.
              </Text>
              <TouchableOpacity style={styles.permBtn} onPress={() => router.replace('/login')} activeOpacity={0.8}>
                <Text style={styles.permBtnText}>GO TO SIGN IN</Text>
              </TouchableOpacity>
            </GlassCard>
          </Reanimated.View>
        ) : permission !== 'granted' ? (
          <Reanimated.View entering={FadeInUp.delay(140).duration(500)}>
            <GlassCard style={styles.permCard}>
              <Ionicons name="lock-closed-outline" size={30} color={Theme.colors.primary} />
              <Text style={styles.permTitle}>Contacts access needed</Text>
              <Text style={styles.permText}>
                SafeLife reads your contacts only to let you choose SOS recipients. Nothing is uploaded
                unless you select it and tap Save.
              </Text>
              <TouchableOpacity style={styles.permBtn} onPress={handleGrantPermission} activeOpacity={0.8}>
                <Text style={styles.permBtnText}>{canAskAgain ? 'ALLOW CONTACTS' : 'OPEN SETTINGS'}</Text>
              </TouchableOpacity>
            </GlassCard>
          </Reanimated.View>
        ) : (
          <>
            <Reanimated.View entering={FadeInUp.delay(140).duration(500)}>
              <GlassCard style={styles.searchCard}>
                <Ionicons name="search-outline" size={18} color={Theme.colors.onSurfaceVariant} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search contacts…"
                  placeholderTextColor={Theme.colors.onSurfaceVariant}
                  value={search}
                  onChangeText={setSearch}
                  autoCorrect={false}
                />
                {search.length > 0 && (
                  <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="close-circle" size={18} color={Theme.colors.onSurfaceVariant} />
                  </TouchableOpacity>
                )}
              </GlassCard>
            </Reanimated.View>

            <Reanimated.View entering={FadeInUp.delay(200).duration(500)} style={styles.sectionWrap}>
              <SectionHeader
                icon={<Ionicons name="call-outline" size={18} color={Theme.colors.primary} />}
                title={`All Contacts · ${filtered.length}`}
              />
            </Reanimated.View>

            <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {filtered.length === 0 ? (
                <Text style={styles.emptyText}>
                  {deviceContacts.length === 0
                    ? 'No contacts with phone numbers found on this device.'
                    : 'No contacts match your search.'}
                </Text>
              ) : (
                filtered.map((contact) => {
                  const isSelected = selected.has(contact.key);
                  return (
                    <TouchableOpacity
                      key={contact.key}
                      style={[styles.row, isSelected && styles.rowSelected]}
                      onPress={() => toggle(contact.key)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                        {isSelected && <Ionicons name="checkmark" size={15} color="#06202b" />}
                      </View>
                      <View style={styles.rowTextBox}>
                        <Text style={styles.rowName} numberOfLines={1}>{contact.name}</Text>
                        <Text style={styles.rowPhone} numberOfLines={1}>{contact.phone}</Text>
                      </View>
                      <Ionicons
                        name={isSelected ? 'shield-checkmark' : 'shield-outline'}
                        size={18}
                        color={isSelected ? Theme.colors.success : Theme.colors.onSurfaceVariant}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
              <View style={{ height: 12 }} />
            </ScrollView>

            <View style={styles.saveBar}>
              <TouchableOpacity onPress={handleSave} activeOpacity={0.85} disabled={saving} style={styles.saveBtnWrap}>
                <LinearGradient colors={Theme.gradients.sosCore} style={styles.saveBtn}>
                  {saving ? (
                    <ActivityIndicator size="small" color={Theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="save-outline" size={17} color={Theme.colors.primary} />
                      <Text style={styles.saveBtnText}>SAVE CONTACTS</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 64 },
  header: { marginBottom: 18 },
  headerTitle: { fontFamily: Theme.fonts.headline, fontSize: 26, color: Theme.colors.onSurface, letterSpacing: -0.5 },
  headerSub: { fontFamily: Theme.fonts.body, fontSize: 12.5, lineHeight: 18, color: Theme.colors.onSurfaceVariant, marginTop: 8 },
  countCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginBottom: 16 },
  countText: { flex: 1, fontFamily: Theme.fonts.bodyBold, fontSize: 13.5, color: Theme.colors.onSurface },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  centerText: { fontFamily: Theme.fonts.label, fontSize: 11, color: Theme.colors.primary, letterSpacing: 3 },
  permCard: { padding: 24, alignItems: 'center', gap: 12 },
  permTitle: { fontFamily: Theme.fonts.headline, fontSize: 18, color: Theme.colors.onSurface },
  permText: { fontFamily: Theme.fonts.body, fontSize: 13, lineHeight: 19, color: Theme.colors.onSurfaceVariant, textAlign: 'center' },
  permBtn: {
    marginTop: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.35)',
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
  },
  permBtnText: { fontFamily: Theme.fonts.label, fontSize: 11, letterSpacing: 1.5, color: Theme.colors.primary },
  searchCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 4 },
  searchInput: { flex: 1, fontFamily: Theme.fonts.body, fontSize: 14, color: Theme.colors.onSurface, paddingVertical: 10 },
  sectionWrap: { marginTop: 18, marginBottom: 4 },
  list: { flex: 1 },
  listContent: { paddingTop: 6 },
  emptyText: { fontFamily: Theme.fonts.body, fontSize: 13, color: Theme.colors.onSurfaceVariant, textAlign: 'center', marginTop: 30, lineHeight: 19 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(30, 30, 55, 0.42)',
  },
  rowSelected: { borderColor: 'rgba(0, 227, 253, 0.35)', backgroundColor: 'rgba(0, 227, 253, 0.07)' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Theme.colors.primary, borderColor: Theme.colors.primary },
  rowTextBox: { flex: 1 },
  rowName: { fontFamily: Theme.fonts.bodyBold, fontSize: 14.5, color: Theme.colors.onSurface },
  rowPhone: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  saveBar: { paddingTop: 10, paddingBottom: 112 },
  saveBtnWrap: { borderRadius: 16, overflow: 'hidden' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.colors.primary + '30',
  },
  saveBtnText: { fontFamily: Theme.fonts.label, fontSize: 12, letterSpacing: 2, color: Theme.colors.primary },
});
