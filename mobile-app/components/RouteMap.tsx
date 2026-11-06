import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Theme } from '../constants/theme';
import GlassCard from './ui/GlassCard';
import {
  fitRoute,
  decimateCoordinates,
  formatDuration,
  formatRouteDistance,
  type LngLat,
} from '../utils/routeMath';

interface Props {
  /** OSRM GeoJSON LineString coordinates: [lng, lat] pairs. */
  coordinates: LngLat[];
  distanceM: number;
  durationS: number;
  destinationName: string;
  /** The destination is the top-ranked (nearest-best) safe place. */
  isBest?: boolean;
  onOpenExternal: () => void;
}

const MAP_HEIGHT = 220;

/**
 * D14 — in-app walking-route map. No map library: OSM raster tiles +
 * the OSRM polyline drawn as rotated Views, fitted to the route's own
 * bounding box (fixed viewport — the route IS the viewport). A tile
 * that fails to load simply leaves its patch of background: the
 * polyline, markers and ETA never depend on the tiles.
 */
export default function RouteMap({
  coordinates,
  distanceM,
  durationS,
  destinationName,
  isBest,
  onOpenExternal,
}: Props) {
  const [width, setWidth] = useState(0);
  const fitted = useMemo(
    () => (width > 0 ? fitRoute(decimateCoordinates(coordinates), width, MAP_HEIGHT) : null),
    [coordinates, width]
  );
  const points = fitted?.points ?? [];
  const tiles = fitted?.tiles ?? [];
  const minTileX = tiles.length > 0 ? Math.min(...tiles.map((t) => t.x)) : 0;
  const minTileY = tiles.length > 0 ? Math.min(...tiles.map((t) => t.y)) : 0;

  const segments: { left: number; top: number; length: number; angle: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue;
    // A horizontal bar centered on the segment midpoint, rotated to the
    // segment angle: rotating about the center keeps it on both endpoints.
    segments.push({
      left: (a.x + b.x) / 2 - length / 2,
      top: (a.y + b.y) / 2,
      length,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    });
  }
  const start = points[0];
  const end = points[points.length - 1];

  return (
    <GlassCard style={styles.card} intensity={16}>
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
            <MaterialCommunityIcons name="star" size={12} color="#00331a" />
            <Text style={styles.bestText}>BEST</Text>
          </View>
        )}
      </View>

      <View
        style={styles.map}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="image"
        accessibilityLabel={`Walking route to ${destinationName}, ${formatRouteDistance(distanceM)}, about ${formatDuration(durationS)}`}
      >
        {fitted &&
          tiles.map((tile) => (
            <Image
              key={`${tile.x}/${tile.y}`}
              source={{ uri: tile.url }}
              style={[
                styles.tile,
                {
                  left: fitted.origin.x + (tile.x - minTileX) * 256,
                  top: fitted.origin.y + (tile.y - minTileY) * 256,
                },
              ]}
              resizeMode="cover"
            />
          ))}
        {segments.map((s, i) => (
          <React.Fragment key={i}>
            <View
              style={[
                styles.segmentHalo,
                { left: s.left, top: s.top - 4, width: s.length, transform: [{ rotate: `${s.angle}deg` }] },
              ]}
            />
            <View
              style={[
                styles.segment,
                { left: s.left, top: s.top - 2, width: s.length, transform: [{ rotate: `${s.angle}deg` }] },
              ]}
            />
          </React.Fragment>
        ))}
        {start && <View style={[styles.startDot, { left: start.x - 7, top: start.y - 7 }]} />}
        {end && (
          <MaterialCommunityIcons
            name="map-marker"
            size={30}
            color={Theme.colors.success}
            style={[styles.endPin, { left: end.x - 15, top: end.y - 29 }]}
          />
        )}
      </View>

      <TouchableOpacity style={styles.external} onPress={onOpenExternal} activeOpacity={0.7}>
        <MaterialCommunityIcons name="google-maps" size={16} color={Theme.colors.primary} />
        <Text style={styles.externalText}>OPEN IN GOOGLE MAPS</Text>
      </TouchableOpacity>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, marginBottom: 12, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  titleBox: { flex: 1, gap: 2 },
  title: { fontFamily: Theme.fonts.headline, fontSize: 15, color: Theme.colors.onSurface },
  meta: { fontFamily: Theme.fonts.body, fontSize: 12, color: Theme.colors.onSurfaceVariant },
  bestPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Theme.colors.success,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
  },
  bestText: { fontFamily: Theme.fonts.headline, fontSize: 11, color: '#00331a', fontWeight: '900' },
  map: {
    height: MAP_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Theme.colors.surfaceContainerLow,
  },
  tile: { position: 'absolute', width: 256, height: 256 },
  segmentHalo: {
    position: 'absolute',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  segment: {
    position: 'absolute',
    height: 4,
    borderRadius: 2,
    backgroundColor: Theme.colors.primaryContainer,
    shadowColor: Theme.colors.primaryContainer,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
  startDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Theme.colors.primary,
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  endPin: { position: 'absolute', textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4 },
  external: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 227, 253, 0.35)',
    backgroundColor: 'rgba(0, 227, 253, 0.10)',
  },
  externalText: { fontFamily: Theme.fonts.label, fontSize: 11, letterSpacing: 1, color: Theme.colors.primary, fontWeight: 'bold' },
});
