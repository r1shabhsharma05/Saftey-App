// Guardian Network client — SafeLife 2.0 Day 19 (plan §6 D19, plan §3 F2).
//
// Thin API client for the /guardians endpoints, mirroring the SOS /
// journey client pattern in app/(tabs)/index.tsx and utils/journey.ts:
// 30 s timeout, the x-api-key header only when EXPO_PUBLIC_API_SECRET
// exists, and a `reached` flag so the caller can tell "the server
// answered but refused" apart from "the request never left the phone".
// The verification code is never stored on the device and never
// logged — it is typed by the user and sent once, then forgotten.
export type GuardianRole = 'family' | 'friend' | 'volunteer' | 'security';

export type GuardianState = 'pending' | 'verified';

/** Role picker labels — the four trusted-circle roles (plan §7.5). */
export const GUARDIAN_ROLES: { value: GuardianRole; label: string }[] = [
  { value: 'family', label: 'Family' },
  { value: 'friend', label: 'Friend' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'security', label: 'Security guard' },
];

export interface Guardian {
  id: string;
  userId: string;
  name: string;
  phone: string;
  role: GuardianRole;
  state: GuardianState;
  available: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterGuardianInput {
  userId: string;
  name: string;
  phone: string;
  role: GuardianRole;
}

export interface GuardianResult {
  reached: boolean;
  success: boolean;
  guardian: Guardian | null;
  error?: string;
}

/** request-code result: `sent` is honest — false while SMS is unconfigured. */
export interface CodeRequestResult {
  reached: boolean;
  success: boolean;
  sent: boolean;
  reason?: string;
  error?: string;
}

/** AsyncStorage key for the guardian record id (mirrors JOURNEY_STORAGE_KEY). */
export const GUARDIAN_STORAGE_KEY = 'guardianProfile';

export interface StoredGuardian {
  id: string;
}

const guardianHeaders = (): Record<string, string> => ({
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
      headers: guardianHeaders(),
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

// A guardian object is only trusted when it has the full D19 shape —
// a stale store entry or a future backend change must never render a
// broken card. Used for register/verify/availability responses AND
// restored AsyncStorage entries.
export const isValidGuardian = (g: unknown): g is Guardian =>
  !!g &&
  typeof g === 'object' &&
  typeof (g as Guardian).id === 'string' &&
  typeof (g as Guardian).userId === 'string' &&
  typeof (g as Guardian).name === 'string' &&
  typeof (g as Guardian).phone === 'string' &&
  (['family', 'friend', 'volunteer', 'security'] as string[]).includes((g as Guardian).role) &&
  ((g as Guardian).state === 'pending' || (g as Guardian).state === 'verified') &&
  typeof (g as Guardian).available === 'boolean';

const toGuardianResult = (data: unknown, reached: boolean): GuardianResult => {
  const notReached: GuardianResult = { reached: false, success: false, guardian: null };
  if (!reached || !data || typeof data !== 'object') return notReached;
  const d = data as { success?: boolean; guardian?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    guardian: isValidGuardian(d.guardian) ? d.guardian : null,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

export const registerGuardian = async (
  backendUrl: string,
  input: RegisterGuardianInput
): Promise<GuardianResult> => {
  const { reached, data } = await postJson(`${backendUrl}/guardians`, {
    userId: input.userId,
    name: input.name,
    phone: input.phone,
    role: input.role,
  });
  return toGuardianResult(data, reached);
};

export const requestVerificationCode = async (
  backendUrl: string,
  id: string
): Promise<CodeRequestResult> => {
  const { reached, data } = await postJson(
    `${backendUrl}/guardians/${encodeURIComponent(id)}/request-code`,
    {}
  );
  if (!reached || !data || typeof data !== 'object') {
    return { reached: false, success: false, sent: false };
  }
  const d = data as { success?: boolean; sent?: boolean; reason?: unknown; error?: unknown };
  return {
    reached: true,
    success: !!d.success,
    sent: !!d.sent,
    reason: typeof d.reason === 'string' ? d.reason : undefined,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
};

export const verifyGuardianCode = async (
  backendUrl: string,
  id: string,
  code: string
): Promise<GuardianResult> => {
  const { reached, data } = await postJson(
    `${backendUrl}/guardians/${encodeURIComponent(id)}/verify`,
    { code }
  );
  return toGuardianResult(data, reached);
};

export const setGuardianAvailability = async (
  backendUrl: string,
  id: string,
  available: boolean
): Promise<GuardianResult> => {
  const { reached, data } = await postJson(
    `${backendUrl}/guardians/${encodeURIComponent(id)}/availability`,
    { available }
  );
  return toGuardianResult(data, reached);
};

export const fetchGuardian = async (backendUrl: string, id: string): Promise<Guardian | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${backendUrl}/guardian/${encodeURIComponent(id)}`, {
        headers: guardianHeaders(),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const guardian = (data as { guardian?: unknown }).guardian;
      return isValidGuardian(guardian) ? guardian : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
};

// --- D20: GEO matching (location sharing + nearby list) ---

/** Posts the guardian's current pin. True only when the server accepted it. */
export const postGuardianLocation = async (
  backendUrl: string,
  id: string,
  lat: number,
  lng: number
): Promise<boolean> => {
  const { reached, data } = await postJson(
    `${backendUrl}/guardians/${encodeURIComponent(id)}/location`,
    { lat, lng }
  );
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};

/** A ranked nearby guardian: distanceKm + score, NEVER coordinates. */
export interface NearbyGuardian {
  id: string;
  name: string;
  role: GuardianRole;
  available: boolean;
  distanceKm: number;
  score: number;
}

export const isValidNearbyGuardian = (g: unknown): g is NearbyGuardian =>
  !!g &&
  typeof g === 'object' &&
  typeof (g as NearbyGuardian).id === 'string' &&
  typeof (g as NearbyGuardian).name === 'string' &&
  (['family', 'friend', 'volunteer', 'security'] as string[]).includes((g as NearbyGuardian).role) &&
  typeof (g as NearbyGuardian).available === 'boolean' &&
  typeof (g as NearbyGuardian).distanceKm === 'number' &&
  typeof (g as NearbyGuardian).score === 'number';

/** Ranked guardians near a point (default radius 2 km). Null when unreachable. */
export const fetchNearbyGuardians = async (
  backendUrl: string,
  lat: number,
  lng: number,
  radiusKm = 2
): Promise<NearbyGuardian[] | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(
        `${backendUrl}/guardians/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`,
        { headers: guardianHeaders(), signal: controller.signal }
      );
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const list = (data as { guardians?: unknown }).guardians;
      if (!Array.isArray(list)) return null;
      return list.filter(isValidNearbyGuardian);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
};

// --- D21: guardian alert flow (accept/decline, live tracking, preset messages) ---

/** One guardian's response to one alert (server state machine). */
export type GuardianResponseState = 'notified' | 'accepted' | 'declined';

/** A preset message as the server returns it (text is server-rendered from the key). */
export interface GuardianAlertMessage {
  from: string; // 'victim' or a guardian id
  name: string | null;
  key: string;
  text: string;
  at: string;
}

/** A live alert this guardian was notified about (GET /guardians/:id/alerts). */
export interface GuardianAlert {
  alertId: string;
  state: string;
  lat: number | null;
  lng: number | null;
  locationAt: string | null;
  responseState: GuardianResponseState;
  distanceKm: number | null;
  score: number | null;
  notifiedAt: string;
  respondedAt: string | null;
  messages: GuardianAlertMessage[];
}

/** The victim-side guardian summary (GET /alert/:id → alert.guardians). */
export interface AlertGuardianResponse {
  guardianId: string;
  name: string;
  role: GuardianRole;
  state: GuardianResponseState;
  distanceKm: number | null;
  score: number | null;
  notifiedAt: string;
  respondedAt: string | null;
}

export interface AlertGuardianLocation {
  guardianId: string;
  name: string;
  lat: number;
  lng: number;
  distanceKm: number | null;
  updatedAt: string;
}

export interface AlertGuardiansSummary {
  notified: number;
  accepted: number;
  responses: AlertGuardianResponse[];
  locations: AlertGuardianLocation[];
  messages: GuardianAlertMessage[];
}

/** Button labels for the preset messages — the exact text the server sends. */
export const GUARDIAN_PRESET_MESSAGES: { key: string; label: string }[] = [
  { key: 'on-my-way', label: "I'm on my way to you" },
  { key: 'almost-there', label: 'Almost there — stay where you are' },
  { key: 'calling-police', label: "I'm calling the police" },
];

export const VICTIM_PRESET_MESSAGES: { key: string; label: string }[] = [
  { key: 'please-hurry', label: 'Please hurry' },
  { key: 'i-am-safe', label: "I'm safe now — thank you" },
  { key: 'call-police', label: 'Please call the police' },
];

const isValidGuardianAlertMessage = (m: unknown): m is GuardianAlertMessage =>
  !!m &&
  typeof m === 'object' &&
  typeof (m as GuardianAlertMessage).from === 'string' &&
  ((m as GuardianAlertMessage).name === null || typeof (m as GuardianAlertMessage).name === 'string') &&
  typeof (m as GuardianAlertMessage).key === 'string' &&
  typeof (m as GuardianAlertMessage).text === 'string' &&
  typeof (m as GuardianAlertMessage).at === 'string';

export const isValidGuardianAlert = (a: unknown): a is GuardianAlert =>
  !!a &&
  typeof a === 'object' &&
  typeof (a as GuardianAlert).alertId === 'string' &&
  typeof (a as GuardianAlert).state === 'string' &&
  ((a as GuardianAlert).lat === null || typeof (a as GuardianAlert).lat === 'number') &&
  ((a as GuardianAlert).lng === null || typeof (a as GuardianAlert).lng === 'number') &&
  (['notified', 'accepted', 'declined'] as string[]).includes((a as GuardianAlert).responseState) &&
  Array.isArray((a as GuardianAlert).messages) &&
  (a as GuardianAlert).messages.every(isValidGuardianAlertMessage);

export const isValidAlertGuardians = (g: unknown): g is AlertGuardiansSummary =>
  !!g &&
  typeof g === 'object' &&
  typeof (g as AlertGuardiansSummary).notified === 'number' &&
  typeof (g as AlertGuardiansSummary).accepted === 'number' &&
  Array.isArray((g as AlertGuardiansSummary).responses) &&
  Array.isArray((g as AlertGuardiansSummary).locations) &&
  Array.isArray((g as AlertGuardiansSummary).messages);

/** Live alerts this guardian was notified about. Null when unreachable. */
export const fetchGuardianAlerts = async (
  backendUrl: string,
  id: string
): Promise<GuardianAlert[] | null> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(`${backendUrl}/guardians/${encodeURIComponent(id)}/alerts`, {
        headers: guardianHeaders(),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!data || typeof data !== 'object') return null;
      const list = (data as { alerts?: unknown }).alerts;
      if (!Array.isArray(list)) return null;
      return list.filter(isValidGuardianAlert);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
};

/** Accept an alert ("I'm coming"). True only when the server accepted it. */
export const acceptGuardianAlert = async (
  backendUrl: string,
  alertId: string,
  guardianId: string
): Promise<boolean> => {
  const { reached, data } = await postJson(
    `${backendUrl}/alert/${encodeURIComponent(alertId)}/guardian/${encodeURIComponent(guardianId)}/accept`,
    {}
  );
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};

/** Decline an alert ("I can't come"). True only when the server accepted it. */
export const declineGuardianAlert = async (
  backendUrl: string,
  alertId: string,
  guardianId: string
): Promise<boolean> => {
  const { reached, data } = await postJson(
    `${backendUrl}/alert/${encodeURIComponent(alertId)}/guardian/${encodeURIComponent(guardianId)}/decline`,
    {}
  );
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};

/** Post this guardian's live pin for an accepted alert. True only when accepted. */
export const postGuardianAlertLocation = async (
  backendUrl: string,
  alertId: string,
  guardianId: string,
  lat: number,
  lng: number
): Promise<boolean> => {
  const { reached, data } = await postJson(
    `${backendUrl}/alert/${encodeURIComponent(alertId)}/guardian/${encodeURIComponent(guardianId)}/location`,
    { lat, lng }
  );
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};

/** Send one preset message (victim or guardian side). True only when accepted. */
export const sendAlertMessage = async (
  backendUrl: string,
  alertId: string,
  input: { sender: 'victim' | 'guardian'; guardianId?: string; key: string }
): Promise<boolean> => {
  const { reached, data } = await postJson(`${backendUrl}/alert/${encodeURIComponent(alertId)}/message`, {
    sender: input.sender,
    ...(input.guardianId ? { guardianId: input.guardianId } : {}),
    key: input.key,
  });
  return reached && !!data && typeof data === 'object' && (data as { success?: boolean }).success === true;
};
