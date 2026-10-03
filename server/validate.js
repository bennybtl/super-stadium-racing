/**
 * Input hygiene for the race lobbies. Every value a client sends is rebuilt
 * from type-checked fields here or dropped. Pure functions, unit-tested in
 * test/server-validate.test.js.
 */

export const MAX_CLIENTS_LIMIT = 8;
export const MAX_LAPS = 20;
const NAME_LEN = 24;
const LOBBY_NAME_LEN = 40;
const KEY_LEN = 64;

// Default token-bucket limits: bunching up to STATE_BURST messages, sustained
// up to STATE_RATE/s.
export const STATE_RATE = 30;
export const STATE_BURST = 10;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Display text: string, control characters stripped, trimmed, capped. */
export function cleanText(value, fallback, maxLen = NAME_LEN) {
  if (typeof value !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLen);
  return s || fallback;
}

/**
 * Identifier (track / vehicle / colour key) or null. Track keys come from
 * filenames, so any printable text is allowed — only type and length are
 * enforced, and control characters rejected.
 */
export function cleanKey(value) {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" && value.length > 0 && value.length <= KEY_LEN && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

export function cleanLobbyName(value) {
  return cleanText(value, "Lobby", LOBBY_NAME_LEN);
}

export function cleanMaxClients(value, fallback) {
  return isNum(value) ? clamp(Math.round(value), 2, MAX_CLIENTS_LIMIT) : fallback;
}

export function cleanLaps(value, fallback) {
  return isNum(value) ? clamp(Math.round(value), 1, MAX_LAPS) : fallback;
}

/** Token-bucket limiter; one bucket object per client. */
export function takeToken(bucket, nowMs, rate = STATE_RATE, burst = STATE_BURST) {
  if (bucket.at === undefined) {
    bucket.tokens = burst;
    bucket.at = nowMs;
  }
  bucket.tokens = Math.min(burst, bucket.tokens + ((nowMs - bucket.at) * rate) / 1000);
  bucket.at = nowMs;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
