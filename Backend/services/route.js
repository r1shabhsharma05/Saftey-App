// 🛡️ Walking-route service — the OSRM proxy behind GET /route (D14).
//
// The app used to hand the user to Google Maps for directions; D14 draws
// the walking route in-app. OSRM is queried server-side (fast region,
// bounded timeout) so the phone gets one small JSON answer: distance,
// walking time, and the full GeoJSON LineString for the map polyline.
// Two public OSRM hosts race Promise.any, the same mirror pattern as
// services/safePlaces.js — whichever answers first wins; a host that
// says NoRoute only decides the verdict when EVERY host agrees there
// is no path (one graph lacking a path does not prove the other lacks it).
// No caching: a route depends on the exact endpoints, and the app fetches
// at most once per destination or ~100 m of movement — nothing to reuse.
// shortcut: no server-side geometry decimation; a 10 km walk is ~15–35 KB
// of coordinates. Revisit only if a payload ever exceeds ~100 KB.
const axios = require("axios");

const OSRM_TIMEOUT_MS = 10000;

// FOSSGIS's foot instance answers under the /route/v1/driving profile
// path (its server-side profile name); project-osrm under /route/v1/foot.
const OSRM_HOSTS = [
  "https://router.project-osrm.org/route/v1/foot",
  "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
];

const fetchHost = async (base, fromLng, fromLat, toLng, toLat) => {
  const resp = await axios.get(
    `${base}/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`,
    {
      timeout: OSRM_TIMEOUT_MS,
      headers: {
        "User-Agent": "SafeLifeAI/1.0 (personal safety app)",
        Accept: "application/json",
      },
    }
  );
  const data = resp.data;
  if (!data || data.code !== "Ok" || !Array.isArray(data.routes) || data.routes.length === 0) {
    const noRoute = data && data.code === "NoRoute";
    const err = new Error(noRoute ? "No walking route found" : "Route lookup failed");
    err.status = 502;
    err.code = noRoute ? "NO_ROUTE" : "UPSTREAM";
    throw err;
  }
  const r = data.routes[0];
  const coords = r.geometry && r.geometry.coordinates;
  if (
    !Array.isArray(coords) || coords.length < 2 ||
    !Number.isFinite(r.distance) || !Number.isFinite(r.duration)
  ) {
    const err = new Error("Route lookup failed");
    err.status = 502;
    err.code = "UPSTREAM";
    throw err;
  }
  return {
    distanceM: Math.round(r.distance),
    durationS: Math.round(r.duration),
    coordinates: coords,
  };
};

const getWalkingRoute = async (fromLat, fromLng, toLat, toLng) => {
  try {
    return await Promise.any(
      OSRM_HOSTS.map((base) => fetchHost(base, fromLng, fromLat, toLng, toLat))
    );
  } catch (err) {
    const errors = (err && err.errors) || [err];
    // Coordinates never reach the log: the message alone is the diagnosis.
    console.log(
      "❌ ROUTE ERROR:",
      errors.map((e) => e && e.message).join(" | ")
    );
    if (errors.length > 0 && errors.every((e) => e && e.code === "NO_ROUTE")) {
      const noRoute = new Error("No walking route found");
      noRoute.status = 502;
      noRoute.code = "NO_ROUTE";
      throw noRoute;
    }
    const failed = new Error("Route lookup failed");
    failed.status = 502;
    failed.code = "UPSTREAM";
    throw failed;
  }
};

module.exports = { getWalkingRoute };
