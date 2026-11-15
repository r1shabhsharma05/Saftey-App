// Date-of-birth validation for the H15 age gate (register.tsx):
// the user must be at least 13. Input is a YYYY-MM-DD string
// (typed, no date-picker dependency); the check is calendar-exact
// (rejects impossible dates like 2020-02-30 and future dates) and
// compares the 13th birthday against today, so a birthday later
// this year does not count yet.
//
// Age is computed in UTC, mirroring the backend
// (Backend/routes/auth.js ageYearsFromDob): the client used to use
// local calendar midnight, so a user turning 13 today in IST could
// pass the client check and then 400 server-side (UTC date still
// yesterday). UTC on both sides closes that one-day gap.
export const MIN_SIGNUP_AGE = 13;

export type DobValidation =
  | { ok: true; iso: string }
  | { ok: false; error: string };

export function validateDateOfBirth(value: string): DobValidation {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) {
    return { ok: false, error: 'Enter your date of birth as YYYY-MM-DD (for example 2010-05-21).' };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // UTC throughout (see header): Date.UTC + getUTC* so the 13th
  // birthday is judged against the UTC date, exactly like the server.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, error: 'That date of birth is not a real calendar date.' };
  }
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (date.getTime() > todayUtc.getTime()) {
    return { ok: false, error: 'Date of birth cannot be in the future.' };
  }
  const thirteenth = new Date(Date.UTC(year + MIN_SIGNUP_AGE, month - 1, day));
  if (thirteenth.getTime() > todayUtc.getTime()) {
    return {
      ok: false,
      error: `You must be at least ${MIN_SIGNUP_AGE} years old to create a SafeLife account.`,
    };
  }
  return { ok: true, iso: trimmed };
}
