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
import NetInfo from '@react-native-community/netinfo';
import { secureGetItem, secureSetItem, secureRemoveItem } from '../../utils/secureStorage';
import AlertActiveView from '../../components/AlertActiveView';
import { rankSafePlaces, calculateBearing, calculateDistance, getCardinalDirection, withSafety, isValidSafety, scoreRouteLocal, combineRouteSafety, sanitizePhone } from '../../utils/escapeLogic';
import type { SafePlace, SafetyScore } from '../../utils/escapeLogic';
import JourneyCard from '../../components/JourneyCard';
import {
  JOURNEY_STORAGE_KEY,
  buildShareText,
  answerCheckIn,
  createJourney,
  endJourney,
  fetchJourney,
  postJourneyLocation,
  type Journey,
} from '../../utils/journey';
import { decideBatteryAlert, BATTERY_LOW_THRESHOLD, BATTERY_FINAL_THRESHOLD, BATTERY_REARM_LEVEL } from '../../utils/batteryAlerts';
import ScreenBackground from '../../components/ui/ScreenBackground';
import GlassCard from '../../components/ui/GlassCard';
import TiltCard from '../../components/ui/TiltCard';
import StatusPill from '../../components/ui/StatusPill';
import SectionHeader from '../../components/ui/SectionHeader';
import SafeHubCard from '../../components/ui/SafeHubCard';
import PoliceStationCard from '../../components/ui/PoliceStationCard';
import RouteMap from '../../components/RouteMap';

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
  // D11: charging state gates battery alerts (a plugged-in phone at
  // 10% is not dying). null = the OS cannot say; unknown never blocks.
  const [batteryCharging, setBatteryCharging] = useState<boolean | null>(null);
  // Ref mirrors for the battery-alert effect and queue flushes, whose
  // callbacks close over stale state: the level/state/status mirrors
  // stay current between renders.
  const batteryLevelRef = useRef(0);
  const batteryChargingRef = useRef<boolean | null>(null);
  // expo-battery returns -1 where the level is unknowable; the state
  // clamps that to 0 (pre-existing SOS behaviour), so D11 gates on
  // this flag instead of trusting 0% as a real reading.
  const batteryKnownRef = useRef(false);
  const statusRef = useRef<'SAFE' | 'ALERT ACTIVE'>('SAFE');
  const activeAlertIdRef = useRef<string | null>(null);
  const latRef = useRef('Loading...');
  const lngRef = useRef('Loading...');
  // D11 dedupe: low warning sent once per discharge cycle (persisted
  // so a restart at 12% does not re-warn); final burst sent once per
  // active alert (in-memory — an alert lives in one session).
  const lowBatterySentRef = useRef(false);
  const finalBurstSentRef = useRef<string | null>(null);
  const batteryAlertInFlightRef = useRef(false);
  // Drives the one final-burst line in AlertActiveView: sent, failed,
  // or null (no burst attempted yet / no alert active).
  const [batteryFinalStatus, setBatteryFinalStatus] = useState<'sent' | 'failed' | null>(null);
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
    // D15: every place carries a safety score — restored pre-D15 cache
    // entries (no safety yet) get a local one; valid scores pass through.
    // (M3) Phones are revalidated on restore too: a cached place from
    // before the allowlist (or a tampered cache) must not reach tel:.
    const scored = places.map((p) => withSafety({ ...p, phone: sanitizePhone(p.phone) }));
    cachedPlacesRef.current = scored;
    setCachedSafePlaces(scored);
  };
  // Double-tap guard for SOS (see sendSOSAlert).
  const sosInFlightRef = useRef(false);
  // Last live-tracking update sent to the backend (F2): position +
  // timestamp, so updates go out on movement, not on every GPS tick.
  const lastTrackRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
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
  // D5 outbox hardening — what the D4 engine returns for one SOS:
  // `reached` (the server accepted the alert, even on total delivery
  // failure) vs a transport failure (the alert never left the phone).
  // The distinction decides whether the phone may re-send: a reached
  // alert is server-owned (its QStash retry is the server's job), so
  // re-POSTing it would create a duplicate SOS. Only a never-reached
  // alert goes into the local queue.
  type AlertPostResult = {
    reached: boolean;
    success: boolean;
    alertId: string | null;
    delivery: any[] | null;
    retry: { queued?: boolean; reason?: string } | null;
  };
  type QueuedSOS = {
    payload: Record<string, unknown>;
    queuedAt: number;
    attempts: number;
    nextRetryAt: number;
  };
  // Local-queue backoff between flush attempts (30s → 2m → 5m → 15m,
  // capped): the queue must not hammer a flaky link, and a flush
  // attempt is only meaningful when connectivity has returned.
  const QUEUE_BACKOFF_MS = [30000, 120000, 300000, 900000];
  // The alert the delivery-status UI polls (D4 GET /alert/:id) and the
  // receipts it shows. Null until an SOS has reached the server.
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [deliveryReceipts, setDeliveryReceipts] = useState<any[] | null>(null);
  // D10: distinct contact confirmations + escalation schedule/runs,
  // polled with the receipts — the victim sees whether anyone has
  // confirmed and whether the ladder is still running.
  const [ackCount, setAckCount] = useState<number>(0);
  const [escalation, setEscalation] = useState<any | null>(null);
  // D16: Journey Guardian — the active trip, or null. journeyRef
  // mirrors it for the location effect, whose callback closes over
  // stale state; journeyViewUrl is the signed share link returned
  // at create time (persisted with the id so sharing survives a
  // restart); journeyDistanceM is the live distance to the
  // destination, recomputed on each posted position.
  const [journey, setJourney] = useState<Journey | null>(null);
  const [journeyBusy, setJourneyBusy] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [journeyViewUrl, setJourneyViewUrl] = useState<string | null>(null);
  const [journeyDistanceM, setJourneyDistanceM] = useState<number | null>(null);
  const journeyRef = useRef<Journey | null>(null);
  const lastJourneyTrackRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  // D14: in-app walking route to the nearest-best safe place (OSRM via
  // GET /route). routeKeyRef rounds the position to ~100 m so the route
  // refetches only when the user actually moves, not on every GPS tick;
  // routeInFlightRef stops a GPS tick mid-fetch from launching a second
  // identical request.
  const [route, setRoute] = useState<{ coordinates: [number, number][]; distanceM: number; durationS: number; safety?: SafetyScore } | null>(null);
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const routeKeyRef = useRef('');
  const routeInFlightRef = useRef(false);
  // Whether a never-reached SOS sits in the local queue — drives the
  // persistent "SOS queued" pill (a dismissed banner must not hide
  // that an SOS is still unsent).
  const [queuedSOS, setQueuedSOS] = useState(false);
  // NetInfo + AppState can fire flushes at the same moment; without
  // this guard the same queued SOS would be POSTed twice.
  const flushInFlightRef = useRef(false);
  const lastFetchTime = useRef<number>(0);
  const locSubRef = useRef<Location.LocationSubscription | null>(null);
  const batSubRef = useRef<{ remove: () => void } | null>(null);
  const batStateSubRef = useRef<{ remove: () => void } | null>(null);

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

        // getBatteryLevelAsync returns -1 on devices/emulators where
        // the battery API is unsupported — Math.round(-1 * 100) put
        // "Battery: -100%" into SOS messages. Clamp unknowns to 0.
        const level = await Battery.getBatteryLevelAsync();
        batteryKnownRef.current = level >= 0;
        setBatteryLevel(level >= 0 ? Math.round(level * 100) : 0);

        batSubRef.current = Battery.addBatteryLevelListener(({ batteryLevel }) => {
          batteryKnownRef.current = batteryLevel >= 0;
          setBatteryLevel(batteryLevel >= 0 ? Math.round(batteryLevel * 100) : 0);
        });

        // D11: charging state (gates battery alerts) + the persisted
        // low-warning flag. A level already above the re-arm line
        // clears a stale flag left by an earlier discharge cycle.
        const toCharging = (s: Battery.BatteryState): boolean | null =>
          s === Battery.BatteryState.CHARGING || s === Battery.BatteryState.FULL
            ? true
            : s === Battery.BatteryState.UNPLUGGED
              ? false
              : null;
        const state = await Battery.getBatteryStateAsync();
        setBatteryCharging(toCharging(state));
        batStateSubRef.current = Battery.addBatteryStateListener(({ batteryState }) => {
          setBatteryCharging(toCharging(batteryState));
        });
        try {
          const lowSent = await AsyncStorage.getItem('batteryLowAlertSent');
          lowBatterySentRef.current = lowSent === '1' && level >= 0 && Math.round(level * 100) <= BATTERY_REARM_LEVEL;
          if (lowSent === '1' && lowBatterySentRef.current === false) {
            await AsyncStorage.removeItem('batteryLowAlertSent');
          }
        } catch {
          /* flag is best-effort */
        }

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
    flushPendingBatteryAlert();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        flushPendingSOS();
        flushPendingBatteryAlert();
      }
    });
    // D5 net-state awareness: flush the moment connectivity returns,
    // instead of only on foreground — and never attempt a flush while
    // offline (flushPendingSOS itself still backoff-gates each try).
    // The listener also fires once immediately with the current state.
    const netInfoSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        flushPendingSOS();
        flushPendingBatteryAlert();
      }
    });
    // Seed the queued pill from storage: a queued SOS must stay
    // visible across restarts until it is delivered or expires.
    secureGetItem('pendingSOS')
      .then((raw) => setQueuedSOS(!!raw))
      .catch(() => {});

    // D16: restore an in-progress journey across restarts. The
    // server is the source of truth: a journey the server reports
    // finished (or unknown) clears the stored id instead of showing
    // a trip that is over.
    secureGetItem(JOURNEY_STORAGE_KEY)
      .then(async (raw) => {
        try {
          const stored = raw ? JSON.parse(raw) : null;
          if (!stored || typeof stored.id !== 'string') return;
          const live = await fetchJourney(BACKEND_URL, stored.id);
          if (live && live.state === 'active') {
            setJourney(live);
            setJourneyViewUrl(typeof stored.viewUrl === 'string' ? stored.viewUrl : null);
          } else {
            await secureRemoveItem(JOURNEY_STORAGE_KEY).catch(() => {});
          }
        } catch {
          /* restore is best-effort */
        }
      })
      .catch(() => {});

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      locSubRef.current?.remove();
      batSubRef.current?.remove();
      batStateSubRef.current?.remove();
      appStateSub.remove();
      netInfoSub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ref mirrors for battery-alert checks and queue flushes (see the
  // D11 refs above): kept current by this effect, read by callbacks
  // that would otherwise close over stale state.
  useEffect(() => {
    batteryLevelRef.current = batteryLevel;
    batteryChargingRef.current = batteryCharging;
    statusRef.current = status;
    activeAlertIdRef.current = activeAlertId;
    latRef.current = lat;
    lngRef.current = lng;
    journeyRef.current = journey;
  }, [batteryLevel, batteryCharging, status, activeAlertId, lat, lng, journey]);

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
      const query = `[out:json];(nwr["amenity"="police"](around:20000,${lat},${lng});nwr["amenity"~"hospital|clinic|mall|cafe|bank|pharmacy|university|college"](around:10000,${lat},${lng});nwr["tourism"~"hostel|hotel"](around:10000,${lat},${lng});nwr["shop"~"mall|supermarket|department_store"](around:10000,${lat},${lng}););out center;`;
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
          else if (tourism.includes('hostel') || tourism.includes('hotel') || name.includes('hostel')) category = 'hostel';
          else if (amenity.includes('mall') || amenity.includes('cafe') || amenity.includes('bank') || amenity.includes('pharmacy') || shop !== '') category = 'crowd';

          const pLat = el.lat || el.center?.lat;
          const pLng = el.lon || el.center?.lon;
          // D15: the backend annotates distanceKm/openNow/safety; the
          // direct-Overpass fallback has none of them, so distance is
          // computed here and openNow stays unknown (never guessed).
          const distanceKm =
            typeof el.distanceKm === 'number' && Number.isFinite(el.distanceKm)
              ? el.distanceKm
              : Math.round((calculateDistance(parseFloat(lat), parseFloat(lng), pLat, pLng) / 1000) * 100) / 100;
          const openNow = typeof el.openNow === 'boolean' ? el.openNow : null;
          return withSafety({
            id: el.id,
            lat: pLat,
            lng: pLng,
            name: el.tags?.name || category.toUpperCase(),
            // (M3) OSM phone is crowd-edited text — allowlisted here,
            // never passed raw to tel:.
            phone: sanitizePhone(el.tags?.phone || el.tags?.['contact:phone']),
            category,
            distanceKm,
            openNow,
            safety: isValidSafety(el.safety) ? el.safety : undefined,
          });
        }).filter((p: any) => p.lat && p.lng);

        updateCachedPlaces(parsedPlaces);
        setSafePlacesState(parsedPlaces.length > 0 ? 'ready' : 'empty');
        AsyncStorage.setItem('safePlacesCache', JSON.stringify(parsedPlaces));

        // Nearest by actual distance from the user. Overpass returns
        // elements in arbitrary order, so taking [0] named farther
        // stations "nearest" in the SOS Telegram message.
        const rankedAll = rankSafePlaces(parsedPlaces, parseFloat(lat), parseFloat(lng));
        const rankedPolice = rankedAll.filter((p) => p.category === 'police');
        if (rankedPolice.length > 0) {
          setNearestStation(rankedPolice[0].name || 'Police Station Nearby');
        } else if (rankedAll.length > 0) {
          setNearestStation(rankedAll[0].name || 'Safe Zone Nearby');
        } else {
          setNearestStation('No station found nearby');
        }
      } else {
        setSafePlacesState('empty');
        setNearestStation('No station found nearby');
      }
    } catch (err) {
      setSafePlacesState('error');
      setNearestStation('Station data unavailable');
    }
  };

  // One SOS POST with a hard timeout. Returns the full server answer,
  // not just a boolean — D5 needs the alertId and delivery receipts
  // for the status UI, and the reached/success split for the queue:
  // a 502 still carries alertId + receipts (the server owns that
  // alert and its retry), while a transport failure carries nothing
  // (the alert never left the phone). Success is still only ever
  // claimed on the backend's own success flag — never on a blind 200.
  // (H2) `reached` means the server OWNS this alert: a success flag,
  // an alert id, or a queued retry. A JSON error reply with none of
  // those (400/401/429/503) is NOT reached — the alert stays queued
  // and is re-sent later instead of being silently dropped.
  const postAlertOnce = async (payload: Record<string, unknown>): Promise<AlertPostResult> => {
    const notReached: AlertPostResult = { reached: false, success: false, alertId: null, delivery: null, retry: null };
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
      if (!data) return notReached;
      const alertId = typeof data.alertId === 'string' ? data.alertId : null;
      const retry = data.retry && typeof data.retry === 'object' ? data.retry : null;
      if (!data.success && !alertId && retry?.queued !== true) return notReached;
      return {
        reached: true,
        success: !!data.success,
        alertId,
        delivery: Array.isArray(data.delivery) ? data.delivery : null,
        retry,
      };
    } catch {
      return notReached;
    } finally {
      clearTimeout(timeout);
    }
  };

  // An SOS must be stubborn: one failed attempt on a flaky mobile link
  // used to be the end of it (the old code gave up after a single try
  // and showed a grey system dialog). Three attempts with backoff —
  // then the caller decides (queue vs server-owned) from the result.
  // Returns the first success, else the last attempt's result, so a
  // reached-but-failed alert is never mistaken for a transport failure.
  const postAlertWithRetry = async (payload: Record<string, unknown>): Promise<AlertPostResult> => {
    const delays = [0, 2500, 7000];
    let last: AlertPostResult = { reached: false, success: false, alertId: null, delivery: null, retry: null };
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      last = await postAlertOnce(payload);
      if (last.success) return last;
    }
    return last;
  };

  // Emergency contacts cached locally at save time in the Contacts
  // tab — the same list rides every SOS and every battery alert.
  const readEmergencyContacts = async (): Promise<{ name: string; phone: string }[]> => {
    try {
      const rawContacts = await AsyncStorage.getItem('emergencyContacts');
      if (!rawContacts) return [];
      const parsed = JSON.parse(rawContacts);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((c) => c && typeof c.phone === 'string' && c.phone.trim() !== '')
        .slice(0, 10)
        .map((c) => ({ name: typeof c.name === 'string' ? c.name : '', phone: c.phone }));
    } catch {
      /* contacts are an optional part of the payload */
      return [];
    }
  };

  // One battery-alert POST with a hard timeout, mirroring
  // postAlertOnce. Reached means the server answered (even with a
  // 502 — the fan-out was attempted); only a transport failure
  // means the alert never left the phone.
  const postBatteryAlertOnce = async (
    payload: Record<string, unknown>
  ): Promise<{ reached: boolean; success: boolean }> => {
    const notReached = { reached: false, success: false };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${BACKEND_URL}/battery-alert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EXPO_PUBLIC_API_SECRET
            ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!data) return notReached;
      return { reached: true, success: !!data.success };
    } catch {
      return notReached;
    } finally {
      clearTimeout(timeout);
    }
  };

  // D11: send one battery alert (low warning or final burst). A
  // failure queues it as pendingBatteryAlert — unlike an SOS, a
  // battery alert has no server-side retry, so the phone must
  // re-attempt it when connectivity returns (flushPendingBatteryAlert
  // re-checks freshness first; a stale warning is dropped, never sent).
  const sendBatteryAlert = async (kind: 'low' | 'final'): Promise<void> => {
    if (batteryAlertInFlightRef.current) return;
    if (lat === 'Loading...' || lng === 'Loading...' || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) return;
    batteryAlertInFlightRef.current = true;
    try {
      const contacts = await readEmergencyContacts();
      const payload: Record<string, unknown> = {
        kind,
        lat,
        lng,
        name: userData ? `${userData.first_name} ${userData.last_name}` : 'Unknown User',
        phone: userData ? userData.phone : 'Not Provided',
        battery: batteryLevel,
        contacts,
        ...(kind === 'final' && activeAlertId ? { alertId: activeAlertId } : {}),
      };
      const result = await postBatteryAlertOnce(payload);
      if (result.success) {
        await AsyncStorage.removeItem('pendingBatteryAlert').catch(() => {});
        if (kind === 'low') {
          lowBatterySentRef.current = true;
          await AsyncStorage.setItem('batteryLowAlertSent', '1').catch(() => {});
          showBanner('success', 'Low-battery alert sent to your emergency contacts with your last location.');
        } else {
          finalBurstSentRef.current = activeAlertId;
          setBatteryFinalStatus('sent');
        }
      } else {
        await AsyncStorage.setItem(
          'pendingBatteryAlert',
          JSON.stringify({ payload, queuedAt: Date.now(), nextRetryAt: Date.now() })
        ).catch(() => {});
        if (kind === 'low') {
          showBanner('error', 'Low-battery alert could not be delivered — it is queued and will retry when the network returns.');
        } else {
          setBatteryFinalStatus('failed');
        }
      }
    } finally {
      batteryAlertInFlightRef.current = false;
    }
  };

  // Retry a queued battery alert when connectivity returns. Freshness
  // is re-checked against live refs before sending: a low warning
  // whose phone has since charged, or a final burst whose alert has
  // ended, is dropped as stale history. A still-valid failure is
  // kept with a 5-minute backoff; anything older than 6 hours is
  // dropped (a battery warning that old describes a dead phone).
  const flushPendingBatteryAlert = async (force = false): Promise<void> => {
    try {
      const raw = await AsyncStorage.getItem('pendingBatteryAlert');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const drop = async () => {
        await AsyncStorage.removeItem('pendingBatteryAlert').catch(() => {});
      };
      if (!parsed || !parsed.payload || Date.now() - (parsed.queuedAt || 0) > 6 * 60 * 60 * 1000) {
        await drop();
        return;
      }
      if (!force && Date.now() < (parsed.nextRetryAt || 0)) return;
      const p = parsed.payload;
      if (p.kind === 'low') {
        if (
          !batteryKnownRef.current ||
          batteryLevelRef.current > BATTERY_LOW_THRESHOLD ||
          batteryChargingRef.current === true ||
          lowBatterySentRef.current
        ) {
          await drop();
          return;
        }
      } else if (p.kind === 'final') {
        if (
          !batteryKnownRef.current ||
          statusRef.current !== 'ALERT ACTIVE' ||
          p.alertId !== activeAlertIdRef.current ||
          batteryLevelRef.current > BATTERY_FINAL_THRESHOLD ||
          finalBurstSentRef.current === p.alertId
        ) {
          await drop();
          return;
        }
      } else {
        await drop();
        return;
      }
      // Refresh position/battery from live refs when a fix exists;
      // otherwise keep the stored trigger-time values.
      const fresh = { ...p };
      if (
        latRef.current !== 'Loading...' &&
        lngRef.current !== 'Loading...' &&
        !isNaN(parseFloat(latRef.current)) &&
        !isNaN(parseFloat(lngRef.current))
      ) {
        fresh.lat = latRef.current;
        fresh.lng = lngRef.current;
      }
      fresh.battery = batteryLevelRef.current;
      const result = await postBatteryAlertOnce(fresh);
      if (result.success) {
        await drop();
        if (p.kind === 'low') {
          lowBatterySentRef.current = true;
          await AsyncStorage.setItem('batteryLowAlertSent', '1').catch(() => {});
        } else {
          finalBurstSentRef.current = p.alertId;
          setBatteryFinalStatus('sent');
        }
      } else {
        await AsyncStorage.setItem(
          'pendingBatteryAlert',
          JSON.stringify({ ...parsed, payload: fresh, nextRetryAt: Date.now() + 300000 })
        ).catch(() => {});
      }
    } catch {
      /* the queue is best-effort */
    }
  };

  // Poll D4's GET /alert/:id for fresh receipts (a server retry can
  // flip a channel after the first response). A 404 keeps the last
  // known receipts: on serverless without Supabase configured, an id
  // created on another instance reads as "not found here" — blanking
  // the UI on that would be a lie about a delivered alert.
  const fetchAlertStatus = async (alertId: string): Promise<void> => {
    try {
      const response = await fetch(`${BACKEND_URL}/alert/${encodeURIComponent(alertId)}`, {
        headers: {
          ...(process.env.EXPO_PUBLIC_API_SECRET
            ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
            : {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (data && data.success && data.alert && Array.isArray(data.alert.delivery)) {
        setDeliveryReceipts(data.alert.delivery);
        setAckCount(Array.isArray(data.alert.acks) ? data.alert.acks.length : 0);
        setEscalation(data.alert.escalation ?? null);
      }
    } catch {
      /* polling is best-effort; the last receipts stay on screen */
    }
  };

  // One live-tracking update while an alert is active. Fire-and-
  // forget: a failed update must never disturb the SOS screen.
  // D9: the active alert id rides along so the server can move the
  // contacts-side alert page to this position.
  const postLocationUpdate = async (uLat: string, uLng: string, uAlertId?: string | null): Promise<void> => {
    try {
      await fetch(`${BACKEND_URL}/location-update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.EXPO_PUBLIC_API_SECRET
            ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
            : {}),
        },
        body: JSON.stringify({ lat: uLat, lng: uLng, ...(uAlertId ? { alertId: uAlertId } : {}) }),
      });
    } catch {
      /* best-effort */
    }
  };

  // D16: start a Journey Guardian trip to a nearby safe place.
  // No local queue: a trip start that never reached the server is
  // retryable by tapping again — queueing it would create a stale
  // trip (wrong origin, expired ETA) when connectivity returns.
  const startJourney = async (place: SafePlace, etaMinutes: number): Promise<void> => {
    if (journeyBusy) return;
    if (lat === 'Loading...' || lng === 'Loading...' || isNaN(parseFloat(lat)) || isNaN(parseFloat(lng))) {
      showBanner('error', 'No location fix yet — SafeLife needs your GPS position to start a journey.');
      return;
    }
    setJourneyBusy(true);
    try {
      // D17: the escalation timer needs the traveller's emergency
      // contacts — same list SOS uses, phones only.
      const journeyContacts = await readEmergencyContacts();
      // D18: send the walking polyline the dashboard already fetched
      // for the map (GeoJSON [lng,lat] → {lat,lng}) so the server
      // measures deviation against the road, not the straight line.
      // Only when the fetched route is for THIS place — otherwise
      // the create goes without a route and the server falls back
      // to the straight line, exactly as before.
      const journeyRoute =
        route && routeState === 'ready' && routePlace && routePlace.id === place.id
          ? route.coordinates
              .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
              .map(([lng, lat]) => ({ lat, lng }))
          : undefined;
      const result = await createJourney(
        BACKEND_URL,
        {
          originLat: parseFloat(lat),
          originLng: parseFloat(lng),
          destLat: place.lat,
          destLng: place.lng,
          destinationLabel: place.name,
          etaMinutes,
          contacts: journeyContacts.map((c) => ({ phone: c.phone })),
          ...(journeyRoute && journeyRoute.length >= 2 ? { route: journeyRoute } : {}),
        },
        userData ? `${userData.first_name} ${userData.last_name}` : 'Unknown User'
      );
      if (!result.reached) {
        showBanner('error', 'Journey could not be started — the connection failed. Try again when the network returns.');
        return;
      }
      if (!result.success || !result.journey) {
        showBanner('error', 'Journey could not be started — SafeLife refused the trip. Check the destination and try again.');
        return;
      }
      setJourney(result.journey);
      setJourneyViewUrl(result.viewUrl);
      setJourneyDistanceM(calculateDistance(parseFloat(lat), parseFloat(lng), place.lat, place.lng));
      await secureSetItem(
        JOURNEY_STORAGE_KEY,
        JSON.stringify({ id: result.journey.id, viewUrl: result.viewUrl })
      ).catch(() => {});
      showBanner('success', `Journey started — heading to ${place.name}. Share the link so your contacts can follow you.`);
    } finally {
      setJourneyBusy(false);
    }
  };

  // D17: answer the server's "Sab theek hai?" prompt. The poll
  // refreshes the journey right after, so a cleared prompt vanishes
  // on the next 30 s tick even if this set fails to stick locally.
  const answerJourneyCheckIn = async (ok: boolean): Promise<void> => {
    const current = journeyRef.current;
    if (!current || checkInBusy || !current.checkIn) return;
    setCheckInBusy(true);
    try {
      const result = await answerCheckIn(BACKEND_URL, current.id, ok);
      if (!result.reached || !result.success || !result.journey) {
        showBanner('error', 'Could not send your answer — try again.');
        return;
      }
      setJourney(result.journey);
      showBanner(
        'success',
        ok ? 'Got it — stay safe.' : 'Help is on the way — your emergency contacts have been alerted.'
      );
    } finally {
      setCheckInBusy(false);
    }
  };

  // D16: share the signed live-trip link with the native share sheet.
  // The link (not coordinates) is the live source — a pasted pin
  // would go stale the moment the user moves.
  const shareJourney = async (): Promise<void> => {
    const current = journeyRef.current;
    if (!current) return;
    try {
      await Share.share({ message: buildShareText(current, journeyViewUrl) });
    } catch {
      /* dismissed */
    }
  };

  // D16: end the active trip (arrived or cancelled). The server is
  // authoritative: only a journey it confirms finished clears the
  // local state — a transport failure leaves the trip running rather
  // than pretending it ended.
  const endActiveJourney = async (action: 'arrived' | 'cancelled'): Promise<void> => {
    const current = journeyRef.current;
    if (!current || journeyBusy) return;
    setJourneyBusy(true);
    try {
      const finished = await endJourney(BACKEND_URL, current.id, action);
      if (!finished) {
        showBanner('error', 'Could not reach SafeLife to end the journey — it is still active. Try again.');
        return;
      }
      setJourney(null);
      setJourneyViewUrl(null);
      setJourneyDistanceM(null);
      lastJourneyTrackRef.current = null;
      await secureRemoveItem(JOURNEY_STORAGE_KEY).catch(() => {});
      showBanner(
        'success',
        action === 'arrived' ? 'Journey complete — you arrived safely.' : 'Journey cancelled.'
      );
    } finally {
      setJourneyBusy(false);
    }
  };

  // D16: poll the active journey (same 30 s cadence as the alert
  // receipts poll). A transport failure keeps the last known trip —
  // blanking the card on a flaky link would be a lie about a live
  // journey. A server-side finished state clears it: the trip ended
  // elsewhere (another device, or the server), and the card must not
  // keep offering ARRIVED for a trip that is over.
  const fetchJourneyStatus = async (journeyId: string): Promise<void> => {
    try {
      const live = await fetchJourney(BACKEND_URL, journeyId);
      if (!live) return;
      if (live.state !== 'active') {
        setJourney(null);
        setJourneyViewUrl(null);
        setJourneyDistanceM(null);
        lastJourneyTrackRef.current = null;
        await secureRemoveItem(JOURNEY_STORAGE_KEY).catch(() => {});
        showBanner('success', 'Your journey ended.');
        return;
      }
      setJourney(live);
      const la = parseFloat(latRef.current);
      const ln = parseFloat(lngRef.current);
      if (Number.isFinite(la) && Number.isFinite(ln)) {
        setJourneyDistanceM(calculateDistance(la, ln, live.destination.lat, live.destination.lng));
      }
    } catch {
      /* polling is best-effort; the last trip stays on screen */
    }
  };

  // Live tracking (F2): the backend's /location-update endpoint had
  // zero callers, so the "LIVE LOCATION TRACKING" link in the SOS
  // Telegram message pointed at the static trigger-time pin while
  // claiming real-time updates. While an alert is active, send an
  // update whenever the user has moved ≥25m and ≥30s have passed
  // since the last one. The first fix after activation only seeds
  // the baseline — /alert already delivered that position.
  useEffect(() => {
    if (status !== 'ALERT ACTIVE') {
      lastTrackRef.current = null;
      return;
    }
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    const last = lastTrackRef.current;
    const now = Date.now();
    if (!last) {
      lastTrackRef.current = { lat: la, lng: ln, at: now };
      return;
    }
    if (now - last.at < 30000) return;
    if (calculateDistance(last.lat, last.lng, la, ln) < 25) return;
    lastTrackRef.current = { lat: la, lng: ln, at: now };
    postLocationUpdate(lat, lng, activeAlertId);
  }, [status, lat, lng, activeAlertId]);

  // D5 delivery-status polling: while an alert is active, refresh its
  // receipts every 30s (the live-tracking cadence) so a server-side
  // retry shows up in the AlertActiveView without a manual refresh.
  // Stops the moment the alert stops — no background polling.
  useEffect(() => {
    if (status !== 'ALERT ACTIVE' || !activeAlertId) return;
    const id = setInterval(() => fetchAlertStatus(activeAlertId), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, activeAlertId]);

  // D16: live journey tracking — same ≥25 m / ≥30 s cadence as alert
  // tracking, posted to the journey instead of the alert. The first
  // fix after starting only seeds the baseline — POST /journeys
  // already delivered the origin. Distance-to-destination updates
  // here too, so the card counts down without a server round-trip.
  useEffect(() => {
    if (!journey || journey.state !== 'active') {
      lastJourneyTrackRef.current = null;
      return;
    }
    const la = parseFloat(lat);
    const ln = parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    setJourneyDistanceM(calculateDistance(la, ln, journey.destination.lat, journey.destination.lng));
    const last = lastJourneyTrackRef.current;
    const now = Date.now();
    if (!last) {
      lastJourneyTrackRef.current = { lat: la, lng: ln, at: now };
      return;
    }
    if (now - last.at < 30000) return;
    if (calculateDistance(last.lat, last.lng, la, ln) < 25) return;
    lastJourneyTrackRef.current = { lat: la, lng: ln, at: now };
    void postJourneyLocation(BACKEND_URL, journey.id, la, ln);
  }, [journey, lat, lng]);

  // D16: journey status polling — refresh the trip every 30s while
  // it is active, so an ETA/overdue change (or a finish from another
  // device) reaches the card. Stops the moment the trip ends.
  const activeJourneyId = journey && journey.state === 'active' ? journey.id : null;
  useEffect(() => {
    if (!activeJourneyId) return;
    const id = setInterval(() => fetchJourneyStatus(activeJourneyId), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJourneyId]);

  // D11: fire the battery alert the moment a threshold is crossed —
  // level, charging state, alert status and position changes all
  // re-run this. decide() plus the sent refs make it fire once per
  // cycle; climbing above the re-arm level clears the low flag so a
  // later drain warns again. Unknown battery readings never fire.
  useEffect(() => {
    if (!batteryKnownRef.current) return;
    if (batteryLevel > BATTERY_REARM_LEVEL && lowBatterySentRef.current) {
      lowBatterySentRef.current = false;
      AsyncStorage.removeItem('batteryLowAlertSent').catch(() => {});
    }
    const kind = decideBatteryAlert({
      level: batteryLevel,
      charging: batteryCharging,
      alertActive: status === 'ALERT ACTIVE',
      lowSent: lowBatterySentRef.current,
      finalSent: !!activeAlertId && finalBurstSentRef.current === activeAlertId,
    });
    if (!kind) return;
    void sendBatteryAlert(kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batteryLevel, batteryCharging, status, activeAlertId, lat, lng]);

  // Send a previously queued SOS (stored only when the alert never
  // reached the server — a reached alert is server-owned, never
  // queued, so this can never duplicate an SOS). Backoff-gated
  // unless `force` (the queued pill's RETRY NOW): a flush that fails
  // to reach the server pushes nextRetryAt out by the backoff table
  // instead of retrying on every foreground event. A flush that
  // reaches the server drops the queue item even when delivery
  // itself failed — the server's retry owns that alert from here.
  const flushPendingSOS = async (force = false) => {
    if (flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    try {
      const raw = await secureGetItem('pendingSOS');
      if (!raw) {
        setQueuedSOS(false);
        return;
      }
      const parsed = JSON.parse(raw) as QueuedSOS;
      // A queued alert older than a day is history, not an emergency —
      // drop it instead of retrying it on every foreground forever.
      if (!parsed || Date.now() - (parsed.queuedAt || 0) > 24 * 60 * 60 * 1000) {
        await secureRemoveItem('pendingSOS');
        setQueuedSOS(false);
        return;
      }
      if (!force && Date.now() < (parsed.nextRetryAt || 0)) return;
      if (!parsed.payload) {
        await secureRemoveItem('pendingSOS');
        setQueuedSOS(false);
        return;
      }
      const result = await postAlertOnce(parsed.payload);
      if (!result.reached) {
        // Still never reached the server: keep it queued, back off.
        const attempts = (parsed.attempts || 0) + 1;
        const delay = QUEUE_BACKOFF_MS[Math.min(attempts - 1, QUEUE_BACKOFF_MS.length - 1)];
        await secureSetItem(
          'pendingSOS',
          JSON.stringify({ ...parsed, attempts, nextRetryAt: Date.now() + delay })
        ).catch(() => {});
        setQueuedSOS(true);
        return;
      }
      await secureRemoveItem('pendingSOS');
      setQueuedSOS(false);
      if (result.alertId) {
        setActiveAlertId(result.alertId);
        AsyncStorage.setItem('lastAlertId', result.alertId).catch(() => {});
      }
      if (result.delivery) setDeliveryReceipts(result.delivery);
      if (result.success) {
        showBanner('success', 'Queued SOS delivered — your earlier alert just reached SafeLife on Telegram.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else if (result.retry?.queued) {
        showBanner('error', 'Queued SOS reached SafeLife but delivery failed — the server will keep retrying it.');
      } else {
        showBanner('error', 'Queued SOS reached SafeLife but could not be delivered, and automatic retry is not configured — tap SOS again if you are still in danger.');
      }
    } catch {
      /* the queue is best-effort */
    } finally {
      flushInFlightRef.current = false;
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
    const sosContacts = await readEmergencyContacts();

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
      const result = await postAlertWithRetry(payload);
      if (result.reached) {
        // The server owns this alert now — even on total delivery
        // failure. Never queue a reached alert: re-POSTing it later
        // would be a second SOS, not a retry.
        if (result.alertId) {
          setActiveAlertId(result.alertId);
          AsyncStorage.setItem('lastAlertId', result.alertId).catch(() => {});
        }
        if (result.delivery) setDeliveryReceipts(result.delivery);
        // D11: a new alert gets a fresh final-burst allowance.
        finalBurstSentRef.current = null;
        setBatteryFinalStatus(null);
        await secureRemoveItem('pendingSOS').catch(() => {});
        setQueuedSOS(false);
        if (!result.success) {
          // Success needs no dialog: the screen switches to the ALERT
          // ACTIVE view, which is the confirmation. Failure drops
          // back to SAFE with an honest reason, not a queue promise
          // the server already covers (or honestly does not).
          setStatus('SAFE');
          showBanner(
            'error',
            result.retry?.queued
              ? 'SOS reached SafeLife but delivery failed — the server will keep retrying it. Send it by SMS now if you need another channel.'
              : 'SOS reached SafeLife but could not be delivered, and automatic retry is not configured yet — tap SOS again, or send it by SMS now.'
          );
        }
      } else {
        // Never reached the server — the only case the local queue
        // is for. flushPendingSOS auto-sends when connectivity
        // returns, with backoff; tell the user honestly, with an SMS
        // escape hatch that works with zero data connection.
        const queued: QueuedSOS = { payload, queuedAt: Date.now(), attempts: 0, nextRetryAt: Date.now() };
        await secureSetItem('pendingSOS', JSON.stringify(queued)).catch(() => {});
        setQueuedSOS(true);
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
      showBanner('error', 'Waiting for a GPS fix before sharing your location.');
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
      showBanner('error', 'Still scanning for nearby safe places — try again in a moment.');
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

  // D14: the route target is the nearest-best safe place — rankSafePlaces
  // weighs distance by category (police first), so this is the same
  // "best" the RESCUE button and the SOS message already use.
  const rankedPlaces =
    lat !== 'Loading...'
      ? rankSafePlaces(cachedSafePlaces, parseFloat(lat), parseFloat(lng))
      : [];
  const routePlace = rankedPlaces.length > 0 ? rankedPlaces[0] : null;

  // D15: the route badge blends the destination's safety with the
  // walk's exposure (0.6 / 0.4) — a short walk to a closed cafe is not
  // "safe" just because it is short.
  const routeSafety =
    route && routePlace && routePlace.safety && route.safety
      ? combineRouteSafety(routePlace.safety, route.safety)
      : null;

  // D14: fetch the walking route to the nearest-best place. The key
  // rounds the position to 3 decimals (~100 m): the route refetches
  // when the user actually moves, not on every GPS tick. A failed fetch
  // is an honest error state with the Google Maps escape hatch — never
  // a drawn straight line pretending to be a route.
  useEffect(() => {
    if (!routePlace || lat === 'Loading...' || lng === 'Loading...') {
      setRouteState('idle');
      return;
    }
    const key = `${routePlace.id}|${parseFloat(lat).toFixed(3)},${parseFloat(lng).toFixed(3)}`;
    if (key === routeKeyRef.current && (route || routeInFlightRef.current)) return;
    routeKeyRef.current = key;
    routeInFlightRef.current = true;
    let cancelled = false;
    setRouteState('loading');
    (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(
          `${BACKEND_URL}/route?fromLat=${lat}&fromLng=${lng}&toLat=${routePlace.lat}&toLng=${routePlace.lng}`,
          { signal: controller.signal }
        );
        clearTimeout(timer);
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (
          response.ok &&
          data &&
          data.success === true &&
          Array.isArray(data.coordinates) &&
          data.coordinates.length >= 2 &&
          Number.isFinite(data.distanceM) &&
          Number.isFinite(data.durationS)
        ) {
          // D15: the backend scores the walk's exposure; an unusable or
          // missing score is computed locally from the same rule table
          // instead of hiding the badge.
          const exposure = isValidSafety(data.safety)
            ? data.safety
            : scoreRouteLocal({ distanceM: data.distanceM, durationS: data.durationS });
          setRoute({ coordinates: data.coordinates, distanceM: data.distanceM, durationS: data.durationS, safety: exposure });
          setRouteState('ready');
        } else {
          setRoute(null);
          setRouteState('error');
        }
      } catch {
        if (!cancelled) {
          setRoute(null);
          setRouteState('error');
        }
      } finally {
        routeInFlightRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePlace?.id, routePlace?.lat, routePlace?.lng, lat, lng]);

  if (status === 'ALERT ACTIVE') {
    return (
      <AlertActiveView
        lat={lat}
        lng={lng}
        delivery={deliveryReceipts}
        ackCount={ackCount}
        escalation={escalation}
        batteryFinalStatus={batteryFinalStatus}
        cachedSafePlaces={cachedSafePlaces}
        onStop={() => {
          setStatus('SAFE');
          // D11: the final-burst line belongs to the ended alert.
          finalBurstSentRef.current = null;
          setBatteryFinalStatus(null);
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

        {/* D5 queued-SOS pill: persistent (unlike the banner, which
            dismisses) so an unsent SOS stays visible until it is
            delivered, expires, or the user retries it now. */}
        {queuedSOS && (
          <View style={[styles.sosBanner, styles.queuedBanner]}>
            <Text style={styles.sosBannerText}>
              SOS queued — it never reached SafeLife. It will auto-send when the network returns.
            </Text>
            <View style={styles.sosBannerActions}>
              <TouchableOpacity onPress={() => flushPendingSOS(true)}>
                <Text style={styles.sosBannerAction}>RETRY NOW</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={sendSOSviaSMS}>
                <Text style={styles.sosBannerAction}>SEND VIA SMS</Text>
              </TouchableOpacity>
            </View>
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
                  {batteryLevel}%{batteryCharging ? ' ⚡' : ''}
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

        {/* D16: Journey Guardian — share a trip, contacts follow live */}
        <Reanimated.View entering={FadeInUp.delay(280).duration(500)}>
          <JourneyCard
            places={rankedPlaces}
            journey={journey}
            distanceRemainingM={journeyDistanceM}
            busy={journeyBusy}
            onStart={startJourney}
            onShare={shareJourney}
            onArrived={() => endActiveJourney('arrived')}
            onCancel={() => endActiveJourney('cancelled')}
            onCheckIn={answerJourneyCheckIn}
            checkInBusy={checkInBusy}
          />
        </Reanimated.View>

        {/* D14: in-app walking route to the nearest-best safe place */}
        {lat !== 'Loading...' && rankedPlaces.length > 0 && (
          <Reanimated.View entering={FadeInUp.delay(300).duration(500)} style={styles.routeSection}>
            <SectionHeader
              icon={<MaterialCommunityIcons name="routes" size={18} color={Theme.colors.primary} />}
              title="Route to Safety · Walking"
            />
            {routeState === 'ready' && route && routePlace ? (
              <RouteMap
                coordinates={route.coordinates}
                distanceM={route.distanceM}
                durationS={route.durationS}
                destinationName={routePlace.name}
                isBest
                safety={routeSafety ?? undefined}
                onOpenExternal={() =>
                  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${routePlace.lat},${routePlace.lng}`)
                }
              />
            ) : routeState === 'error' ? (
              <GlassCard style={styles.scanningCard}>
                <Text style={styles.scanningText}>Walking route unavailable right now.</Text>
                <TouchableOpacity
                  onPress={() =>
                    routePlace &&
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${routePlace.lat},${routePlace.lng}`)
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.retryText}>OPEN IN GOOGLE MAPS</Text>
                </TouchableOpacity>
              </GlassCard>
            ) : (
              <GlassCard style={styles.scanningCard}>
                <ActivityIndicator size="small" color={Theme.colors.primary} />
                <Text style={styles.scanningText}>Finding your walking route…</Text>
              </GlassCard>
            )}
          </Reanimated.View>
        )}

        {/* Police radar */}
        <Reanimated.View entering={FadeInUp.delay(320).duration(500)}>
          <SectionHeader
            icon={<MaterialCommunityIcons name="police-badge" size={18} color={Theme.colors.police} />}
            title="Police Radar · 20km"
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
                  safety={station.safety}
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
  routeSection: { marginBottom: 10 },
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
  queuedBanner: { backgroundColor: 'rgba(255, 193, 7, 0.10)', borderColor: 'rgba(255, 193, 7, 0.45)' },
  sosBannerSuccess: { backgroundColor: 'rgba(46, 204, 140, 0.13)', borderColor: 'rgba(46, 204, 140, 0.5)' },
  sosBannerError: { backgroundColor: 'rgba(255, 113, 108, 0.12)', borderColor: 'rgba(255, 113, 108, 0.5)' },
  sosBannerText: { fontFamily: Theme.fonts.body, fontSize: 13, lineHeight: 18, color: Theme.colors.onSurface },
  sosBannerActions: { flexDirection: 'row', gap: 18, marginTop: 10 },
  sosBannerAction: { fontFamily: Theme.fonts.label, fontSize: 12, letterSpacing: 1, color: Theme.colors.primary, fontWeight: 'bold' },
});
