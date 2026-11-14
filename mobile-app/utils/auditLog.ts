// Audit log read-back — SafeLife 2.0 Day 23: GET /admin/audit.
// Same auth shape as utils/guardian.ts (x-api-key only when the
// secret is set). Every failure mode is an honest reason, never a
// thrown error — the PROFILE screen must not crash when the audit
// store is unconfigured or the backend is unreachable.
import { getBackendUrl } from './backendUrl';

export interface AuditEvent {
  ts: string;
  action: string;
  actor: string;
  ip: string | null;
  alert_id: string | null;
  meta: unknown;
}

export type AuditLogResult =
  | { ok: true; events: AuditEvent[] }
  | { ok: false; reason: 'not-configured' | 'unauthorized' | 'unreachable' };

const isAuditEvent = (e: unknown): e is AuditEvent =>
  !!e &&
  typeof e === 'object' &&
  typeof (e as { ts?: unknown }).ts === 'string' &&
  typeof (e as { action?: unknown }).action === 'string';

export const fetchAuditEvents = async (): Promise<AuditLogResult> => {
  let base: string;
  try {
    base = getBackendUrl();
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${base}/admin/audit?limit=20`, {
      headers: {
        ...(process.env.EXPO_PUBLIC_API_SECRET
          ? { 'x-api-key': process.env.EXPO_PUBLIC_API_SECRET }
          : {}),
      },
      signal: controller.signal,
    });
    if (response.status === 503) return { ok: false, reason: 'not-configured' };
    if (response.status === 401) return { ok: false, reason: 'unauthorized' };
    if (!response.ok) return { ok: false, reason: 'unreachable' };
    const data = await response.json().catch(() => null);
    const events = Array.isArray((data as { events?: unknown } | null)?.events)
      ? ((data as { events: unknown[] }).events.filter(isAuditEvent) as AuditEvent[])
      : [];
    return { ok: true, events };
  } catch {
    return { ok: false, reason: 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
};
