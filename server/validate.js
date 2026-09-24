/**
 * Input hygiene for DriveRoom. Every value a client sends is either rebuilt
 * from whitelisted, type-checked fields here or dropped — nothing a client
 * sends is relayed verbatim. Pure functions, unit-tested in
 * test/server-validate.test.js.
 *
 * This is hygiene, not anti-cheat: clients still simulate their own truck and
 * self-report laps (see docs/MULTIPLAYER.md). It stops malformed or hostile
 * payloads from reaching other players, and the cheap impossible cases
 * (lap skipping, finishing before the last lap).
 */

export const MAX_CLIENTS_LIMIT = 8;
export const MAX_LAPS = 20;
const MAX_COORD = 5000;          // m — far beyond any track
const MAX_SPEED = 200;           // m/s — far beyond any truck
const MAX_RACE_MS = 6 * 3600e3;  // a finish time longer than this is bogus
const NAME_LEN = 24;
const LOBBY_NAME_LEN = 40;
const KEY_LEN = 64;

// "state" rate limit — clients send at 15 Hz (NETWORK_SEND_INTERVAL in
// MultiplayerMode). A token bucket allows network bunching up to STATE_BURST
// messages, sustained up to STATE_RATE/s; the excess is dropped (the next
// update supersedes it anyway).
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

/**
 * Truck state → a fresh object of exactly the relayed fields, or null if the
 * position is missing/non-finite/out of range (the whole message is dropped).
 * Velocity is optional (the client doesn't send it today) and clamped.
 */
export function cleanState(data) {
  if (!data || typeof data !== "object") return null;
  const { x, y, z, heading } = data;
  if (![x, y, z, heading].every(isNum)) return null;
  if ([x, y, z].some((v) => Math.abs(v) > MAX_COORD)) return null;
  const vel = (v) => (isNum(v) ? clamp(v, -MAX_SPEED, MAX_SPEED) : 0);
  return { x, y, z, heading, vx: vel(data.vx), vy: vel(data.vy), vz: vel(data.vz) };
}

/** A reported lap is only accepted as the next lap, within the race length. */
export function isValidLap(reported, currentLap, totalLaps) {
  return Number.isInteger(reported) && reported === currentLap + 1 && reported <= totalLaps;
}

/** Positive, finite, sane race time in ms, else null. */
export function cleanTimeMs(value) {
  return isNum(value) && value > 0 && value < MAX_RACE_MS ? value : null;
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
