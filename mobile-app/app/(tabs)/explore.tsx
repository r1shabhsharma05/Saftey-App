import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../utils/supabase';
import { showAppDialog } from '../../utils/dialog';
import { ensureProfile } from '../../utils/auth';
import {
  authenticateForUnlock,
  getBiometricCapability,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
} from '../../utils/biometricLock';
import { MAX_AVATAR_BYTES, detectImageMime } from '../../utils/mediaValidation';

// The avatars bucket is PRIVATE (locked down 2026-10-22): profiles.avatar_url
// stores the storage PATH ("<uid>/avatar.jpg"), never a URL. Display needs a
// short-lived signed URL, minted on every profile load / photo change.
// Legacy rows stored a full public URL — the path is extracted from those.
const AVATAR_SIGN_TTL_SECONDS = 3600;
const resolveAvatarDisplayUrl = async (stored: string | null, uid: string | null): Promise<string | null> => {
  if (!stored || !uid) return null;
  const match = stored.match(/avatars\/(.+?)(\?|$)/);
  const path = stored.startsWith('http') ? (match ? match[1] : null) : stored;
  if (!path) return null;
  // (NV4) The path's first segment must be the caller's own uid:
  // profiles.avatar_url is client-writable, so without this check a
  // row pointing at another user's "<uid>/avatar.jpg" would mint a
  // signed URL for someone else's private photo.
  if (path.split('/')[0] !== uid) return null;
  const { data, error } = await supabase.storage
    .from('avatars')
    .createSignedUrl(path, AVATAR_SIGN_TTL_SECONDS);
  return error ? null : data.signedUrl;
};
import { useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import ScreenBackground from '../../components/ui/ScreenBackground';
import Card from '../../components/ui/Card';
import StatusPill from '../../components/ui/StatusPill';
import SectionHeader from '../../components/ui/SectionHeader';
import { fetchAuditEvents, type AuditLogResult } from '../../utils/auditLog';

export default function PremiumProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [auditLog, setAuditLog] = useState<AuditLogResult | null>(null);
  // Biometric app lock: the row below is the real toggle now.
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLoading, setBioLoading] = useState(true);

  useEffect(() => {
    fetchProfile();
    fetchAuditEvents().then(setAuditLog);
  }, []);

  useEffect(() => {
    void (async () => {
      const { hasHardware, isEnrolled } = await getBiometricCapability();
      setBioAvailable(hasHardware && isEnrolled);
      setBioEnabled(await isBiometricLockEnabled());
      setBioLoading(false);
    })();
  }, []);

  // Enabling proves it is the owner enrolling the lock; disabling
  // needs no prompt. Unavailable hardware → plain message, never a
  // lock the user cannot open.
  const toggleBiometricLock = async (value: boolean) => {
    if (!bioAvailable) {
      showAppDialog(
        'Biometrics Unavailable',
        'This device has no fingerprint or face unlock set up. Set one up in your device settings first.'
      );
      return;
    }
    if (value && !(await authenticateForUnlock())) return;
    await setBiometricLockEnabled(value);
    setBioEnabled(value);
  };

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      setUserId(user.id);
      // Users who signed up before the profiles flow existed may have
      // no row — create it from auth metadata before selecting.
      await ensureProfile(user);
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      setProfile(data);
      setLoadError(null);
      setAvatarDisplayUrl(await resolveAvatarDisplayUrl(data?.avatar_url, user.id));
    } catch (error: any) {
      console.error('Profile fetch error:', error);
      // A failed load used to render as a fake EMPTY profile (blank
      // name, '—' fields) with no way to retry. Surface it honestly.
      setLoadError('Your profile could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChangePhoto = async () => {
    try {
      if (!userId) {
        showAppDialog('Not signed in', 'Please sign in again to change your photo.');
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAppDialog('Permission needed', 'Allow photo access in Settings to set a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      // Cap the upload BEFORE reading the file into memory: a panorama
      // from the library can be tens of MB, and the old code buffered the
      // whole thing. fileSize may be absent on some platforms, so the
      // buffer length is re-checked after the read.
      if ((asset.fileSize ?? 0) > MAX_AVATAR_BYTES) {
        showAppDialog('Photo too large', 'Please choose a photo under 5 MB.');
        return;
      }

      setUploadingPhoto(true);
      // Upload to the private `avatars` bucket under the user's own uid
      // folder (storage RLS only allows writes there).
      const arrayBuffer = await (await fetch(asset.uri)).arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // The picker's mime/extension claim proves nothing — verify the
      // actual bytes, or a renamed binary lands in the bucket as avatar.jpg.
      const mime = detectImageMime(bytes);
      if (bytes.byteLength > MAX_AVATAR_BYTES || !mime) {
        setUploadingPhoto(false);
        showAppDialog(
          'Upload failed',
          !mime
            ? 'That file is not a photo we can use. Please pick a JPEG, PNG, WebP or GIF image.'
            : 'Please choose a photo under 5 MB.'
        );
        return;
      }
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, { contentType: mime, upsert: true });
      if (uploadError) throw uploadError;

      // Private bucket: profiles.avatar_url stores the PATH (never a URL);
      // the photo is displayed through a short-lived signed URL.
      // .select() so a zero-row update (profile row missing) surfaces
      // as an error instead of a silent "Photo updated" that saved
      // nothing — PostgREST updates matching no rows return no error.
      const { data: updated, error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: path })
        .eq('id', userId)
        .select('id');
      if (updateError) throw updateError;
      if (!updated || updated.length === 0) {
        throw new Error('Profile not found yet — pull to refresh and try again.');
      }

      setProfile((prev: any) => (prev ? { ...prev, avatar_url: path } : prev));
      setAvatarDisplayUrl(await resolveAvatarDisplayUrl(path, userId));
      showAppDialog('Photo updated', 'Your profile photo has been changed.');
    } catch (err: any) {
      console.error('Change photo error:', err);
      showAppDialog('Upload failed', err?.message || 'Could not update your photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err: any) {
      showAppDialog('System Error', 'Failed to close session: ' + err.message);
    }
  };

  if (loading) {
    return (
      <View style={styles.root}>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loaderText}>Loading profile…</Text>
        </View>
      </View>
    );
  }

  if (loadError && !profile) {
    return (
      <View style={styles.root}>
        <View style={styles.loaderContainer}>
          <Text style={styles.loaderText}>{loadError}</Text>
          <TouchableOpacity
            onPress={() => {
              setLoading(true);
              fetchProfile();
            }}
          >
            <Text style={[styles.loaderText, { color: Theme.colors.primaryText, marginTop: 14 }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TouchableOpacity
        onPress={handleSignOut}
        style={styles.fixedLogoutBtn}
        activeOpacity={0.7}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
      >
        <View style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color={Theme.colors.error} />
        </View>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>

        {/* Profile hero */}
        <View style={styles.profileHero}>
          <View style={styles.avatarGlow}>
            <View style={styles.avatarInner}>
              {avatarDisplayUrl ? (
                <Image
                  source={{ uri: avatarDisplayUrl }}
                  style={styles.avatarImage}
                  contentFit="cover"
                  transition={300}
                />
              ) : (
                <Ionicons name="person" size={52} color={Theme.colors.primary} />
              )}
            </View>
          </View>
          <TouchableOpacity
            style={styles.changePhotoBtn}
            onPress={handleChangePhoto}
            activeOpacity={0.8}
            disabled={uploadingPhoto}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={Theme.colors.primary} />
            ) : (
              <Ionicons name="camera-outline" size={15} color={Theme.colors.primary} />
            )}
            <Text style={styles.changePhotoText}>{uploadingPhoto ? 'Uploading…' : 'Change photo'}</Text>
          </TouchableOpacity>
          <Text style={styles.userName}>
            {profile?.first_name} {profile?.last_name}
          </Text>
          <View style={styles.idRow}>
            <StatusPill label={`ID · ${profile?.unique_id ?? '—'}`} color={Theme.colors.primaryContainer} />
          </View>
        </View>

        {/* Info grid */}
        <View style={styles.infoGrid}>
          <Card style={styles.infoCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="mail-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Email</Text>
            </View>
            <Text style={styles.cardValue} numberOfLines={1}>
              {profile?.email ?? '—'}
            </Text>
          </Card>
          <Card style={styles.infoCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="call-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Phone</Text>
            </View>
            <Text style={styles.cardValue} numberOfLines={1}>
              {profile?.phone ?? '—'}
            </Text>
          </Card>
        </View>

        <View>
          <Card style={[styles.infoCard, { marginTop: 14 }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="map-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Address</Text>
            </View>
            <Text style={[styles.cardValue, styles.addressValue]}>{profile?.address ?? '—'}</Text>
          </Card>
        </View>

        {/* Security protocol */}
        <View>
          <View style={styles.sectionWrap}>
            <SectionHeader
              icon={<Ionicons name="shield-checkmark-outline" size={18} color={Theme.colors.primary} />}
              title="Security"
            />
          </View>
          <Card style={styles.menuItem}>
            <Ionicons name="finger-print-outline" size={20} color={Theme.colors.onSurface} />
            <Text style={styles.menuLabel}>Biometric lock</Text>
            {bioLoading ? (
              <ActivityIndicator size="small" color={Theme.colors.onSurfaceVariant} />
            ) : bioAvailable ? (
              <Switch value={bioEnabled} onValueChange={toggleBiometricLock} />
            ) : (
              <Text style={styles.menuNote}>Unavailable</Text>
            )}
          </Card>
          <Card style={styles.menuItem}>
            <Ionicons name="shield-half-outline" size={20} color={Theme.colors.onSurface} />
            <Text style={styles.menuLabel}>Vault protection</Text>
            <StatusPill label="Active" color={Theme.colors.success} pulse />
          </Card>
          <Card style={styles.menuItem}>
            <Ionicons name="notifications-outline" size={20} color={Theme.colors.onSurface} />
            <Text style={styles.menuLabel}>SOS broadcast</Text>
            <StatusPill label="Armed" color={Theme.colors.warning} />
          </Card>
        </View>

        {/* Audit log (D23 admin basics) — recent backend audit events,
            newest first. The fetch never throws: every failure is an
            honest state, so the profile screen cannot crash on it. */}
        <View>
          <View style={styles.sectionWrap}>
            <SectionHeader
              icon={<Ionicons name="list-outline" size={18} color={Theme.colors.primary} />}
              title="Audit log"
            />
          </View>
          {auditLog === null ? (
            <Text style={styles.auditNote}>Loading audit log…</Text>
          ) : !auditLog.ok ? (
            <Text style={styles.auditNote}>
              {auditLog.reason === 'not-configured'
                ? 'Audit log unavailable — Supabase not configured.'
                : auditLog.reason === 'unauthorized'
                  ? 'Audit log unavailable — API key not configured.'
                  : 'Audit log unavailable — backend unreachable.'}
            </Text>
          ) : auditLog.events.length === 0 ? (
            <Text style={styles.auditNote}>No audit events yet.</Text>
          ) : (
            auditLog.events.map((event) => (
              <Card key={`${event.ts}-${event.action}`} style={styles.auditRow}>
                <Text style={styles.auditAction}>{event.action}</Text>
                <Text style={styles.auditTime}>{new Date(event.ts).toLocaleString()}</Text>
              </Card>
            ))
          )}
        </View>

        <View style={{ height: 110 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Theme.colors.surface },
  loaderContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loaderText: { ...Theme.type.caption1, fontSize: 11, color: Theme.colors.primaryText },
  scrollContent: { padding: 20, paddingTop: 64 },
  header: { marginBottom: 26 },
  headerTitle: { ...Theme.type.title1, color: Theme.colors.onSurface },
  fixedLogoutBtn: { position: 'absolute', right: 20, top: 62, zIndex: 999 },
  logoutBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.errorContainer,
  },
  profileHero: { alignItems: 'center', marginBottom: 30 },
  avatarGlow: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: Theme.colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: Theme.colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 56,
    backgroundColor: Theme.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  changePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Theme.colors.primaryContainer,
  },
  changePhotoText: { ...Theme.type.caption1, fontWeight: '600', color: Theme.colors.primaryText },
  userName: { ...Theme.type.title2, color: Theme.colors.onSurface, marginTop: 16 },
  idRow: { marginTop: 10 },
  infoGrid: { flexDirection: 'row', gap: 12 },
  infoCard: { flex: 1, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  cardLabel: { ...Theme.type.caption2, fontWeight: '600', color: Theme.colors.onSurfaceVariant },
  cardValue: { ...Theme.type.subhead, fontWeight: '600', fontSize: 13.5, color: Theme.colors.onSurface },
  addressValue: { fontSize: 13, lineHeight: 20 },
  sectionWrap: { marginTop: 28 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 12,
    gap: 14,
  },
  menuLabel: { flex: 1, ...Theme.type.subhead, fontWeight: '600', fontSize: 14, color: Theme.colors.onSurface },
  menuNote: { ...Theme.type.body, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  auditRow: { padding: 14, marginBottom: 10, gap: 4 },
  auditAction: { ...Theme.type.subhead, fontWeight: '600', fontSize: 13.5, color: Theme.colors.onSurface },
  auditTime: { ...Theme.type.caption2, color: Theme.colors.onSurfaceVariant },
  auditNote: { ...Theme.type.body, fontSize: 13, color: Theme.colors.onSurfaceVariant, paddingVertical: 6 },
});
