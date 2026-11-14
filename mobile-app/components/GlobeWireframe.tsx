// GlobeWireframe — port of the landing page's d3 wireframe globe
// (landing/src/components/ui/contact-with-globe.tsx, variant
// "wireframesolid") to React Native. Same data (world-atlas
// countries-110m.json, bundled locally — no runtime fetch), same
// projection (d3.geoOrthographic), same animation (auto-rotate 0.45°
// per frame, drag-to-rotate), drawn as react-native-svg paths:
// country outlines + sphere outline, white strokes on transparent.
//
// What was SIMPLIFIED for mobile: no world-atlas CDN fetch (bundled),
// no graticule (wireframesolid hides it on the web too), no hover
// states, no city-rotation mode (the auth page never uses it).
// Rotation recomputes at ~30 fps inside this component only, so the
// parent screen never re-renders for the animation.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import type { FeatureCollection } from 'geojson';
import worldAtlas from '../assets/world-atlas/countries-110m.json';

interface GlobeWireframeProps {
  /** Square size in px (width = height). */
  size: number;
  strokeColor?: string;
  strokeWidth?: number;
  autoRotateSpeed?: number;
  style?: StyleProp<ViewStyle>;
}

// Countries once, at module load — the topology never changes.
// (countries is a GeometryCollection, so feature() returns a
// FeatureCollection; the declared type is a union, hence the cast.)
const COUNTRIES = (
  feature(
    worldAtlas as unknown as Topology,
    (worldAtlas as unknown as Topology).objects.countries
  ) as unknown as FeatureCollection
).features as unknown as GeoPermissibleObjects[];

export default function GlobeWireframe({
  size,
  strokeColor = '#ffffff',
  strokeWidth = 0.6,
  autoRotateSpeed = 0.45,
  style,
}: GlobeWireframeProps) {
  const [rotation, setRotation] = useState<[number, number]>([0, 0]);
  const rotationRef = useRef<[number, number]>([0, 0]);
  const draggingRef = useRef(false);

  // Auto-rotate at the web's speed (0.45° per 60 fps frame), throttled
  // to ~30 fps so the path recompute stays cheap.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (draggingRef.current) return;
      if (now - last < 33) return;
      last = now;
      const next: [number, number] = [
        (rotationRef.current[0] + autoRotateSpeed * 2) % 360,
        rotationRef.current[1],
      ];
      rotationRef.current = next;
      setRotation(next);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoRotateSpeed]);

  // Drag-to-rotate, same sensitivity shape as the web (0.25°/px).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        draggingRef.current = true;
      },
      onPanResponderMove: (_, gesture) => {
        const next: [number, number] = [
          (rotationRef.current[0] + gesture.dx * 0.25) % 360,
          Math.max(-90, Math.min(90, rotationRef.current[1] - gesture.dy * 0.25)),
        ];
        rotationRef.current = next;
        setRotation(next);
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
      },
    })
  ).current;

  const paths = useMemo(() => {
    const projection = geoOrthographic()
      .scale((size / 2) * 0.9)
      .translate([size / 2, size / 2])
      .rotate(rotation)
      .precision(0.1);
    const path = geoPath(projection);
    const countries: string[] = [];
    for (const f of COUNTRIES) {
      const d = path(f);
      if (d && !d.includes('NaN') && !d.includes('Infinity')) countries.push(d);
    }
    const sphere = path({ type: 'Sphere' }) ?? '';
    return { countries, sphere };
  }, [rotation, size]);

  return (
    <View style={style} {...panResponder.panHandlers}>
      <Svg width={size} height={size}>
        {paths.countries.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />
        ))}
        {paths.sphere ? (
          <Path d={paths.sphere} fill="none" stroke={strokeColor} strokeWidth={1.5} opacity={0.8} />
        ) : null}
      </Svg>
    </View>
  );
}
