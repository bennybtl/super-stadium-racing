// Persistent shared tire marks (see truck/TireMarks.js). A completed streak —
// one wheel's mark, start to finish — is the natural save unit: only the
// streak's raw geometry is stored (position + perpendicular offset + alpha
// per point), never colour or height, since both are cheaply recomputed at
// replay time the same way a live streak computes them (see
// TireMarks.appendHistory's `colorForPoint`/`sampleY`).
//
// Stored compactly (schema 2): every number is quantized to an integer and
// written as a varint, and the byte string is base64'd into localStorage.
// Per streak: point count, half-width (mm); per point: x and z as deltas from
// the previous point (cm), heading as a delta (centiradians, wrapped), and
// alpha (percent). A point's `offsetX/offsetZ` is always
// halfWidth × (cos, −sin) of the truck heading, so one angle replaces two
// floats. About 6 characters a point, against ~70 for the schema-1 JSON, which
// could fill the whole localStorage quota with two or three tracks' marks
// (schema-1 saves are no longer read).
// Precision: 1 cm, 0.01 rad (≤2 mm at the mark's edge), 1% alpha.

export const TIRE_MARKS_STORAGE_PREFIX = "tireMarks_";
const STORAGE_PREFIX = TIRE_MARKS_STORAGE_PREFIX;
export const TIRE_MARKS_SCHEMA_VERSION = 2;
// FIFO cap on saved streaks (not points) — a streak is the unit a player
// actually perceives as "one mark", and capping at this level keeps the
// saved data bounded regardless of how many long/short streaks accumulate.
export const TIRE_MARKS_MAX_STREAKS = 600;

const ANGLE_STEPS = Math.round(2 * Math.PI * 100); // centiradians per turn

function storageKey(trackKey) {
  return STORAGE_PREFIX + trackKey;
}

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

/** Streaks → base64 string (schema 2). */
export function encodeTireMarkStreaks(streaks) {
  const bytes = [];
  writeUint(bytes, streaks.length);
  for (const { points } of streaks) {
    writeUint(bytes, points.length);
    const first = points[0];
    const halfWidth = first ? Math.hypot(first.offsetX, first.offsetZ) : 0;
    writeUint(bytes, Math.round(halfWidth * 1000));
    let px = 0, pz = 0, pa = 0;
    for (const p of points) {
      const x = Math.round(p.x * 100);
      const z = Math.round(p.z * 100);
      const a = Math.round(Math.atan2(-p.offsetZ, p.offsetX) * 100);
      writeInt(bytes, x - px);
      writeInt(bytes, z - pz);
      writeInt(bytes, wrapAngle(a - pa));
      writeUint(bytes, Math.max(0, Math.min(100, Math.round(p.alpha * 100))));
      px = x; pz = z; pa = a;
    }
  }
  let binary = "";
  const CHUNK = 0x8000; // keep String.fromCharCode's argument count in bounds
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
  }
  return btoa(binary);
}

/** base64 string (schema 2) → streaks. Throws on malformed input. */
export function decodeTireMarkStreaks(base64) {
  const binary = atob(base64);
  let i = 0;
  const readUint = () => {
    let u = 0, shift = 0, b;
    do {
      if (i >= binary.length) throw new Error("truncated tire-mark data");
      b = binary.charCodeAt(i++);
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
    let x = 0, z = 0, a = 0;
    for (let k = 0; k < count; k++) {
      x += readInt();
      z += readInt();
      a = wrapAngle(a + readInt());
      const angle = a / 100;
      points.push({
        x: x / 100,
        z: z / 100,
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

function storedValue(streaks) {
  return JSON.stringify({ version: TIRE_MARKS_SCHEMA_VERSION, data: encodeTireMarkStreaks(streaks) });
}

/** Saved streaks for a track — [{points:[{x,z,offsetX,offsetZ,alpha}]}], oldest first. [] if none/invalid. */
export function loadTireMarkStreaks(trackKey) {
  try {
    const raw = localStorage.getItem(storageKey(trackKey));
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.version !== TIRE_MARKS_SCHEMA_VERSION || typeof data.data !== "string") return [];
    return decodeTireMarkStreaks(data.data).slice(-TIRE_MARKS_MAX_STREAKS);
  } catch {
    return [];
  }
}

/**
 * Persist a track's tire-mark streaks. Encoded now (a snapshot: the caller
 * keeps appending to its streaks), written deferred off the caller's frame
 * (same pattern as the other *Storage modules) so a periodic save never hitches.
 */
export function saveTireMarkStreaks(trackKey, streaks) {
  const value = storedValue(streaks.slice(-TIRE_MARKS_MAX_STREAKS));
  setTimeout(() => {
    try {
      localStorage.setItem(storageKey(trackKey), value);
    } catch (e) {
      console.warn("[TireMarksStorage] Failed to persist tire marks:", e?.name ?? e);
    }
  }, 0);
}

/** Delete all saved tire marks for a track. */
export function deleteTireMarkStreaks(trackKey) {
  try {
    localStorage.removeItem(storageKey(trackKey));
  } catch {}
}
