import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Mapbox, { Camera, LineLayer, MapView, PointAnnotation, ShapeSource } from '@rnmapbox/maps';
import { Theme } from '../constants/theme';
import Card from './ui/Card';
import AppleButton from './ui/AppleButton';
import SafetyBadge from './ui/SafetyBadge';
import type { SafetyScore } from '../utils/escapeLogic';
import { formatDuration, formatRouteDistance, type LngLat } from '../utils/routeMath';

interface Props {
  /** OSRM GeoJSON LineString coordinates: [lng, lat] pairs. */
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
  destinationName: string;
  /** The destination is the top-ranked (nearest-best) safe place. */
  isBest?: boolean;
  /** D15: combined place + route safety score for this destination. */
  safety?: SafetyScore;
  onOpenExternal: () => void;
}

const MAP_HEIGHT = 220;

// Mapbox — native SDK (@rnmapbox/maps), style streets-v12.
// SECURITY: the public token is set from EXPO_PUBLIC_MAPBOX_TOKEN
// (a config value, read at build time) via setAccessToken() — it is
// NEVER in a URL, NEVER in git, and never in a log. The token IS
// inside the built APK's JS bundle, which is expected for a public
// (pk.*) token; what is forbidden is git, URLs, logs and chat.
// Consequence: the map needs the native module, so it does NOT work
// in Expo Go — test it in the APK (Gradle) build. No token → the map
// area says so instead of rendering a broken map.
//
// Style note: the token has no styles:list scope, so the account's
// styles could not be listed — no custom style could be verified.
// streets-v12 (Mapbox.StyleURL.Street) is the fallback the brief
// names. If Rishabh creates a custom style later, swap StyleURL
// here to mapbox://styles/rishabh-tech820/<style-id>.
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
if (MAPBOX_TOKEN) {
  Mapbox.setAccessToken(MAPBOX_TOKEN);
}

/**
 * D14 — in-app walking-route map on the Mapbox native SDK: the OSRM
 * route as a GeoJSON LineString, camera fitted to the route's own
 * bounding box (fixed viewport — the route IS the viewport), start
 * dot + destination pin, Mapbox attribution + logo drawn by the SDK.
 * The polyline, markers and ETA never depend on the tiles loading.
 */
export default function RouteMap({
  coordinates,
  distanceM,
  durationS,
  destinationName,
  isBest,
  safety,
  onOpenExternal,
}: Props) {
  const route = useMemo(() => {
    if (coordinates.length < 2) return null;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of coordinates) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    return {
      bounds: { ne: [maxLng, maxLat] as [number, number], sw: [minLng, minLat] as [number, number] },
      start: coordinates[0],
      end: coordinates[coordinates.length - 1],
    };
  }, [coordinates]);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleBox}>
          <Text style={styles.title} numberOfLines={1}>
            {destinationName}
          </Text>
          <Text style={styles.meta}>
            {formatRouteDistance(distanceM)} · {formatDuration(durationS)} walk
          </Text>
        </View>
        {isBest && (
          <View style={styles.bestPill}>
            <Ionicons name="sparkles" size={12} color={Theme.colors.primaryText} />
            <Text style={styles.bestText}>Best route</Text>
          </View>
        )}
        {safety && <SafetyBadge safety={safety} />}
      </View>

      <View
        style={styles.map}
        accessibilityRole="image"
        accessibilityLabel={`Walking route to ${destinationName}, ${formatRouteDistance(distanceM)}, about ${formatDuration(durationS)}`}
      >
        {MAPBOX_TOKEN && route ? (
          <MapView style={styles.mapView} styleURL={Mapbox.StyleURL.Street}>
            <Camera
              bounds={route.bounds}
              padding={{ paddingLeft: 28, paddingRight: 28, paddingTop: 28, paddingBottom: 28 }}
              animationDuration={0}
            />
            <ShapeSource
              id="route"
              shape={{
                type: 'Feature',
                properties: {},
                geometry: { type: 'LineString', coordinates },
              }}
            >
              <LineLayer
                id="route-halo"
                style={{
                  lineColor: 'rgba(255,255,255,0.85)',
                  lineWidth: 8,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
              <LineLayer
                id="route-line"
                style={{
                  lineColor: Theme.colors.primary,
                  lineWidth: 4,
                  lineCap: 'round',
                  lineJoin: 'round',
                }}
              />
            </ShapeSource>
            <PointAnnotation id="start" coordinate={route.start}>
              <View style={styles.startDot} />
            </PointAnnotation>
            <PointAnnotation id="end" coordinate={route.end} anchor={{ x: 0.5, y: 1 }}>
              <Ionicons name="location-sharp" size={30} color={Theme.colors.error} />
            </PointAnnotation>
          </MapView>
        ) : (
          <View style={styles.mapFallback}>
            <Text style={styles.mapFallbackText}>
              {!MAPBOX_TOKEN
                ? 'Map unavailable — Mapbox token not configured.'
                : 'No route to show.'}
            </Text>
          </View>
        )}
      </View>

      <AppleButton
        title="Open in Google Maps"
        variant="tinted"
        onPress={onOpenExternal}
        icon={<Ionicons name="map-outline" size={16} color={Theme.colors.primaryText} />}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleBox: { flex: 1, gap: 2 },
  title: { ...Theme.type.headline, color: Theme.colors.onSurface },
  meta: { ...Theme.type.caption1, color: Theme.colors.onSurfaceVariant },
  bestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Theme.colors.primaryContainer,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  bestText: { ...Theme.type.caption1, fontWeight: '700', color: Theme.colors.primaryText },
  map: {
    height: MAP_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Theme.colors.surfaceContainerLow,
  },
  mapView: { flex: 1 },
  mapFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  mapFallbackText: {
    ...Theme.type.caption1,
    color: Theme.colors.onSurfaceVariant,
    textAlign: 'center',
  },
  startDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Theme.colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
