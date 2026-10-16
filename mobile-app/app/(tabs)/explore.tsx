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
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../utils/supabase';
import { useRouter } from 'expo-router';
import { Theme } from '../../constants/theme';
import ScreenBackground from '../../components/premium/ScreenBackground';
import GlassCard from '../../components/premium/GlassCard';
import StatusPill from '../../components/premium/StatusPill';
import SectionHeader from '../../components/premium/SectionHeader';

export default function PremiumProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);

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
      const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      if (error) throw error;
      setProfile(data);
    } catch (error: any) {
      console.error('Profile fetch error:', error);
    } finally {
      setLoading(false);
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
            <Image source={require('../../assets/images/icon.png')} style={styles.avatar} contentFit="cover" />
          </View>
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
  avatar: { width: '100%', height: '100%', borderRadius: 31 },
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
