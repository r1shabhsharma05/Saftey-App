// Route-map math (D14) — pure Web Mercator projection + formatting, with
// no React Native imports, so it stays verifiable with plain node.
// Coordinates are OSRM [lng, lat] pairs throughout.
export type LngLat = [number, number];

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapTile {
  x: number;
  y: number;
  url: string;
}

export interface FittedRoute {
  /** Polyline points in view pixels (origin = view top-left). */
  points: MapPoint[];
  /** OSM tiles covering the view at the chosen zoom. */
  tiles: MapTile[];
  zoom: number;
  /** View-pixel position of the top-left tile's top-left corner. */
  origin: MapPoint;
}

const TILE = 256;
const MAX_ZOOM = 19;

const lngToWorldX = (lng: number) => ((lng + 180) / 360) * TILE;

const latToWorldY = (lat: number) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * TILE;
};

// Stride-sample a long geometry down to at most maxPoints, keeping both
// endpoints — a 10 km walk is hundreds of points, and the map draws one
// View per segment. Consecutive duplicates (OSRM repeats points at
// turns) are dropped.
// shortcut: stride sampling, not Ramer-Douglas-Peucker — at this scale
// the visible difference is nil. Upgrade if a long route ever looks jagged.
export const decimateCoordinates = (coords: LngLat[], maxPoints = 80): LngLat[] => {
  if (coords.length <= maxPoints) return coords.slice();
  const step = (coords.length - 1) / (maxPoints - 1);
  const out: LngLat[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(coords[Math.round(i * step)]);
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
};

// Fit a route's bounding box into a view of width × height, centered,
// with padding on every side. Zoom is the largest integer zoom at which
// the box still fits, so the whole route is always visible (a
// fixed-viewport map: no pan/zoom — the route IS the viewport).
// shortcut: no pan/zoom; upgrade when D16 journey live-tracking needs a
// moving map.
export const fitRoute = (
  coords: LngLat[],
  width: number,
  height: number,
  padding = 20
): FittedRoute | null => {
  if (coords.length < 2 || width <= 0 || height <= 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const world = coords.map(([lng, lat]) => {
    const x = lngToWorldX(lng);
    const y = latToWorldY(lat);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    return { x, y };
  });
  // A zero-span box (there-and-back on one street) still needs a scale.
  const spanX = Math.max(maxX - minX, 0.0001);
  const spanY = Math.max(maxY - minY, 0.0001);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const zoom = Math.max(0, Math.min(MAX_ZOOM, Math.floor(Math.log2(scale))));
  const z = 2 ** zoom;
  const tileMinX = Math.floor((minX * z) / TILE);
  const tileMaxX = Math.floor((maxX * z) / TILE);
  const tileMinY = Math.floor((minY * z) / TILE);
  const tileMaxY = Math.floor((maxY * z) / TILE);
  // Center the box in the view; every pixel position derives from this.
  const offsetX = width / 2 - ((minX + maxX) / 2) * z;
  const offsetY = height / 2 - ((minY + maxY) / 2) * z;
  const points = world.map(({ x, y }) => ({ x: x * z + offsetX, y: y * z + offsetY }));
  const tiles: MapTile[] = [];
  for (let ty = tileMinY; ty <= tileMaxY; ty++) {
    for (let tx = tileMinX; tx <= tileMaxX; tx++) {
      tiles.push({ x: tx, y: ty, url: `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png` });
    }
  }
  return {
    points,
    tiles,
    zoom,
    origin: { x: tileMinX * TILE + offsetX, y: tileMinY * TILE + offsetY },
  };
};

export const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return "< 1 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
};

export const formatRouteDistance = (meters: number): string => {
  if (!Number.isFinite(meters) || meters < 0) return "—";
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
};
