// Persistent shared tire marks (see truck/TireMarks.js). A completed streak —
// one wheel's mark, start to finish — is the natural save unit: only the
// streak's raw geometry is stored (position + perpendicular offset + alpha
// per point), never colour or height, since both are cheaply recomputed at
// replay time the same way a live streak computes them (see
// TireMarks.appendHistory's `colorForPoint`/`sampleY`).
//
// Saved per track in IndexedDB (CacheStore), compactly (schema 3): every
// number is quantized to an integer and written as a varint. Per streak: point
// count, half-width (mm); per point: x, z and y as deltas from the previous
// point (cm), heading as a delta (centiradians, wrapped), and alpha (percent).
// y is the truck's height when the point was laid, which replay samples the
// surface down from, so a mark lands on the layer it was made on (a tunnel
// floor rather than the hill above it; ground under a bridge, not the deck). A point's `offsetX/offsetZ` is always
// halfWidth × (cos, −sin) of the truck heading, so one angle replaces two
// floats. About 4 bytes a point, against ~70 characters for the schema-1 JSON
// that used to live in localStorage and could fill its whole quota with two or
// three tracks' marks (those saves are no longer read, nor are schema 2's,
// which had no y).
// Precision: 1 cm, 0.01 rad (≤2 mm at the mark's edge), 1% alpha.

import { TIRE_MARKS_STORE, cacheDelete, cacheGet, cachePut } from "./CacheStore.js";

export const TIRE_MARKS_SCHEMA_VERSION = 3;
// FIFO cap on saved streaks (not points) — a streak is the unit a player
// actually perceives as "one mark", and capping at this level keeps the
// saved data bounded regardless of how many long/short streaks accumulate.
export const TIRE_MARKS_MAX_STREAKS = 600;

const ANGLE_STEPS = Math.round(2 * Math.PI * 100); // centiradians per turn

// ─── Encoding ────────────────────────────────────────────────────────────────

function writeUint(bytes, u) {
  while (u >= 0x80) {
    bytes.push((u & 0x7f) | 0x80);
    u >>>= 7;
  }
  bytes.push(u);
}

// Zigzag: small negative and positive values both become small unsigned ones.
function writeInt(bytes, v) {
  writeUint(bytes, v >= 0 ? v * 2 : -v * 2 - 1);
}

function wrapAngle(steps) {
  const half = ANGLE_STEPS / 2;
  return ((((steps + half) % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS) - half;
}

/** Streaks → bytes (schema 3). */
export function encodeTireMarkStreaks(streaks) {
  const bytes = [];
  writeUint(bytes, streaks.length);
  for (const { points } of streaks) {
    writeUint(bytes, points.length);
    const first = points[0];
    const halfWidth = first ? Math.hypot(first.offsetX, first.offsetZ) : 0;
    writeUint(bytes, Math.round(halfWidth * 1000));
    let px = 0, pz = 0, py = 0, pa = 0;
    for (const p of points) {
      const x = Math.round(p.x * 100);
      const z = Math.round(p.z * 100);
      const y = Math.round((p.y ?? 0) * 100);
      const a = Math.round(Math.atan2(-p.offsetZ, p.offsetX) * 100);
      writeInt(bytes, x - px);
      writeInt(bytes, z - pz);
      writeInt(bytes, y - py);
      writeInt(bytes, wrapAngle(a - pa));
      writeUint(bytes, Math.max(0, Math.min(100, Math.round(p.alpha * 100))));
      px = x; pz = z; py = y; pa = a;
    }
  }
  return Uint8Array.from(bytes);
}

/** Bytes (schema 3) → streaks. Throws on malformed input. */
export function decodeTireMarkStreaks(bytes) {
  let i = 0;
  const readUint = () => {
    let u = 0, shift = 0, b;
    do {
      if (i >= bytes.length) throw new Error("truncated tire-mark data");
      b = bytes[i++];
      u += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return u;
  };
  const readInt = () => {
    const u = readUint();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  };

  const streaks = [];
  const streakCount = readUint();
  for (let s = 0; s < streakCount; s++) {
    const count = readUint();
    const halfWidth = readUint() / 1000;
    const points = [];
    let x = 0, z = 0, y = 0, a = 0;
    for (let k = 0; k < count; k++) {
      x += readInt();
      z += readInt();
      y += readInt();
      a = wrapAngle(a + readInt());
      const angle = a / 100;
      points.push({
        x: x / 100,
        z: z / 100,
        y: y / 100,
        offsetX: Math.cos(angle) * halfWidth,
        offsetZ: -Math.sin(angle) * halfWidth,
        alpha: readUint() / 100,
      });
    }
    streaks.push({ points });
  }
  return streaks;
}

// ─── Storage ─────────────────────────────────────────────────────────────────

/**
 * Saved streaks for a track — [{points:[{x,z,y,offsetX,offsetZ,alpha}]}], oldest
 * first. Resolves [] if none/invalid; never rejects.
 */
export async function loadTireMarkStreaks(trackKey) {
  const record = await cacheGet(TIRE_MARKS_STORE, trackKey);
  if (record?.version !== TIRE_MARKS_SCHEMA_VERSION || !(record.bytes instanceof Uint8Array)) return [];
  try {
    return decodeTireMarkStreaks(record.bytes).slice(-TIRE_MARKS_MAX_STREAKS);
  } catch {
    return [];
  }
}

/**
 * Persist a track's tire-mark streaks. Encoded now (a snapshot: the caller
 * keeps appending to its streaks); the IndexedDB write itself is async.
 */
export function saveTireMarkStreaks(trackKey, streaks) {
  const bytes = encodeTireMarkStreaks(streaks.slice(-TIRE_MARKS_MAX_STREAKS));
  return cachePut(TIRE_MARKS_STORE, trackKey, { version: TIRE_MARKS_SCHEMA_VERSION, bytes });
}

/** Delete all saved tire marks for a track. */
export function deleteTireMarkStreaks(trackKey) {
  return cacheDelete(TIRE_MARKS_STORE, trackKey);
}
