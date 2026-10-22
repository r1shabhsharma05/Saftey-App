import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../utils/supabase';
import { ensureProfile } from '../../utils/auth';

// The avatars bucket is PRIVATE (locked down 2026-10-22): profiles.avatar_url
// stores the storage PATH ("<uid>/avatar.jpg"), never a URL. Display needs a
// short-lived signed URL, minted on every profile load / photo change.
// Legacy rows stored a full public URL — the path is extracted from those.
const AVATAR_SIGN_TTL_SECONDS = 3600;
const resolveAvatarDisplayUrl = async (stored: string | null): Promise<string | null> => {
  if (!stored) return null;
  const match = stored.match(/avatars\/(.+?)(\?|$)/);
  const path = stored.startsWith('http') ? (match ? match[1] : null) : stored;
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('avatars')
    .createSignedUrl(path, AVATAR_SIGN_TTL_SECONDS);
  return error ? null : data.signedUrl;
};
import { useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import ScreenBackground from '../../components/ui/ScreenBackground';
import GlassCard from '../../components/ui/GlassCard';
import StatusPill from '../../components/ui/StatusPill';
import SectionHeader from '../../components/ui/SectionHeader';

export default function PremiumProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [avatarDisplayUrl, setAvatarDisplayUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

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
      setAvatarDisplayUrl(await resolveAvatarDisplayUrl(data?.avatar_url));
    } catch (error: any) {
      console.error('Profile fetch error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChangePhoto = async () => {
    try {
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in again to change your photo.');
        return;
      }
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo access in Settings to set a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (result.canceled || !result.assets?.length) return;

      setUploadingPhoto(true);
      // Upload to the private `avatars` bucket under the user's own uid
      // folder (storage RLS only allows writes there).
      const arrayBuffer = await (await fetch(result.assets[0].uri)).arrayBuffer();
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
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
      setAvatarDisplayUrl(await resolveAvatarDisplayUrl(path));
      Alert.alert('Photo updated', 'Your profile photo has been changed.');
    } catch (err: any) {
      console.error('Change photo error:', err);
      Alert.alert('Upload failed', err?.message || 'Could not update your photo. Please try again.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (err: any) {
      Alert.alert('System Error', 'Failed to close session: ' + err.message);
    }
  };

  if (loading) {
    return (
      <ScreenBackground>
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loaderText}>LOADING GUARDIAN…</Text>
        </View>
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <TouchableOpacity
        onPress={handleSignOut}
        style={styles.fixedLogoutBtn}
        activeOpacity={0.7}
        hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
      >
        <LinearGradient colors={['rgba(245, 51, 53, 0.22)', 'rgba(245, 51, 53, 0.06)']} style={styles.logoutBtnGrad}>
          <MaterialCommunityIcons name="logout-variant" size={22} color={Theme.colors.tertiary} />
        </LinearGradient>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Reanimated.View entering={FadeInUp.duration(500)} style={styles.header}>
          <Text style={styles.headerTitle}>Guardian Profile</Text>
        </Reanimated.View>

        {/* Profile hero */}
        <Reanimated.View entering={FadeInUp.delay(80).duration(500)} style={styles.profileHero}>
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
            <Text style={styles.changePhotoText}>{uploadingPhoto ? 'UPLOADING…' : 'CHANGE PHOTO'}</Text>
          </TouchableOpacity>
          <Text style={styles.userName}>
            {profile?.first_name} {profile?.last_name}
          </Text>
          <View style={styles.idRow}>
            <StatusPill label={`TACTICAL ID · ${profile?.unique_id ?? '—'}`} color={Theme.colors.primaryContainer} />
          </View>
        </Reanimated.View>

        {/* Info grid */}
        <Reanimated.View entering={FadeInUp.delay(140).duration(500)} style={styles.infoGrid}>
          <GlassCard style={styles.infoCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="mail-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Verified Email</Text>
            </View>
            <Text style={styles.cardValue} numberOfLines={1}>
              {profile?.email ?? '—'}
            </Text>
          </GlassCard>
          <GlassCard style={styles.infoCard}>
            <View style={styles.cardHeader}>
              <Ionicons name="call-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Emergency Comms</Text>
            </View>
            <Text style={styles.cardValue} numberOfLines={1}>
              {profile?.phone ?? '—'}
            </Text>
          </GlassCard>
        </Reanimated.View>

        <Reanimated.View entering={FadeInUp.delay(200).duration(500)}>
          <GlassCard style={[styles.infoCard, { marginTop: 14 }]}>
            <View style={styles.cardHeader}>
              <Ionicons name="map-outline" size={15} color={Theme.colors.primary} />
              <Text style={styles.cardLabel}>Deployment Base</Text>
            </View>
            <Text style={[styles.cardValue, styles.addressValue]}>{profile?.address ?? '—'}</Text>
          </GlassCard>
        </Reanimated.View>

        {/* Security protocol */}
        <Reanimated.View entering={FadeInUp.delay(260).duration(500)}>
          <View style={styles.sectionWrap}>
            <SectionHeader
              icon={<Ionicons name="shield-checkmark-outline" size={18} color={Theme.colors.primary} />}
              title="Security Protocol"
            />
          </View>
          <GlassCard style={styles.menuItem}>
            <View style={styles.menuIconBox}>
              <Ionicons name="finger-print-outline" size={20} color={Theme.colors.onSurface} />
            </View>
            <Text style={styles.menuLabel}>Biometric Lockdown</Text>
            <StatusPill label="READY" color={Theme.colors.primaryContainer} />
          </GlassCard>
          <GlassCard style={styles.menuItem}>
            <View style={styles.menuIconBox}>
              <Ionicons name="shield-half-outline" size={20} color={Theme.colors.onSurface} />
            </View>
            <Text style={styles.menuLabel}>Vault Protection</Text>
            <StatusPill label="ACTIVE" color={Theme.colors.success} pulse />
          </GlassCard>
          <GlassCard style={styles.menuItem}>
            <View style={styles.menuIconBox}>
              <Ionicons name="notifications-outline" size={20} color={Theme.colors.onSurface} />
            </View>
            <Text style={styles.menuLabel}>SOS Broadcast Channel</Text>
            <StatusPill label="ARMED" color={Theme.colors.warning} />
          </GlassCard>
        </Reanimated.View>

        <View style={{ height: 110 }} />
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  loaderContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loaderText: { fontFamily: Theme.fonts.label, fontSize: 11, color: Theme.colors.primary, letterSpacing: 3 },
  scrollContent: { padding: 20, paddingTop: 64 },
  header: { marginBottom: 26 },
  headerTitle: { fontFamily: Theme.fonts.headline, fontSize: 26, color: Theme.colors.onSurface, letterSpacing: -0.5 },
  fixedLogoutBtn: { position: 'absolute', right: 20, top: 62, zIndex: 999, elevation: 10 },
  logoutBtnGrad: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 51, 53, 0.25)',
  },
  profileHero: { alignItems: 'center', marginBottom: 30 },
  avatarGlow: {
    width: 112,
    height: 112,
    borderRadius: 34,
    padding: 3,
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.30)',
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.55,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
    overflow: 'hidden',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 31,
    backgroundColor: '#101024',
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
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.30)',
    backgroundColor: 'rgba(0, 227, 253, 0.08)',
  },
  changePhotoText: { fontFamily: Theme.fonts.label, fontSize: 10, letterSpacing: 1.5, color: Theme.colors.primary },
  userName: { fontFamily: Theme.fonts.headline, fontSize: 24, color: Theme.colors.onSurface, marginTop: 16 },
  idRow: { marginTop: 10 },
  infoGrid: { flexDirection: 'row', gap: 12 },
  infoCard: { flex: 1, padding: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 },
  cardLabel: { fontFamily: Theme.fonts.label, fontSize: 9, color: Theme.colors.onSurfaceVariant, letterSpacing: 1.5 },
  cardValue: { fontFamily: Theme.fonts.bodyBold, fontSize: 13.5, color: Theme.colors.onSurface },
  addressValue: { fontSize: 13, lineHeight: 20 },
  sectionWrap: { marginTop: 28 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 12,
    gap: 14,
  },
  menuIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { flex: 1, fontFamily: Theme.fonts.bodyBold, fontSize: 14, color: Theme.colors.onSurface },
});
