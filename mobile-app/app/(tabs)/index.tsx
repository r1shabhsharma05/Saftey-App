import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
  AppState,
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
import { ensureProfile } from '../../utils/auth';
import { getBackendUrl } from '../../utils/backendUrl';
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

// Backend URL comes from EXPO_PUBLIC_BACKEND_URL (see .env.example).
// Resolved eagerly: a missing/insecure URL throws a clear config error at
// screen load instead of silently falling back to plaintext HTTP.
const BACKEND_URL = getBackendUrl();

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
  // Ref mirror of cachedSafePlaces: the location-watch callback chain
  // closes over first-render state, so the 3-minute refresh check read
  // a forever-stale [] and refetched on the 30s cadence all session.
  const cachedPlacesRef = useRef<any[]>([]);
  const updateCachedPlaces = (places: any[]) => {
    cachedPlacesRef.current = places;
    setCachedSafePlaces(places);
  };
  // Double-tap guard for SOS (see sendSOSAlert).
  const sosInFlightRef = useRef(false);
  // Drives the Safe Hubs card: without it a failed Overpass fetch left the
  // "Scanning…" spinner on screen forever.
  const [safePlacesState, setSafePlacesState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  // Styled in-app SOS feedback. SOS results used to surface through
  // raw system Alert.alert dialogs — grey, unstyled, and with a
  // misleading "check the backend URL" message on any network hiccup.
  const [sosBanner, setSosBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBanner = (kind: 'success' | 'error', text: string) => {
    setSosBanner({ kind, text });
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    if (kind === 'success') {
      bannerTimer.current = setTimeout(() => setSosBanner(null), 7000);
    }
  };
  const [locationError, setLocationError] = useState<string | null>(null);
  const lastFetchTime = useRef<number>(0);
  const locSubRef = useRef<Location.LocationSubscription | null>(null);
  const batSubRef = useRef<{ remove: () => void } | null>(null);

  // --- Animations ---
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sosScale = useRef(new Animated.Value(1)).current;

  // --- Effects ---
  useEffect(() => {
    const setupSubscriptions = async () => {
      try {
        // Instant offline loading — parsed in its OWN try: this sits
        // inside the one big setup try, and a corrupt cache value used
        // to throw here and silently skip everything after it (battery,
        // profile, and the location watch — no GPS fix, SOS blocked).
        try {
          const offlineCache = await AsyncStorage.getItem('safePlacesCache');
          if (offlineCache) {
            const parsedCache = JSON.parse(offlineCache);
            if (Array.isArray(parsedCache)) updateCachedPlaces(parsedCache);
          }
        } catch {
          /* cache is best-effort */
        }

        // (a) Seed coordinates from the last cached fix so the Live
        // Location card never sits on 'Loading...' when GPS is slow —
        // and SOS can still send with the last known position.
        try {
          const cachedCoords = await AsyncStorage.getItem('lastCoords');
          if (cachedCoords) {
            const parsed = JSON.parse(cachedCoords);
            if (typeof parsed?.latitude === 'number' && typeof parsed?.longitude === 'number') {
              applyCoords({
                latitude: parsed.latitude,
                longitude: parsed.longitude,
                speed: typeof parsed.speed === 'number' ? parsed.speed : null,
              });
            }
          }
        } catch {
          /* cache is best-effort */
        }

        const level = await Battery.getBatteryLevelAsync();
        setBatteryLevel(Math.round(level * 100));

        batSubRef.current = Battery.addBatteryLevelListener(({ batteryLevel }) => {
          setBatteryLevel(Math.round(batteryLevel * 100));
        });

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          // Users who signed up before the profiles flow existed may
          // have no row — create it from auth metadata before selecting.
          await ensureProfile(user);
          const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
          if (data) setUserData(data);
        }

        await startLocationWatch();
      } catch (err) {
        console.log('Setup error:', err);
      }
    };

    setupSubscriptions();

    // Deliver any SOS that was queued while the network was down —
    // on launch and every time the app returns to the foreground.
    flushPendingSOS();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushPendingSOS();
    });

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      locSubRef.current?.remove();
      batSubRef.current?.remove();
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCoords = (coords: { latitude: number; longitude: number; speed?: number | null }) => {
    const currentLat = coords.latitude.toFixed(6);
    const currentLng = coords.longitude.toFixed(6);
    setLat(currentLat);
    setLng(currentLng);
    setIsMoving(coords.speed != null && coords.speed > 0.5);
    // Persist every fix so the next cold start can seed instantly.
    AsyncStorage.setItem(
      'lastCoords',
      JSON.stringify({
        latitude: coords.latitude,
        longitude: coords.longitude,
        speed: coords.speed ?? null,
        timestamp: Date.now(),
      })
    ).catch(() => {});
    fetchSafePlacesCache(currentLat, currentLng);
  };

  const updateLocationData = (location: Location.LocationObject) => {
    applyCoords(location.coords);
  };

  /**
   * Location strategy: permission → last-known fix → fresh fix raced
   * against a 12s timeout → live watch. The watch starts even if the
   * first fixes fail, so a late GPS lock still lands. Failures are
   * logged (never fatal) and permission problems surface via
   * `locationError` in the Live Location card.
   */
  const startLocationWatch = async () => {
    const { status: permissionStatus, canAskAgain } = await Location.requestForegroundPermissionsAsync();
    if (permissionStatus !== 'granted') {
      setLocationError(
        canAskAgain
          ? 'Location permission is off. SafeLife needs your location for SOS alerts and nearby safe places.'
          : 'Location permission is permanently off. Enable it for SafeLife in Settings to use SOS.'
      );
      return;
    }
    setLocationError(null);

    // (b) Last-known fix — usually instant, may be stale.
    try {
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (lastKnown) updateLocationData(lastKnown);
    } catch (err) {
      console.log('Last-known position failed:', err);
    }

    // (c) Fresh fix, raced against a 12s timeout so a hung GPS chip
    // can't block the rest of setup.
    try {
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
      ]);
      if (fresh) updateLocationData(fresh);
    } catch (err) {
      console.log('Current position failed:', err);
    }

    // (d) Live watch — starts regardless of whether a fix landed yet.
    try {
      locSubRef.current?.remove();
      locSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 50 },
        (loc) => updateLocationData(loc)
      );
    } catch (err) {
      console.log('Watch position failed:', err);
    }
  };

  const handleEnableLocation = async () => {
    const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted' && !canAskAgain) {
      // Permanently denied — the in-app prompt can't be shown again.
      Linking.openSettings();
      return;
    }
    await startLocationWatch();
  };

  const fetchSafePlacesCache = async (lat: string, lng: string, force = false) => {
    const now = Date.now();

    // Prevent API spam bans: 30s cooldown, 3min refresh when data exists.
    // `force` (the Retry button) bypasses the cooldown on user demand.
    if (!force && now - lastFetchTime.current < 30000) return;
    if (!force && now - lastFetchTime.current < 180000 && cachedPlacesRef.current.length > 0) return;

    lastFetchTime.current = now;
    setSafePlacesState('loading');

    try {
      const query = `[out:json];(nwr["amenity"="police"](around:50000,${lat},${lng});nwr["amenity"~"hospital|clinic|mall|cafe|bank|pharmacy|university|college"](around:10000,${lat},${lng});nwr["tourism"~"hostel|hotel"](around:10000,${lat},${lng});nwr["shop"~"mall|supermarket|department_store"](around:10000,${lat},${lng}););out center;`;
      // First try our own backend's /safe-places proxy: it runs the
      // Overpass query server-side (fast region, cached, bounded
      // timeouts) and returns the same JSON shape — a phone on flaky
      // data gets one small fast response instead of wrestling
      // Overpass directly. The direct endpoints stay as fallback.
      const urls = [
        `${BACKEND_URL}/safe-places?lat=${lat}&lng=${lng}`,
        `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`,
        `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`,
      ];
      let data: any = null;
      let lastErr: any = null;
      for (const url of urls) {
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), 25000);
          const response = await fetch(url, {
            signal: controller.signal,
          });
          clearTimeout(t);
          if (!response.ok) throw new Error(`Places HTTP ${response.status}`);
          data = await response.json();
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!data) throw lastErr || new Error('Places unreachable');

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

        updateCachedPlaces(parsedPlaces);
        setSafePlacesState(parsedPlaces.length > 0 ? 'ready' : 'empty');
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
        setSafePlacesState('empty');
        setNearestStation('No station found in 3km');
      }
    } catch (err) {
      setSafePlacesState('error');
      setNearestStation('Station data unavailable');
    }
  };

  // One SOS POST with a hard timeout. Resolves true only when the
  // backend confirms Telegram delivery — never on a blind 200.
  const postAlertOnce = async (payload: Record<string, unknown>): Promise<boolean> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${BACKEND_URL}/alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Backend API-key auth: required on /alert when the backend's
          // API_SECRET is set. Send the header only when a key exists —
          // an empty-string header is a device-stack-only variable
          // (RN fetch → OkHttp) that curl tests cannot replicate.
          ...(process.env.EXPO_PUBLIC_API_SECRET
            ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      return !!(data && data.success);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  // An SOS must be stubborn: one failed attempt on a flaky mobile link
  // used to be the end of it (the old code gave up after a single try
  // and showed a grey system dialog). Three attempts with backoff —
  // then the caller queues the alert for auto-delivery.
  const postAlertWithRetry = async (payload: Record<string, unknown>): Promise<boolean> => {
    const delays = [0, 2500, 7000];
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (await postAlertOnce(payload)) return true;
    }
    return false;
  };

  // Send a previously queued SOS (stored when every retry failed).
  const flushPendingSOS = async () => {
    try {
      const raw = await AsyncStorage.getItem('pendingSOS');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // A queued alert older than a day is history, not an emergency —
      // drop it instead of retrying it on every foreground forever.
      if (parsed && Date.now() - (parsed.queuedAt || 0) > 24 * 60 * 60 * 1000) {
        await AsyncStorage.removeItem('pendingSOS');
        return;
      }
      if (parsed && parsed.payload && (await postAlertOnce(parsed.payload))) {
        await AsyncStorage.removeItem('pendingSOS');
        showBanner('success', 'Queued SOS delivered — your earlier alert just reached SafeLife on Telegram.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      /* the queue is best-effort */
    }
  };

  // SMS needs no data connection at all — the last-resort channel when
  // the network is down. Opens the user's SMS app with the SOS text
  // prefilled; they pick a contact and hit send.
  const sendSOSviaSMS = () => {
    const who = userData ? `${userData.first_name} ${userData.last_name}` : 'a SafeLife user';
    const text =
      `SOS! I need help. I am ${who}. My location: ` +
      `https://maps.google.com/?q=${lat},${lng} (battery ${batteryLevel}%) — sent from SafeLife`;
    Linking.openURL(`sms:?&body=${encodeURIComponent(text)}`).catch(() => {});
  };

  const sendSOSAlert = async () => {
    // In-flight guard: a double-tap (or a tap during the press
    // animation) used to launch concurrent POSTs — the duplicate could
    // hit the backend rate limiter and report failure for an SOS that
    // actually went through.
    if (sosInFlightRef.current) return;
    sosInFlightRef.current = true;
    // Block only when NO coordinates exist at all — neither a live fix
    // nor a cached one (lat/lng stay 'Loading...' only in that case).
    // Never send placeholder strings: the backend rejects non-numeric
    // coordinates with a 400.
    if (lat === 'Loading...' || lng === 'Loading...' || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
      sosInFlightRef.current = false;
      showBanner('error', 'No location fix yet — SafeLife needs your GPS position for an SOS. Enable GPS / location permission and try again.');
      return;
    }
    setIsLoading(true);
    setStatus('ALERT ACTIVE');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    // Emergency contacts picked in the Contacts tab (cached locally at
    // save time) ride along with every SOS so the backend can list them
    // in the alert message.
    let sosContacts: { name: string; phone: string }[] = [];
    try {
      const rawContacts = await AsyncStorage.getItem('emergencyContacts');
      if (rawContacts) {
        const parsed = JSON.parse(rawContacts);
        if (Array.isArray(parsed)) {
          sosContacts = parsed
            .filter((c) => c && typeof c.phone === 'string' && c.phone.trim() !== '')
            .slice(0, 10)
            .map((c) => ({ name: typeof c.name === 'string' ? c.name : '', phone: c.phone }));
        }
      }
    } catch {
      /* contacts are an optional part of the payload */
    }

    const payload = {
      lat,
      lng,
      name: userData ? `${userData.first_name} ${userData.last_name}` : 'Unknown User',
      phone: userData ? userData.phone : 'Not Provided',
      battery: batteryLevel,
      status: isMoving ? 'Moving' : 'Stationary',
      nearestStation,
      contacts: sosContacts,
    };

    try {
      const delivered = await postAlertWithRetry(payload);
      if (delivered) {
        // Success needs no dialog: the screen switches to the ALERT
        // ACTIVE view, which is the confirmation.
        await AsyncStorage.removeItem('pendingSOS').catch(() => {});
      } else {
        // Queue it — flushPendingSOS auto-sends when connectivity
        // returns — and tell the user honestly, with an SMS escape
        // hatch that works with zero data connection.
        await AsyncStorage.setItem(
          'pendingSOS',
          JSON.stringify({ payload, queuedAt: Date.now() })
        ).catch(() => {});
        setStatus('SAFE');
        showBanner(
          'error',
          'SOS could not be delivered — the connection failed. It is queued and will auto-send when the network returns, or send it by SMS now.'
        );
      }
    } finally {
      sosInFlightRef.current = false;
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
        message: `SafeLife — my live location: https://maps.google.com/?q=${lat},${lng}`,
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
            <Text style={styles.brandTitle}>SafeLife</Text>
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

        {/* SOS feedback banner — styled, in-app, honest. Replaces the
            old raw system dialogs for SOS results. */}
        {sosBanner && (
          <View style={[styles.sosBanner, sosBanner.kind === 'success' ? styles.sosBannerSuccess : styles.sosBannerError]}>
            <Text style={styles.sosBannerText}>{sosBanner.text}</Text>
            {sosBanner.kind === 'error' ? (
              <View style={styles.sosBannerActions}>
                <TouchableOpacity
                  onPress={() => {
                    setSosBanner(null);
                    sendSOSAlert();
                  }}
                >
                  <Text style={styles.sosBannerAction}>RETRY</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={sendSOSviaSMS}>
                  <Text style={styles.sosBannerAction}>SEND VIA SMS</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSosBanner(null)}>
                  <Text style={styles.sosBannerAction}>DISMISS</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.sosBannerActions}>
                <TouchableOpacity onPress={() => setSosBanner(null)}>
                  <Text style={styles.sosBannerAction}>OK</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

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
            {locationError && (
              <View style={styles.locationErrorBox}>
                <View style={styles.locationErrorRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={Theme.colors.error} />
                  <Text style={styles.locationErrorText}>{locationError}</Text>
                </View>
                <TouchableOpacity
                  style={styles.enableLocationBtn}
                  onPress={handleEnableLocation}
                  activeOpacity={0.8}
                >
                  <Ionicons name="location-outline" size={14} color={Theme.colors.primary} />
                  <Text style={styles.enableLocationText}>ENABLE LOCATION</Text>
                </TouchableOpacity>
              </View>
            )}
          </GlassCard>
        </Reanimated.View>

        {/* Quick actions */}
        <Reanimated.View entering={FadeInUp.delay(260).duration(500)} style={styles.actionsGrid}>
          {[
            { icon: 'call', label: 'CALL', action: () => Linking.openURL('tel:112') },
            { icon: 'share-social', label: 'SHARE', action: handleShareLocation },
            {
              icon: 'map',
              label: 'MAP',
              action: () => {
                // Guard like SHARE has: without a GPS fix this used to
                // open Maps at "Loading...,Loading...".
                if (lat === 'Loading...' || lng === 'Loading...') {
                  showBanner('error', 'Waiting for a GPS fix before opening the map.');
                  return;
                }
                Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`);
              },
            },
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
            ) : safePlacesState === 'error' || safePlacesState === 'empty' ? (
              <GlassCard style={styles.scanningCard}>
                <Text style={styles.scanningText}>
                  {safePlacesState === 'error'
                    ? 'Safe areas could not be loaded. Check your internet connection.'
                    : 'No safe areas found within 10km.'}
                </Text>
                <TouchableOpacity
                  onPress={() => fetchSafePlacesCache(lat, lng, true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </GlassCard>
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
  locationErrorBox: {
    marginTop: 14,
    backgroundColor: 'rgba(245, 51, 53, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245, 51, 53, 0.25)',
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  locationErrorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  locationErrorText: { flex: 1, fontFamily: Theme.fonts.body, fontSize: 12, lineHeight: 17, color: Theme.colors.onSurface },
  enableLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.35)',
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
  },
  enableLocationText: { fontFamily: Theme.fonts.label, fontSize: 10, letterSpacing: 1.5, color: Theme.colors.primary },
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
  retryText: { fontFamily: Theme.fonts.label, color: Theme.colors.primary, fontSize: 13, letterSpacing: 1 },
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    gap: 16,
  },
  loaderText: { fontFamily: Theme.fonts.headline, color: Theme.colors.primary, letterSpacing: 4, fontSize: 14 },
  sosBanner: { borderRadius: 16, padding: 14, marginBottom: 14, borderWidth: 1 },
  sosBannerSuccess: { backgroundColor: 'rgba(46, 204, 140, 0.13)', borderColor: 'rgba(46, 204, 140, 0.5)' },
  sosBannerError: { backgroundColor: 'rgba(255, 113, 108, 0.12)', borderColor: 'rgba(255, 113, 108, 0.5)' },
  sosBannerText: { fontFamily: Theme.fonts.body, fontSize: 13, lineHeight: 18, color: Theme.colors.onSurface },
  sosBannerActions: { flexDirection: 'row', gap: 18, marginTop: 10 },
  sosBannerAction: { fontFamily: Theme.fonts.label, fontSize: 12, letterSpacing: 1, color: Theme.colors.primary, fontWeight: 'bold' },
});
