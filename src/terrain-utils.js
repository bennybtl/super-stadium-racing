/**
 * Shared terrain texture utilities
 */

import { TERRAIN_TYPES } from "./terrain.js";
import { expandPolyline } from "./polyline-utils.js";
import { createWaterDepthSampler } from "./objects/water-field.js";
import { clamp, lerp, smoothstep } from "./math-utils.js";

const TERRAIN_TYPE_LIST = Object.values(TERRAIN_TYPES);
const TERRAIN_TYPE_INDEX = new Map(TERRAIN_TYPE_LIST.map((terrainType, index) => [terrainType, index]));

export const DEFAULT_TERRAIN_WEAR_CONFIG = Object.freeze({
  enabled: true,
  source: 'aiPath',
  alphaBreakup: 0.28,
  width: 4.0,
  intensity: 0.8,
  laneSpacing: 2.0,
  pathWander: 0.7,
  edgeSoftness: 1.0,
  secondaryPathCount: 60,
  secondaryPathStrength: 0.8,
  secondaryPathSpacing: 0.04,
  seed: 1337,
});

// Depth over which wear fades out under water, mirroring the 20°–28° slope fade
// below. A ford stays marked — the path really is driven through it — so the
// fade only starts once the water is deeper than a wheel is tall, and is
// complete by roughly axle depth.
const WEAR_WATER_FADE_START = 0.15;
export const WEAR_WATER_FADE_END = 0.6;
// Scalar math now lives in math-utils.js; re-exported under the historical
// underscore names so existing terrain code keeps working.
export { clamp as _clamp, lerp as _lerp, smoothstep as _smoothstep };

function _createSeededRandom(seed = 1337) {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function _distance2d(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function _sampleClosedPath(points, spacing) {
  if (!Array.isArray(points) || points.length < 2) return [];

  const safeSpacing = Math.max(0.25, spacing);
  const samples = [];
  const segmentLengths = [];
  let totalLength = 0;

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const length = _distance2d(a, b);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength < 0.01) return [];

  let segmentIndex = 0;
  let segmentStart = 0;
  let segmentLength = segmentLengths[0];

  for (let dist = 0; dist < totalLength; dist += safeSpacing) {
    while (segmentLength > 0 && dist > segmentStart + segmentLength && segmentIndex < points.length - 1) {
      segmentStart += segmentLength;
      segmentIndex += 1;
      segmentLength = segmentLengths[segmentIndex];
    }

    const start = points[segmentIndex];
    const end = points[(segmentIndex + 1) % points.length];
    const t = segmentLength > 0.001 ? (dist - segmentStart) / segmentLength : 0;
    samples.push({
      x: lerp(start.x, end.x, t),
      z: lerp(start.z, end.z, t),
    });
  }

  return samples;
}

// Scratch buffers reused across wear bakes. At the default 2000² texture each
// is 16MB; allocating them fresh per editor rebake caused visible GC hitches.
// Every consumer fully overwrites the pixels it reads back, so no zeroing is
// needed here (the stamp accumulator in buildTerrainWearOverlayPixelData is
// the exception and fill(0)s itself).
let _blurTmpBuffer = null;
let _blurOutBuffer = null;
let _wearAccumBuffer = null;

function _getScratchBuffer(current, length, Kind = Uint8ClampedArray) {
  return current instanceof Kind && current.length === length ? current : new Kind(length);
}

function _blurAlpha(data, width, height, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0) return data;

  const tmp = _blurTmpBuffer = _getScratchBuffer(_blurTmpBuffer, data.length);
  const out = _blurOutBuffer = _getScratchBuffer(_blurOutBuffer, data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let totalR = 0, totalG = 0;
      let weight = 0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = clamp(x + dx, 0, width - 1);
        const base = (y * width + sx) * 4;
        const w = r + 1 - Math.abs(dx);
        totalR += data[base] * w;
        totalG += data[base + 1] * w;
        weight += w;
      }
      const outIndex = (y * width + x) * 4;
      tmp[outIndex] = Math.round(totalR / Math.max(1, weight));
      tmp[outIndex + 1] = Math.round(totalG / Math.max(1, weight));
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let totalR = 0, totalG = 0;
      let weight = 0;
      for (let dy = -r; dy <= r; dy++) {
        const sy = clamp(y + dy, 0, height - 1);
        const base = (sy * width + x) * 4;
        const w = r + 1 - Math.abs(dy);
        totalR += tmp[base] * w;
        totalG += tmp[base + 1] * w;
        weight += w;
      }
      const outIndex = (y * width + x) * 4;
      out[outIndex] = Math.round(totalR / Math.max(1, weight));
      out[outIndex + 1] = Math.round(totalG / Math.max(1, weight));
      out[outIndex + 2] = 0;
      out[outIndex + 3] = 0;
    }
  }

  return out;
}

function _wrapSampleDistance(index, start, total) {
  const direct = index - start;
  const wrapped = direct < 0 ? direct + total : direct;
  return wrapped;
}

export function _getTerrainSlopeDegAt(track, x, z, sampleDistance) {
  if (!track) return 0;
  const d = Math.max(0.25, sampleDistance);
  const dx = track.getHeightAt(x + d, z) - track.getHeightAt(x - d, z);
  const dz = track.getHeightAt(x, z + d) - track.getHeightAt(x, z - d);
  const rise = Math.sqrt(dx * dx + dz * dz) / (2 * d);
  return Math.atan(rise) * 180 / Math.PI;
}

export function applySteepWaterTerrainRemap(terrainManager, track, options = {}) {
  const slopeThreshold = options.slopeThreshold ?? 10;
  const sampleDistance = options.sampleDistance ?? 2.5;
  const cellsPerSide = terrainManager?.cellsPerSide ?? 0;
  if (!track || cellsPerSide <= 0) return;

  const worldWidth = terrainManager.worldWidth ?? terrainManager.gridSize;
  const worldDepth = terrainManager.worldDepth ?? terrainManager.gridSize;
  const halfWorldW = worldWidth / 2;
  const halfWorldD = worldDepth / 2;
  for (let row = 0; row < cellsPerSide; row++) {
    for (let col = 0; col < cellsPerSide; col++) {
      const index = row * cellsPerSide + col;
      const cell = terrainManager.grid[index];
      if (cell?.name !== 'water') continue;

      const worldX = ((col + 0.5) / cellsPerSide) * worldWidth - halfWorldW;
      const worldZ = ((row + 0.5) / cellsPerSide) * worldDepth - halfWorldD;
      const slopeDeg = _getTerrainSlopeDegAt(track, worldX, worldZ, sampleDistance * terrainManager.cellSize);
      if (slopeDeg >= slopeThreshold) {
        terrainManager.grid[index] = TERRAIN_TYPES.MUD;
      }
    }
  }
}

export function applySteepGrassTerrainRemap(terrainManager, track, options = {}) {
  const slopeStart = options.slopeStart ?? 16;
  const sampleDistance = options.sampleDistance ?? 2.5;
  const cellsPerSide = terrainManager?.cellsPerSide ?? 0;
  if (!track || cellsPerSide <= 0) return;

  const worldWidth = terrainManager.worldWidth ?? terrainManager.gridSize;
  const worldDepth = terrainManager.worldDepth ?? terrainManager.gridSize;
  const halfWorldW = worldWidth / 2;
  const halfWorldD = worldDepth / 2;
  for (let row = 0; row < cellsPerSide; row++) {
    for (let col = 0; col < cellsPerSide; col++) {
      const index = row * cellsPerSide + col;
      const cell = terrainManager.grid[index];
      if (cell?.name !== 'grass') continue;

      const worldX = ((col + 0.5) / cellsPerSide) * worldWidth - halfWorldW;
      const worldZ = ((row + 0.5) / cellsPerSide) * worldDepth - halfWorldD;
      const slopeDeg = _getTerrainSlopeDegAt(track, worldX, worldZ, sampleDistance * terrainManager.cellSize);
      if (slopeDeg >= slopeStart) {
        terrainManager.grid[index] = TERRAIN_TYPES.LOAMY_DIRT;
      }
    }
  }
}

export function buildTerrainIdTexturePixelData(terrainManager) {
  const n = terrainManager.cellsPerSide;
  const data = new Uint8Array(n * n * 4);

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      const typeIndex = cell ? (TERRAIN_TYPE_INDEX.get(cell) ?? 0) : 0;
      const base = (row * n + col) * 4;
      data[base] = typeIndex;
      data[base + 1] = 0;
      data[base + 2] = 0;
      data[base + 3] = 255;
    }
  }

  return { width: n, height: n, data };
}

export function updateTerrainIdTexture(terrainIdTex, terrainManager) {
  const idData = buildTerrainIdTexturePixelData(terrainManager);
  terrainIdTex.update(idData.data);
}

export function buildTerrainTypePropertyTexturePixelData() {
  const width = TERRAIN_TYPE_LIST.length;
  const height = 1;
  const data = new Uint8Array(width * height * 4);
  const normalMapNames = [];
  const normalMapIndexMap = new Map();
  for (let i = 0; i < width; i++) {
    const terrainType = TERRAIN_TYPE_LIST[i];
    const r = Math.round((terrainType.color?.r ?? 0) * 255);
    const g = Math.round((terrainType.color?.g ?? 0) * 255);
    const b = Math.round((terrainType.color?.b ?? 0) * 255);
    const spec = Math.round((terrainType.specular ?? 0.03) * 255);
    const base = i * 4;
    data[base] = r;
    data[base + 1] = g;
    data[base + 2] = b;
    data[base + 3] = spec;

    // Track normal map names for future GPU normal map sampling.
    const normalMapName = terrainType.normalMap || "";
    if (normalMapName && !normalMapIndexMap.has(normalMapName)) {
      normalMapIndexMap.set(normalMapName, normalMapNames.length);
      normalMapNames.push(normalMapName);
    }
  }

  return { width, height, data, normalMapNames };
}

// Deterministically trace the AI-path wear lanes into stamp descriptors. Both the
// colour overlay (buildTerrainWearOverlayPixelData) and the rut normal-map pass
// (createCompositeNormalMap) consume the SAME stamps — seeded identically — so the
// discolouration and the lit relief stay perfectly aligned.
export function traceAiPathWearStamps(track, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const width = Math.max(4, Math.round(textureSize));
  const height = width;
  const stamps = [];

  const wear = {
    ...DEFAULT_TERRAIN_WEAR_CONFIG,
    ...(track?.wear ?? {}),
  };
  if (!wear.enabled || wear.source !== 'aiPath') return { width, height, edgeSoftness: 1, stamps };

  const aiPath = track?.features?.find(feature => feature.type === 'aiPath');
  const points = aiPath?.points;
  if (!Array.isArray(points) || points.length < 3) return { width, height, edgeSoftness: 1, stamps };

  const smoothingRadius = clamp(wear.width * 4.2, 1, 30);
  const smoothedPoints = expandPolyline(
    points.map(point => ({ ...point, radius: smoothingRadius })),
    true
  );
  if (!Array.isArray(smoothedPoints) || smoothedPoints.length < 3) return { width, height, edgeSoftness: 1, stamps };

  const pixelsPerUnitX = width / Math.max(1, worldWidth);
  const pixelsPerUnitZ = height / Math.max(1, worldDepth);
  const sampleSpacing = clamp(wear.width * 0.2, 0.5, 1.0);
  const samples = _sampleClosedPath(smoothedPoints, sampleSpacing);
  if (samples.length < 3) return { width, height, edgeSoftness: 1, stamps };

  const rng = _createSeededRandom(wear.seed);
  const waterDepthAt = createWaterDepthSampler(track);
  const halfWorldX = worldWidth / 2;
  const halfWorldZ = worldDepth / 2;
  const mainLaneOffset = Math.max(0.35, wear.laneSpacing * 0.5);
  const secondaryPathSpacing = Math.max(0, wear.secondaryPathSpacing ?? 0.1);
  const sideLaneOffset = mainLaneOffset + Math.max(0.9, wear.width * 0.5) * secondaryPathSpacing;
  const pixelsPerUnit = (pixelsPerUnitX + pixelsPerUnitZ) * 0.5;
  const majorRadiusX = Math.max(2.5, pixelsPerUnit * wear.width * 0.28);
  const majorRadiusY = Math.max(6, majorRadiusX * 2.8);
  const minorRadiusX = Math.max(1.8, majorRadiusX * 0.62);
  const minorRadiusY = Math.max(4.5, majorRadiusY * 0.82);
  const edgeSoftness = clamp(wear.edgeSoftness, 0.1, 1.5);
  const secondaryPathStrength = clamp(wear.secondaryPathStrength ?? 0.62, 0, 3);

  const mainLanes = [
    { offset: -mainLaneOffset, alpha: 1.0, radiusX: majorRadiusX, radiusY: majorRadiusY, lighten: false },
    { offset: mainLaneOffset, alpha: 0.96, radiusX: majorRadiusX, radiusY: majorRadiusY, lighten: false },
  ];

  const sideWearPaths = [];
  const buildSideWearPaths = (sideSign) => {
    const pathCount = Math.max(0, Math.round(wear.secondaryPathCount ?? 60));
    const minLength = Math.max(10, Math.round(samples.length * 0.06));
    const maxLength = Math.max(minLength + 4, Math.round(samples.length * 0.18));
    const bandSpacing = Math.max(0.6, wear.laneSpacing * 0.75) * secondaryPathSpacing;

    for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
      const span = minLength + Math.floor(rng() * (maxLength - minLength + 1));
      const fade = Math.max(3, Math.min(Math.round(span * 0.2), 14));
      const bandIndex = 1 + pathIndex;
      sideWearPaths.push({
        start: Math.floor(rng() * samples.length),
        span,
        fade,
        offset: sideSign * (sideLaneOffset + bandIndex * bandSpacing + (rng() - 0.5) * bandSpacing * 0.45),
        alpha: (0.52 + rng() * 0.22) * secondaryPathStrength,
        radiusX: minorRadiusX * (0.95 + rng() * 0.4),
        radiusY: minorRadiusY * (0.9 + rng() * 0.35),
        lighten: rng() > 0.5,
      });
    }
  };

  buildSideWearPaths(-1);
  buildSideWearPaths(1);

  // Smooth per-lane lateral wander: sum of two low-frequency sines so lanes
  // gradually deviate from their base offset instead of forming parallel stripes.
  const n = samples.length;
  const wanderAmplitude = wear.width * (wear.pathWander ?? 0.5);
  const makeWanderFn = (amp) => {
    const phA = rng() * Math.PI * 2;
    const phB = rng() * Math.PI * 2;
    const frA = 1.8 + rng() * 2.4; // 1.8–4.2 cycles around the track
    const frB = 3.6 + rng() * 2.0; // higher harmonic for secondary shape
    return (i) => amp * (
      Math.sin((i / n) * Math.PI * 2 * frA + phA) * 0.65 +
      Math.sin((i / n) * Math.PI * 2 * frB + phB) * 0.35
    );
  };
  const makePresenceFn = () => {
    const phA = rng() * Math.PI * 2;
    const phB = rng() * Math.PI * 2;
    const frA = 1.2 + rng() * 2.0; // 1.2–3.2 cycles — more fades per lap
    const frB = 2.8 + rng() * 2.2;
    return (i) => {
      const t = (i / n) * Math.PI * 2;
      const wave =
        Math.sin(t * frA + phA) * 0.62 +
        Math.sin(t * frB + phB) * 0.38;
      return (wave * 1.4) * 0.5 + 0.5; // amplitude >1 so output regularly hits 0 and 1
    };
  };
  for (const lane of mainLanes) {
    lane.wanderFn = makeWanderFn(wanderAmplitude);
    lane.presenceFn = makePresenceFn();
  }
  for (const lane of sideWearPaths) {
    lane.wanderFn = makeWanderFn(wanderAmplitude * 0.85);
    lane.presenceFn = makePresenceFn();
  }

  const stamp = (centerX, centerZ, tangentX, tangentZ, lane) => {
    const normalX = -tangentZ;
    const normalZ = tangentX;
    const laneX = centerX + normalX * lane.offset;
    const laneZ = centerZ + normalZ * lane.offset;
    const sx = (laneX + halfWorldX) * pixelsPerUnitX;
    const sy = (laneZ + halfWorldZ) * pixelsPerUnitZ;
    // Record the lane stamp; rasterization (colour or rut normals) happens in the
    // consumer via forEachStampPixel so both share identical geometry.
    stamps.push({
      sx, sy, tangentX, tangentZ, normalX, normalZ,
      radiusX: lane.radiusX, radiusY: lane.radiusY,
      alpha: lane.alpha, lighten: lane.lighten,
    });
  };

  for (let i = 0; i < samples.length; i++) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const curr = samples[i];
    const next = samples[(i + 1) % samples.length];
    let tangentX = next.x - prev.x;
    let tangentZ = next.z - prev.z;
    const tangentLength = Math.sqrt(tangentX * tangentX + tangentZ * tangentZ);
    if (tangentLength < 1e-5) continue;
    tangentX /= tangentLength;
    tangentZ /= tangentLength;

    const curveX1 = curr.x - prev.x;
    const curveZ1 = curr.z - prev.z;
    const curveX2 = next.x - curr.x;
    const curveZ2 = next.z - curr.z;
    const cross = curveX1 * curveZ2 - curveZ1 * curveX2;
    const curvatureBoost = clamp(Math.abs(cross) / 4, 0, 1);
    const alphaBreak = (rng() - 0.5) * wear.alphaBreakup;
    const alphaBase = wear.intensity * (1 + curvatureBoost * 0.35 + alphaBreak) * lerp(0.70, 2.0, curvatureBoost);
    const presenceThreshold = lerp(0.55, 0.18, curvatureBoost);

    // Steepness fade: sample height along tangent and normal, take max slope angle.
    const PROBE = 1.0; // metres between height probes
    const hFwd  = track.getHeightAt(curr.x + tangentX * PROBE, curr.z + tangentZ * PROBE);
    const hBack = track.getHeightAt(curr.x - tangentX * PROBE, curr.z - tangentZ * PROBE);
    const hLeft = track.getHeightAt(curr.x - tangentZ * PROBE, curr.z + tangentX * PROBE);
    const hRight= track.getHeightAt(curr.x + tangentZ * PROBE, curr.z - tangentX * PROBE);
    const slopeDeg = Math.max(
      Math.abs(Math.atan2(hFwd - hBack, PROBE * 2) * (180 / Math.PI)),
      Math.abs(Math.atan2(hLeft - hRight, PROBE * 2) * (180 / Math.PI))
    );
    const steepnessFade = 1 - smoothstep(20, 28, slopeDeg);

    // Wear under water fades the same way, and for the same reason: ruts and
    // discolouration are dry-ground detail. Sampled on the centreline like the
    // slope above, so both read the path the same way.
    const submergedFade = 1 - smoothstep(
      WEAR_WATER_FADE_START, WEAR_WATER_FADE_END, waterDepthAt(curr.x, curr.z)
    );

    for (const lane of mainLanes) {
      const lanePresence = smoothstep(
        presenceThreshold - 0.08,
        presenceThreshold + 0.08,
        lane.presenceFn(i)
      );
      stamp(curr.x, curr.z, tangentX, tangentZ, {
        offset: lane.offset + lane.wanderFn(i),
        alpha: Math.max(0, lane.alpha * alphaBase * lanePresence * steepnessFade * submergedFade),
        radiusX: lane.radiusX * (1 + curvatureBoost * 0.18),
        radiusY: lane.radiusY * (1 + curvatureBoost * 0.08),
        lighten: lane.lighten,
      });
    }

    for (const lane of sideWearPaths) {
      const dist = _wrapSampleDistance(i, lane.start, samples.length);
      if (dist >= lane.span) continue;

      let segmentAlpha = 1;
      if (dist < lane.fade) {
        segmentAlpha *= smoothstep(0, lane.fade, dist);
      }
      const distToEnd = lane.span - dist;
      if (distToEnd < lane.fade) {
        segmentAlpha *= smoothstep(0, lane.fade, distToEnd);
      }

      const lanePresence = smoothstep(
        presenceThreshold - 0.08,
        presenceThreshold + 0.08,
        lane.presenceFn(i)
      );

      stamp(curr.x, curr.z, tangentX, tangentZ, {
        offset: lane.offset + lane.wanderFn(i),
        alpha: Math.max(0, lane.alpha * alphaBase * segmentAlpha * lanePresence * steepnessFade * submergedFade),
        radiusX: lane.radiusX * (1 + curvatureBoost * 0.22),
        radiusY: lane.radiusY * (1 + curvatureBoost * 0.16),
        lighten: lane.lighten,
      });
    }
  }

  return { width, height, edgeSoftness, stamps };
}

/**
 * Rasterize one wear stamp's elliptical footprint, invoking `cb(x, y, weight,
 * acrossNorm)` per covered pixel. `weight` is the edge-faded alpha (0–1) and
 * `acrossNorm` is the signed across-lane position (−1 wall … 0 centre … +1 wall),
 * which the rut normal pass uses to shape the groove cross-section.
 */
function forEachStampPixel(stamp, width, height, edgeSoftness, cb) {
  const { sx, sy, tangentX, tangentZ, normalX, normalZ, radiusX, radiusY, alpha } = stamp;
  // Over half the stamps come out of the trace at zero alpha — squeezed out by
  // the presence gate, the steepness fade, or standing water. They cover pixels
  // that would each be written with a weight of exactly zero.
  if (alpha === 0) return;

  // Exact bounds of the rotated ellipse, rather than a square of its longer
  // radius: these stamps are ~3x longer than they are wide, so the square spent
  // most of its area outside the shape (measured 16-20% of tested pixels landed
  // inside it).
  const padX = Math.ceil(Math.sqrt((radiusY * tangentX) ** 2 + (radiusX * normalX) ** 2) + 2);
  const padY = Math.ceil(Math.sqrt((radiusY * tangentZ) ** 2 + (radiusX * normalZ) ** 2) + 2);
  const minX = clamp(Math.floor(sx - padX), 0, width - 1);
  const maxX = clamp(Math.ceil(sx + padX), 0, width - 1);
  const minY = clamp(Math.floor(sy - padY), 0, height - 1);
  const maxY = clamp(Math.ceil(sy + padY), 0, height - 1);

  const invRadiusX2 = 1 / Math.max(1e-6, radiusX * radiusX);
  const invRadiusY2 = 1 / Math.max(1e-6, radiusY * radiusY);
  const innerEdge = 1 - edgeSoftness;

  for (let y = minY; y <= maxY; y++) {
    const dy = y - sy;
    for (let x = minX; x <= maxX; x++) {
      const dx = x - sx;
      const localX = dx * tangentX + dy * tangentZ;
      const localY = dx * normalX + dy * normalZ;

      // Squared test first: only pixels that land inside pay for the root.
      const ellipse2 = localY * localY * invRadiusX2 + localX * localX * invRadiusY2;
      if (ellipse2 >= 1) continue;

      const falloff = 1 - smoothstep(innerEdge, 1, Math.sqrt(ellipse2));
      const weight = clamp(alpha * falloff, 0, 1);
      const acrossNorm = localY / Math.max(1e-6, radiusX);
      cb(x, y, weight, acrossNorm);
    }
  }
}

// Rut relief, applied to the composite normal map.
const RUT_STRENGTH = 0.5; // groove-wall steepness (tangent tilt magnitude)
const RUT_OPACITY  = 0.85; // how strongly ruts override the underlying normals

let _wearBakeCache = null;
let _rutLayerBuffer = null;

/**
 * Rasterize the AI-path wear once into both layers that consume it: the colour
 * overlay (R lighten / G darken) and the rut-normal layer.
 *
 * The two are baked into different textures on separate schedules, so they can't
 * simply be merged into one call. Instead the expensive part — walking every
 * stamp's pixels — happens once and is cached, and whichever consumer runs
 * second gets its layer for free.
 *
 * The cache key is a digest of the traced stamps plus each stamp's rut
 * eligibility. That is exact rather than a heuristic: the stamps already encode
 * every upstream input (path shape, wear config, the steepness and water fades),
 * and eligibility encodes the only other one (asphalt doesn't rut). Anything
 * that would change a pixel changes the digest.
 *
 * The rut layer is composited stamp-over-stamp into a standalone RGBA layer
 * rather than straight onto the normal canvas. Porter-Duff `over` is
 * associative, so compositing that finished layer onto the canvas afterwards
 * lands in the same place.
 */
export function bakeAiPathWear(track, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const { width, height, edgeSoftness, stamps } = traceAiPathWearStamps(track, textureSize, worldWidth, worldDepth);

  const pixelsPerUnitX = width / Math.max(1, worldWidth);
  const pixelsPerUnitZ = height / Math.max(1, worldDepth);
  const halfWorldX = worldWidth / 2;
  const halfWorldZ = worldDepth / 2;

  // Asphalt is hard — it picks up rubber and skid marks (the colour overlay) but
  // never ruts, so the relief skips paved sections. Consecutive stamps are
  // fractions of a metre apart and land in the same terrain cell over and over,
  // so the lookup is memoized per cell rather than run per stamp.
  const terrainTypeCache = new Map();
  const rutEligible = stamps.map((stamp) => {
    const worldX = stamp.sx / pixelsPerUnitX - halfWorldX;
    const worldZ = stamp.sy / pixelsPerUnitZ - halfWorldZ;
    const cellKey = (Math.round(worldX) << 12) ^ Math.round(worldZ);
    let eligible = terrainTypeCache.get(cellKey);
    if (eligible === undefined) {
      const terrainType = track.getTerrainTypeAt(worldX, worldZ);
      eligible = (typeof terrainType === 'string' ? terrainType : terrainType?.name) !== 'asphalt';
      terrainTypeCache.set(cellKey, eligible);
    }
    return eligible;
  });

  // Numeric rolling hash rather than a built string: this runs on every bake,
  // including the ones that go on to hit the cache, so it has to be cheap.
  let digest = (width * 397) ^ (height * 149) ^ Math.round(edgeSoftness * 8191) ^ (stamps.length * 31);
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    digest = (digest * 31 + Math.round(s.sx * 64)) | 0;
    digest = (digest * 31 + Math.round(s.sy * 64)) | 0;
    digest = (digest * 31 + Math.round(s.alpha * 4096)) | 0;
    digest = (digest * 31 + Math.round(s.radiusX * 64)) | 0;
    digest = (digest * 31 + Math.round(s.radiusY * 64)) | 0;
    digest = (digest * 31 + Math.round(s.tangentX * 4096)) | 0;
    digest = (digest * 31 + Math.round(s.normalX * 4096)) | 0;
    digest = (digest * 31 + (s.lighten ? 1 : 0) + (rutEligible[i] ? 2 : 0)) | 0;
  }
  if (_wearBakeCache?.digest === digest) return _wearBakeCache.result;

  // R: lighten, G: darken (B/A unused). Stamps accumulate, so the reused
  // scratch buffer must start from zero.
  const overlay = _wearAccumBuffer = _getScratchBuffer(_wearAccumBuffer, width * height * 4);
  overlay.fill(0);
  // Premultiplied RGB + coverage, so overlapping stamps compose the same way
  // they did when each was drawn straight onto the canvas.
  const rut = _rutLayerBuffer = _getScratchBuffer(_rutLayerBuffer, width * height * 4, Float32Array);
  rut.fill(0);

  for (let i = 0; i < stamps.length; i++) {
    const stamp = stamps[i];
    const lighten = stamp.lighten;
    const ruts = rutEligible[i];

    forEachStampPixel(stamp, width, height, edgeSoftness, (x, y, weight, acrossNorm) => {
      const base = (y * width + x) * 4;

      const contribution = Math.round(weight * 255);
      if (lighten) overlay[base] = Math.min(255, overlay[base] + contribution);
      else overlay[base + 1] = Math.min(255, overlay[base + 1] + contribution);

      if (!ruts) return;
      // Groove cross-section: no tilt at the centre, walls tilt toward the
      // centre. The surface normal tilts opposite the wall slope, along the
      // across-track direction (normalX/normalZ ≈ canvas X/Y on flat ground).
      const tilt = Math.sin(acrossNorm * Math.PI / 2) * weight * RUT_STRENGTH;
      let nx = -tilt * stamp.normalX;
      let ny = -tilt * stamp.normalZ;
      let nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;

      const a = weight * RUT_OPACITY;
      const keep = 1 - a;
      rut[base]     = rut[base]     * keep + (nx * 0.5 + 0.5) * 255 * a;
      rut[base + 1] = rut[base + 1] * keep + (ny * 0.5 + 0.5) * 255 * a;
      rut[base + 2] = rut[base + 2] * keep + (nz * 0.5 + 0.5) * 255 * a;
      rut[base + 3] = rut[base + 3] * keep + a;
    });
  }

  const pixelsPerUnit = (pixelsPerUnitX + pixelsPerUnitZ) * 0.5;
  const result = {
    width,
    height,
    overlay: _blurAlpha(overlay, width, height, Math.max(1, pixelsPerUnit * 0.12)),
    rut,
    hasRuts: rutEligible.some(Boolean) && stamps.length > 0,
  };
  _wearBakeCache = { digest, result };
  return result;
}

/**
 * The wear colour overlay (R: lighten alpha, G: darken alpha). Same signature
 * and output as before; the rasterization is shared with the rut layer.
 */
export function buildTerrainWearOverlayPixelData(track, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const { width, height, overlay } = bakeAiPathWear(track, textureSize, worldWidth, worldDepth);
  return { width, height, data: overlay };
}

