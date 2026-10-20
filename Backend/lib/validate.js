// ✅ Input validation + sanitization helpers for backend routes.
//
// The backend forwards client-supplied fields into Telegram messages and
// server logs, so only well-formed values may pass through. Everything
// here is dependency-free and unit-testable.

// Strict finite-number check. Accepts numbers and numeric strings;
// rejects booleans, null/undefined, arrays, objects, "" and "12abc".
const isFiniteNumber = (v) => {
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string" && v.trim() !== "") {
    return Number.isFinite(Number(v));
  }
  return false;
};

// Safe coercion — call only after the matching isValid* check passed.
const toNumber = (v) => (typeof v === "number" ? v : Number(String(v).trim()));

const isValidLatitude = (v) =>
  isFiniteNumber(v) && toNumber(v) >= -90 && toNumber(v) <= 90;

const isValidLongitude = (v) =>
  isFiniteNumber(v) && toNumber(v) >= -180 && toNumber(v) <= 180;

// Make free-text fields safe to embed in Telegram messages and logs:
// strip ASCII control characters (they garble messages and can smuggle
// terminal escape sequences into logs) and the Unicode line/paragraph
// separators U+2028/U+2029 (they break line-based log parsing); trim
// whitespace and cap length so one field can't blow past Telegram's
// 4096-char message limit. Accepts finite numbers too (e.g. battery level
// sent as 85, not "85").
const sanitizeText = (v, maxLen = 200) => {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    v = String(v);
  }
  if (typeof v !== "string") return "";
  return v
    .replace(/[\x00-\x1F\x7F\u2028\u2029]/g, "")
    .trim()
    .slice(0, maxLen);
};

module.exports = {
  isFiniteNumber,
  toNumber,
  isValidLatitude,
  isValidLongitude,
  sanitizeText,
};
