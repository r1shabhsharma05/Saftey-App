import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
  Linking,
  ScrollView,
  Share,
} from 'react-native';
import Reanimated, { FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { supabase } from '../../utils/supabase';
import { Theme } from '../../constants/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AlertActiveView from '../../components/AlertActiveView';
import { rankSafePlaces, calculateBearing, getCardinalDirection } from '../../utils/escapeLogic';
import ScreenBackground from '../../components/ui/ScreenBackground';
import GlassCard from '../../components/ui/GlassCard';
import TiltCard from '../../components/ui/TiltCard';
import StatusPill from '../../components/ui/StatusPill';
import SectionHeader from '../../components/ui/SectionHeader';
import SafeHubCard from '../../components/ui/SafeHubCard';
import PoliceStationCard from '../../components/ui/PoliceStationCard';

// Backend URL is configurable via EXPO_PUBLIC_BACKEND_URL (see .env.example).
// Falls back to the last-known dev address for local runs.
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://172.16.48.118:5000';

export default function TacticalDashboard() {
  // --- States ---
  const [status, setStatus] = useState<'SAFE' | 'ALERT ACTIVE'>('SAFE');
  const [lat, setLat] = useState<string>('Loading...');
  const [lng, setLng] = useState<string>('Loading...');
  const [batteryLevel, setBatteryLevel] = useState(0);
  const [isMoving, setIsMoving] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [nearestStation, setNearestStation] = useState('Searching...');
  const [isLoading, setIsLoading] = useState(false);
  const [cachedSafePlaces, setCachedSafePlaces] = useState<any[]>([]);
  const lastFetchTime = useRef<number>(0);

  // --- Animations ---
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sosScale = useRef(new Animated.Value(1)).current;

  // --- Effects ---
  useEffect(() => {
    const setupSubscriptions = async () => {
      try {
        // Instant offline loading
        const offlineCache = await AsyncStorage.getItem('safePlacesCache');
        if (offlineCache) setCachedSafePlaces(JSON.parse(offlineCache));

        const { status: permissionStatus } = await Location.requestForegroundPermissionsAsync();
        if (permissionStatus !== 'granted') return;

        const location = await Location.getCurrentPositionAsync({});
        updateLocationData(location);

        const level = await Battery.getBatteryLevelAsync();
        setBatteryLevel(Math.round(level * 100));

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
          if (data) setUserData(data);
        }

        const locSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
          (loc) => updateLocationData(loc)
        );

        const batSub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
          setBatteryLevel(Math.round(batteryLevel * 100));
        });

        return () => {
          locSub.remove();
          batSub.remove();
        };
      } catch (err) {
        console.log('Setup error:', err);
      }
    };

    setupSubscriptions();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const updateLocationData = (location: Location.LocationObject) => {
    const currentLat = location.coords.latitude.toFixed(6);
    const currentLng = location.coords.longitude.toFixed(6);
    setLat(currentLat);
    setLng(currentLng);
    setIsMoving(location.coords.speed !== null && location.coords.speed > 0.5);
    fetchSafePlacesCache(currentLat, currentLng);
  };

  const fetchSafePlacesCache = async (lat: string, lng: string) => {
    const now = Date.now();

    // Prevent API spam bans: 30s cooldown, 3min refresh when data exists.
    if (now - lastFetchTime.current < 30000) return;
    if (now - lastFetchTime.current < 180000 && cachedSafePlaces.length > 0) return;

    lastFetchTime.current = now;

    try {
      const query = `[out:json];(nwr["amenity"="police"](around:50000,${lat},${lng});nwr["amenity"~"hospital|clinic|mall|cafe|bank|pharmacy|university|college"](around:10000,${lat},${lng});nwr["tourism"~"hostel|hotel"](around:10000,${lat},${lng});nwr["shop"~"mall|supermarket|department_store"](around:10000,${lat},${lng}););out center;`;
      const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (data.elements && data.elements.length > 0) {
        const parsedPlaces = data.elements.map((el: any) => {
          let category = 'other';
          const amenity = el.tags?.amenity || '';
          const tourism = el.tags?.tourism || '';
          const shop = el.tags?.shop || '';
          const name = (el.tags?.name || '').toLowerCase();

          if (amenity.includes('police')) category = 'police';
          else if (amenity.includes('university') || amenity.includes('college') || name.includes('gla university')) category = 'university';
          else if (amenity.includes('hospital') || amenity.includes('clinic')) category = 'hospital';
          else if (tourism.includes('hostel') || name.includes('hostel')) category = 'hostel';
          else if (amenity.includes('mall') || amenity.includes('cafe') || shop !== '') category = 'crowd';

          return {
            id: el.id,
            lat: el.lat || el.center?.lat,
            lng: el.lon || el.center?.lon,
            name: el.tags?.name || category.toUpperCase(),
            phone: el.tags?.phone || el.tags?.['contact:phone'] || 'N/A',
            category,
          };
        }).filter((p: any) => p.lat && p.lng);

        setCachedSafePlaces(parsedPlaces);
        AsyncStorage.setItem('safePlacesCache', JSON.stringify(parsedPlaces));

        const policeStations = parsedPlaces.filter((p: any) => p.category === 'police');
        if (policeStations.length > 0) {
          setNearestStation(policeStations[0].name || 'Police Station Nearby');
        } else if (parsedPlaces.length > 0) {
          setNearestStation(parsedPlaces[0].name || 'Safe Zone Nearby');
        } else {
          setNearestStation('No station found in 3km');
        }
      } else {
        setNearestStation('No station found in 3km');
      }
    } catch (err) {
      setNearestStation('Station data unavailable');
    }
  };

  const sendSOSAlert = async () => {
    // Don't fire an SOS with a placeholder location — the backend now
    // rejects non-numeric coordinates with a 400, so fail fast here with
    // a clear message instead of a silent server rejection.
    if (lat === 'Loading...' || lng === 'Loading...') {
      Alert.alert('Hold on', 'Waiting for a GPS fix before sending the SOS.');
      return;
    }
    setIsLoading(true);
    setStatus('ALERT ACTIVE');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(`${BACKEND_URL}/alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Backend API-key auth: required on /alert when the backend's API_SECRET is set.
          'x-api-key': process.env.EXPO_PUBLIC_API_SECRET ?? '',
        },
        body: JSON.stringify({
          lat,
          lng,
          name: userData ? `${userData.first_name} ${userData.last_name}` : 'Unknown User',
          phone: userData ? userData.phone : 'Not Provided',
          battery: batteryLevel,
          status: isMoving ? 'Moving' : 'Stationary',
          nearestStation,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await response.json();
      if (data.success) {
        Alert.alert('Alert Sent', 'Emergency contacts have been notified.');
      } else {
        // Surface backend rejections (400 invalid location, 401, 429 rate
        // limit) instead of failing silently — the server's error strings
        // are safe generics, never internals.
        Alert.alert('Alert Failed', data?.error || 'Emergency servers rejected the alert. Try again.');
        setStatus('SAFE');
      }
    } catch {
      Alert.alert('Alert Failed', 'Could not reach emergency servers. Check the backend URL.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSOSPress = () => {
    Animated.sequence([
      Animated.spring(sosScale, { toValue: 0.92, useNativeDriver: true }),
      Animated.spring(sosScale, { toValue: 1, useNativeDriver: true }),
    ]).start(() => sendSOSAlert());
  };

  const handleShareLocation = async () => {
    if (lat === 'Loading...') {
      Alert.alert('Hold on', 'Waiting for a GPS fix before sharing.');
      return;
    }
    try {
      await Share.share({
        message: `SafeLife AI — my live location: https://maps.google.com/?q=${lat},${lng}`,
      });
    } catch {
      /* dismissed */
    }
  };

  const handleNavigateNearest = () => {
    if (lat === 'Loading...' || cachedSafePlaces.length === 0) {
      Alert.alert('Hold on', 'Still scanning for nearby safe places.');
      return;
    }
    const ranked = rankSafePlaces(cachedSafePlaces, parseFloat(lat), parseFloat(lng));
    const best = ranked[0];
    if (best) {
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${best.lat},${best.lng}`);
    }
  };

  const policeStations =
    lat !== 'Loading...'
      ? rankSafePlaces(
          cachedSafePlaces.filter((p) => p.category === 'police'),
          parseFloat(lat),
          parseFloat(lng)
        ).slice(0, 5)
      : [];

  if (status === 'ALERT ACTIVE') {
    return (
      <AlertActiveView
        lat={lat}
        lng={lng}
        cachedSafePlaces={cachedSafePlaces}
        onStop={() => {
          setStatus('SAFE');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }}
      />
    );
  }

  return (
    <ScreenBackground>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <Reanimated.View entering={FadeInUp.duration(500)} style={styles.header}>
          <View style={styles.headerTitleRow}>
            <View style={styles.brandDot}>
              <MaterialCommunityIcons name="shield-check" size={20} color={Theme.colors.primaryContainer} />
            </View>
            <Text style={styles.brandTitle}>SafeLife AI</Text>
          </View>
          <StatusPill
            label={status}
            color={status === 'SAFE' ? Theme.colors.success : Theme.colors.error}
            pulse={status !== 'SAFE'}
          />
        </Reanimated.View>

        {/* Guardian badge */}
        <Reanimated.View entering={FadeInUp.delay(80).duration(500)} style={styles.badgeRow}>
          <StatusPill label="SYSTEM GUARDIAN ACTIVE" color={Theme.colors.success} pulse />
        </Reanimated.View>

        {/* SOS Core — 3D tilt orb */}
        <Reanimated.View entering={FadeInUp.delay(140).duration(600)} style={styles.sosWrap}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]} />
          <Animated.View style={[styles.pulseRing2, { transform: [{ scale: pulseAnim }] }]} />
          <TiltCard style={styles.sosTilt} maxTilt={7} borderRadius={110}>
            <Animated.View style={{ transform: [{ scale: sosScale }], flex: 1 }}>
              <TouchableOpacity onPress={handleSOSPress} activeOpacity={0.92} style={styles.sosButton}>
                <LinearGradient colors={Theme.gradients.sosCore} style={styles.sosGradient}>
                  <MaterialCommunityIcons name="fingerprint" size={62} color={Theme.colors.primary} />
                  <Text style={styles.sosButtonText}>SOS</Text>
                  <Text style={styles.sosButtonSub}>TAP FOR SOS</Text>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </TiltCard>
        </Reanimated.View>

        {/* Live location glass card */}
        <Reanimated.View entering={FadeInUp.delay(200).duration(500)}>
          <GlassCard style={styles.locationCard}>
            <View style={styles.cardHeader}>
              <View style={styles.iconBox}>
                <Ionicons name="location" size={20} color={Theme.colors.primary} />
              </View>
              <View style={styles.cardTitleBox}>
                <Text style={styles.cardTitle}>Live Location</Text>
                <Text style={styles.cardSubTitle}>{userData?.address || 'Current Zone'}</Text>
              </View>
              <StatusPill label={isMoving ? 'MOVING' : 'STEADY'} color={isMoving ? Theme.colors.warning : Theme.colors.primaryContainer} />
            </View>
            <View style={styles.coordsRow}>
              <View style={styles.coordBox}>
                <Text style={styles.coordLabel}>LATITUDE</Text>
                <Text style={styles.coordValue}>{lat}°</Text>
              </View>
              <View style={styles.coordBox}>
                <Text style={styles.coordLabel}>LONGITUDE</Text>
                <Text style={styles.coordValue}>{lng}°</Text>
              </View>
              <View style={styles.coordBox}>
                <Text style={styles.coordLabel}>BATTERY</Text>
                <Text style={[styles.coordValue, { color: batteryLevel < 20 ? Theme.colors.error : Theme.colors.success }]}>
                  {batteryLevel}%
                </Text>
              </View>
            </View>
          </GlassCard>
        </Reanimated.View>

        {/* Quick actions */}
        <Reanimated.View entering={FadeInUp.delay(260).duration(500)} style={styles.actionsGrid}>
          {[
            { icon: 'call', label: 'CALL', action: () => Linking.openURL('tel:112') },
            { icon: 'share-social', label: 'SHARE', action: handleShareLocation },
            { icon: 'map', label: 'MAP', action: () => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`) },
            { icon: 'navigate', label: 'RESCUE', action: handleNavigateNearest },
          ].map((item, idx) => (
            <TouchableOpacity key={idx} style={styles.actionItem} onPress={item.action} activeOpacity={0.7}>
              <View style={styles.actionIconBox}>
                <Ionicons name={item.icon as any} size={23} color={Theme.colors.onSurface} />
              </View>
              <Text style={styles.actionLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </Reanimated.View>

        {/* Police radar */}
        <Reanimated.View entering={FadeInUp.delay(320).duration(500)}>
          <SectionHeader
            icon={<MaterialCommunityIcons name="police-badge" size={18} color={Theme.colors.police} />}
            title="Police Radar · 50km"
          />
          {policeStations.length > 0 ? (
            policeStations.map((station: any, idx: number) => {
              const bearing = calculateBearing(parseFloat(lat), parseFloat(lng), station.lat, station.lng);
              const direction = getCardinalDirection(bearing);
              const distMeters = Math.round(station.distance || 0);
              const displayDist = distMeters > 1000 ? `${(distMeters / 1000).toFixed(1)}km` : `${distMeters}m`;
              return (
                <PoliceStationCard
                  key={`${station.id}-${idx}`}
                  name={station.name}
                  phone={station.phone}
                  distanceLabel={displayDist}
                  direction={direction}
                  lat={station.lat}
                  lng={station.lng}
                />
              );
            })
          ) : (
            <GlassCard style={styles.bannerCard}>
              <MaterialCommunityIcons name="police-badge" size={20} color={Theme.colors.primary} />
              <Text style={styles.bannerText}>Nearest: {nearestStation}</Text>
            </GlassCard>
          )}
        </Reanimated.View>

        {/* Safe hubs */}
        {lat !== 'Loading...' && (
          <Reanimated.View entering={FadeInUp.delay(380).duration(500)} style={styles.hubsSection}>
            <SectionHeader
              icon={<Ionicons name="shield-half" size={18} color={Theme.colors.primary} />}
              title="Nearby Safe Hubs"
            />
            {cachedSafePlaces.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hubsRow}
              >
                {rankSafePlaces(cachedSafePlaces, parseFloat(lat), parseFloat(lng))
                  .slice(0, 25)
                  .map((place, index) => (
                    <SafeHubCard key={`${place.id}-${index}`} place={place} />
                  ))}
              </ScrollView>
            ) : (
              <GlassCard style={styles.scanningCard}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.scanningText}>Scanning 10km radius for safe areas…</Text>
              </GlassCard>
            )}
          </Reanimated.View>
        )}

        <View style={{ height: 110 }} />
      </ScrollView>

      {/* Loading overlay */}
      {isLoading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Theme.colors.primary} />
          <Text style={styles.loaderText}>ACTIVATING SOS…</Text>
        </View>
      )}
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20, paddingTop: 60 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandDot: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  brandTitle: { fontFamily: Theme.fonts.headline, fontSize: 23, color: Theme.colors.primary, letterSpacing: -0.5 },
  badgeRow: { alignItems: 'center', marginBottom: 8 },
  sosWrap: { height: 300, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  pulseRing: {
    position: 'absolute',
    width: 284,
    height: 284,
    borderRadius: 142,
    borderWidth: 2,
    borderColor: Theme.colors.primary + '2e',
  },
  pulseRing2: {
    position: 'absolute',
    width: 330,
    height: 330,
    borderRadius: 165,
    borderWidth: 1,
    borderColor: Theme.colors.primary + '14',
  },
  sosTilt: { width: 220, height: 220, borderRadius: 110 },
  sosButton: { flex: 1, borderRadius: 110, overflow: 'hidden' },
  sosGradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Theme.colors.primary + '30',
    borderRadius: 110,
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.5,
    shadowRadius: 36,
    elevation: 18,
  },
  sosButtonText: { fontFamily: Theme.fonts.headline, color: Theme.colors.primary, fontSize: 44, fontWeight: '900', letterSpacing: 2, marginTop: 6 },
  sosButtonSub: { fontFamily: Theme.fonts.label, color: Theme.colors.onSurfaceVariant, fontSize: 10, letterSpacing: 3, marginTop: 2 },
  locationCard: { padding: 18, marginBottom: 18 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 12 },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 227, 253, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleBox: { flex: 1 },
  cardTitle: { fontFamily: Theme.fonts.headline, fontSize: 17, color: Theme.colors.onSurface },
  cardSubTitle: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant, marginTop: 2 },
  coordsRow: { flexDirection: 'row', gap: 10 },
  coordBox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  coordLabel: { fontFamily: Theme.fonts.label, fontSize: 8, color: Theme.colors.onSurfaceVariant, letterSpacing: 1.5, marginBottom: 5 },
  coordValue: { fontFamily: Theme.fonts.headline, fontSize: 13, color: Theme.colors.onSurface },
  actionsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22, paddingHorizontal: 4 },
  actionItem: { alignItems: 'center', gap: 8 },
  actionIconBox: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
  },
  actionLabel: { fontFamily: Theme.fonts.label, fontSize: 10, color: Theme.colors.onSurface, fontWeight: 'bold', letterSpacing: 1.5 },
  bannerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginBottom: 8 },
  bannerText: { fontFamily: Theme.fonts.body, fontSize: 13, color: Theme.colors.onSurface, flex: 1 },
  hubsSection: { marginTop: 6 },
  hubsRow: { gap: 12, paddingBottom: 8, paddingRight: 20 },
  scanningCard: { paddingVertical: 30, alignItems: 'center', gap: 12 },
  scanningText: { fontFamily: Theme.fonts.label, color: Theme.colors.onSurfaceVariant, fontSize: 12 },
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    gap: 16,
  },
  loaderText: { fontFamily: Theme.fonts.headline, color: Theme.colors.primary, letterSpacing: 4, fontSize: 14 },
});
