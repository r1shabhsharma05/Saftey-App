// Journey Guardian client — SafeLife 2.0 Day 16 (plan §6 D16, plan §3 F4).
//
// Thin API client for the /journeys endpoints, mirroring the SOS
// postAlertOnce pattern in app/(tabs)/index.tsx: 30 s timeout, the
// x-api-key header only when EXPO_PUBLIC_API_SECRET exists, and a
// `reached` flag so the caller can tell "the server answered but
// refused" apart from "the request never left the phone". No channel
// fan-out happens here — creation only returns a share link, and the
// traveller sends it with the native share sheet.
export type JourneyState = 'active' | 'arrived' | 'cancelled';

export interface Journey {
  id: string;
  state: JourneyState;
  userName: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number; label: string };
  expectedArrivalAt: string;
  createdAt: string;
  updatedAt: string;
  lat: number | null;
  lng: number | null;
  locationAt: string | null;
  overdue: boolean;
}

export interface CreateJourneyInput {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  destinationLabel: string;
  etaMinutes: number;
}

export interface JourneyCreateResult {
  reached: boolean;
  success: boolean;
  journey: Journey | null;
  viewUrl: string | null;
}

/** ETA chips offered when starting a journey (minutes). */
export const JOURNEY_ETA_OPTIONS = [15, 25, 45, 60];

/** AsyncStorage key for the in-progress journey (id + share link). */
export const JOURNEY_STORAGE_KEY = 'activeJourney';

export interface StoredJourney {
  id: string;
  viewUrl: string | null;
}

const journeyHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(process.env.EXPO_PUBLIC_API_SECRET
    ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
    : {}),
});

const postJson = async (
  url: string,
  body: Record<string, unknown>
): Promise<{ reached: boolean; data: unknown }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: journeyHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    return { reached: true, data };
  } catch {
    return { reached: false, data: null };
  } finally {
    clearTimeout(timeout);
  }
};

// A journey object is only trusted when it has the full D16 shape —
// a stale store entry or a future backend change must never render
// a broken card. Used for create/fetch responses AND restored
// AsyncStorage entries.
export const isValidJourney = (j: unknown): j is Journey =>
  !!j &&
  typeof j === 'object' &&
  typeof (j as Journey).id === 'string' &&
  ((j as Journey).state === 'active' ||
    (j as Journey).state === 'arrived' ||
    (j as Journey).state === 'cancelled') &&
  typeof (j as Journey).destination === 'object' &&
  Number.isFinite((j as Journey).destination?.lat) &&
  Number.isFinite((j as Journey).destination?.lng) &&
  typeof (j as Journey).destination?.label === 'string' &&
  typeof (j as Journey).expectedArrivalAt === 'string' &&
  typeof (j as Journey).overdue === 'boolean';

export const createJourney = async (
  backendUrl: string,
  input: CreateJourneyInput,
  userName: string
): Promise<JourneyCreateResult> => {
  const notReached: JourneyCreateResult = { reached: false, success: false, journey: null, viewUrl: null };
  const { reached, data } = await postJson(`${backendUrl}/journeys`, {
    originLat: input.originLat,
    originLng: input.originLng,
    destLat: input.destLat,
    destLng: input.destLng,
    destinationLabel: input.destinationLabel,
    expectedArrivalAt: new Date(Date.now() + input.etaMinutes * 60 * 1000).toISOString(),
    userName,
  });
  if (!reached || !data || typeof data !== 'object') return notReached;
  const d = data as { success?: boolean; journey?: unknown; viewUrl?: unknown };
  return {
    reached: true,
    success: !!d.success,
    journey: isValidJourney(d.journey) ? d.journey : null,
    viewUrl: typeof d.viewUrl === 'string' ? d.viewUrl : null,
  };
};

export const fetchJourney = async (backendUrl: string, id: string): Promise<Journey | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${backendUrl}/journey/${encodeURIComponent(id)}`, {
        headers: journeyHeaders(),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const journey = (data as { journey?: unknown }).journey;
      return isValidJourney(journey) ? journey : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
};

export const postJourneyLocation = async (
  backendUrl: string,
  id: string,
  lat: number,
  lng: number
): Promise<boolean> => {
  const { reached, data } = await postJson(`${backendUrl}/journey/${encodeURIComponent(id)}/location`, {
    lat,
    lng,
  });
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};

export const endJourney = async (
  backendUrl: string,
  id: string,
  action: 'arrived' | 'cancelled'
): Promise<Journey | null> => {
  const { reached, data } = await postJson(
    `${backendUrl}/journey/${encodeURIComponent(id)}/${action}`,
    {}
  );
  if (!reached || !data || typeof data !== 'object') return null;
  const d = data as { success?: boolean; journey?: unknown };
  return d.success === true && isValidJourney(d.journey) ? d.journey : null;
};

// The share text carries the destination, the ETA in the traveller's
// local time, and the signed link — the contact needs no app, only
// the link. No live coordinates in the text: the link is the live
// source, and a stale pasted pin would mislead.
export const buildShareText = (journey: Journey, viewUrl: string | null): string => {
  const eta = formatEta(journey.expectedArrivalAt);
  const link = viewUrl ? `\nFollow my live trip: ${viewUrl}` : '\n(Live link unavailable — the backend has no public URL configured.)';
  return `SafeLife — I'm heading to ${journey.destination.label}, ETA ${eta}.${link}`;
};

export const formatEta = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Whole minutes left until the ETA; negative once overdue. */
export const minutesRemaining = (journey: Journey, nowMs: number = Date.now()): number =>
  Math.round((Date.parse(journey.expectedArrivalAt) - nowMs) / 60000);
