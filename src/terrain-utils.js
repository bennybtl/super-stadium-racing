/**
 * Shared terrain texture utilities
 */

import { TERRAIN_TYPES } from "./terrain.js";
import { expandPolyline } from "./polyline-utils.js";

const TERRAIN_TYPE_LIST = Object.values(TERRAIN_TYPES);
const TERRAIN_TYPE_INDEX = new Map(TERRAIN_TYPE_LIST.map((terrainType, index) => [terrainType, index]));

export const DEFAULT_TERRAIN_WEAR_CONFIG = Object.freeze({
  enabled: true,
  source: 'aiPath',
  width: 3.2,
  intensity: 0.8,
  laneSpacing: 1.3,
  alphaBreakup: 0.28,
  pathWander: 0.5,
  edgeSoftness: 0.75,
  secondaryPathCount: 4,
  secondaryPathStrength: 0.62,
  secondaryPathSpacing: 0.1,
  seed: 1337,
});

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

function _smoothstep(edge0, edge1, x) {
  const t = _clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

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
      x: _lerp(start.x, end.x, t),
      z: _lerp(start.z, end.z, t),
    });
  }

  return samples;
}

function _blurAlpha(data, width, height, radius) {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0) return data;

  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let totalR = 0, totalG = 0;
      let weight = 0;
      for (let dx = -r; dx <= r; dx++) {
        const sx = _clamp(x + dx, 0, width - 1);
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
        const sy = _clamp(y + dy, 0, height - 1);
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

function _getTerrainSlopeDegAt(track, x, z, sampleDistance) {
  if (!track) return 0;
  const d = Math.max(0.25, sampleDistance);
  const dx = track.getHeightAt(x + d, z) - track.getHeightAt(x - d, z);
  const dz = track.getHeightAt(x, z + d) - track.getHeightAt(x, z - d);
  const rise = Math.sqrt(dx * dx + dz * dz) / (2 * d);
  return Math.atan(rise) * 180 / Math.PI;
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

export function buildTerrainWearOverlayPixelData(track, textureSize = 2048, worldWidth = 160, worldDepth = worldWidth) {
  const width = Math.max(4, Math.round(textureSize));
  const height = width;
  const data = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0;     // R: lighten alpha
    data[i + 1] = 0; // G: darken alpha
  }

  const wear = {
    ...DEFAULT_TERRAIN_WEAR_CONFIG,
    ...(track?.wear ?? {}),
  };
  if (!wear.enabled || wear.source !== 'aiPath') return { width, height, data };

  const aiPath = track?.features?.find(feature => feature.type === 'aiPath');
  const points = aiPath?.points;
  if (!Array.isArray(points) || points.length < 3) return { width, height, data };

  const smoothingRadius = _clamp(wear.width * 4.2, 1, 30);
  const smoothedPoints = expandPolyline(
    points.map(point => ({ ...point, radius: smoothingRadius })),
    true
  );
  if (!Array.isArray(smoothedPoints) || smoothedPoints.length < 3) return { width, height, data };

  const pixelsPerUnitX = width / Math.max(1, worldWidth);
  const pixelsPerUnitZ = height / Math.max(1, worldDepth);
  const sampleSpacing = _clamp(wear.width * 0.2, 0.5, 1.0);
  const samples = _sampleClosedPath(smoothedPoints, sampleSpacing);
  if (samples.length < 3) return { width, height, data };

  const rng = _createSeededRandom(wear.seed);
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
  const edgeSoftness = _clamp(wear.edgeSoftness, 0.1, 1.5);
  const secondaryPathStrength = _clamp(wear.secondaryPathStrength ?? 0.62, 0, 3);

  const mainLanes = [
    { offset: -mainLaneOffset, alpha: 1.0, radiusX: majorRadiusX, radiusY: majorRadiusY, lighten: false },
    { offset: mainLaneOffset, alpha: 0.96, radiusX: majorRadiusX, radiusY: majorRadiusY, lighten: false },
  ];

  const sideWearPaths = [];
  const buildSideWearPaths = (sideSign) => {
    const pathCount = Math.max(0, Math.round(wear.secondaryPathCount ?? 4));
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

    const pad = Math.ceil(Math.max(lane.radiusX, lane.radiusY) + 2);
    const minX = _clamp(Math.floor(sx - pad), 0, width - 1);
    const maxX = _clamp(Math.ceil(sx + pad), 0, width - 1);
    const minY = _clamp(Math.floor(sy - pad), 0, height - 1);
    const maxY = _clamp(Math.ceil(sy + pad), 0, height - 1);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - sx;
        const dy = y - sy;
        const localX = dx * tangentX + dy * tangentZ;
        const localY = dx * normalX + dy * normalZ;
        const ellipse = Math.sqrt(
          (localY * localY) / Math.max(1e-6, lane.radiusX * lane.radiusX) +
          (localX * localX) / Math.max(1e-6, lane.radiusY * lane.radiusY)
        );
        if (ellipse >= 1) continue;

        const falloff = 1 - _smoothstep(1 - edgeSoftness, 1, ellipse);
        const base = (y * width + x) * 4;
        const contribution = Math.round(_clamp(lane.alpha * falloff, 0, 1) * 255);
        if (lane.lighten) {
          data[base] = Math.min(255, data[base] + contribution);     // R: lighten
        } else {
          data[base + 1] = Math.min(255, data[base + 1] + contribution); // G: darken
        }
      }
    }
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
    const curvatureBoost = _clamp(Math.abs(cross) / 4, 0, 1);
    const alphaBreak = (rng() - 0.5) * wear.alphaBreakup;
    const alphaBase = wear.intensity * (1 + curvatureBoost * 0.35 + alphaBreak) * _lerp(0.70, 2.0, curvatureBoost);
    const presenceThreshold = _lerp(0.55, 0.18, curvatureBoost);

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
    const steepnessFade = 1 - _smoothstep(20, 28, slopeDeg);

    for (const lane of mainLanes) {
      const lanePresence = _smoothstep(
        presenceThreshold - 0.08,
        presenceThreshold + 0.08,
        lane.presenceFn(i)
      );
      stamp(curr.x, curr.z, tangentX, tangentZ, {
        offset: lane.offset + lane.wanderFn(i),
        alpha: Math.max(0, lane.alpha * alphaBase * lanePresence * steepnessFade),
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
        segmentAlpha *= _smoothstep(0, lane.fade, dist);
      }
      const distToEnd = lane.span - dist;
      if (distToEnd < lane.fade) {
        segmentAlpha *= _smoothstep(0, lane.fade, distToEnd);
      }

      const lanePresence = _smoothstep(
        presenceThreshold - 0.08,
        presenceThreshold + 0.08,
        lane.presenceFn(i)
      );

      stamp(curr.x, curr.z, tangentX, tangentZ, {
        offset: lane.offset + lane.wanderFn(i),
        alpha: Math.max(0, lane.alpha * alphaBase * segmentAlpha * lanePresence * steepnessFade),
        radiusX: lane.radiusX * (1 + curvatureBoost * 0.22),
        radiusY: lane.radiusY * (1 + curvatureBoost * 0.16),
        lighten: lane.lighten,
      });
    }
  }

  return {
    width,
    height,
    data: _blurAlpha(data, width, height, Math.max(1, pixelsPerUnit * 0.12)),
  };
}

