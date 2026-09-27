// Builds the display rows for the "Reorder Features" panel: a flattened,
// human-readable view of track.features where adjacent decorations,
// obstacles, track signs, and track lights sharing a kind collapse into one
// summary row (e.g. "12 × Tree") — none of those affect terrain/hill overlap,
// so their relative order carries no meaning. Order DOES matter for
// Track.getTerrainTypeAt (terrain/hill color-and-roughness overlap resolves
// "last in the array wins") — `layered` flags the types that participate in
// that resolution so the panel can call it out.
import { isModelFeature, defForFeature } from '../decorations/decorations-registry.js';

const TYPE_LABELS = {
  checkpoint: 'Checkpoint',
  startPosition: 'Starting Grid',
  polyWall: 'Poly Wall',
  polyCurb: 'Poly Curb',
  hill: 'Round Hill',
  squareHill: 'Square Hill',
  polyHill: 'Poly Hill',
  meshGrid: 'Mesh Grid',
  bridgeMesh: 'Bridge Mesh',
  driveBox: 'Drive Box',
  tunnel: 'Tunnel',
  terrain: 'Terrain Shape',
  obstacle: 'Obstacle',
  trackSign: 'Track Sign',
  trackLight: 'Track Light',
  actionZone: 'Action Zone',
  aiPath: 'AI Path',
  terrainPath: 'Terrain Path',
  decal: 'Decal',
};

export const LAYERED_TYPES = new Set(['terrain', 'terrainPath', 'hill', 'squareHill', 'polyHill']);

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** { label, sub, groupKey } — groupKey is non-null only for groupable features. */
function describeFeature(feature) {
  if (isModelFeature(feature)) {
    const def = defForFeature(feature);
    return {
      label: def?.name ?? 'Decoration',
      sub: '',
      groupKey: def?.packId ?? def?.id ?? feature.model ?? feature.type,
    };
  }

  // Obstacles, track signs, and track lights don't affect terrain/hill overlap
  // and their own relative order carries no meaning, so — like decorations —
  // adjacent instances of the same kind collapse into one row.
  if (feature.type === 'obstacle') {
    const label = feature.obstacleType
      ? capitalize(String(feature.obstacleType).replace(/_/g, ' '))
      : 'Obstacle';
    return { label, sub: '', groupKey: `obstacle:${feature.obstacleType ?? 'unknown'}` };
  }
  if (feature.type === 'trackSign') return { label: TYPE_LABELS.trackSign, sub: '', groupKey: 'trackSign' };
  if (feature.type === 'trackLight') return { label: TYPE_LABELS.trackLight, sub: '', groupKey: 'trackLight' };

  const label = TYPE_LABELS[feature.type] ?? feature.type;
  let sub = '';
  if (LAYERED_TYPES.has(feature.type)) {
    sub = feature.terrainType?.name ? capitalize(feature.terrainType.name) : '';
  } else if (feature.type === 'checkpoint' && feature.checkpointNumber != null) {
    sub = `#${feature.checkpointNumber}`;
  }
  return { label, sub, groupKey: null };
}

/**
 * Flatten track.features into display rows — adjacent decorations sharing a
 * kind collapse into one row. Every row carries `featureRefs`, the actual
 * feature object(s) it stands for in their original relative order, so a
 * reordered row list can be expanded back into a flat features array.
 */
export function buildFeatureOrderRows(features) {
  const rows = [];
  let i = 0;
  for (const feature of features) {
    const { label, sub, groupKey } = describeFeature(feature);
    const prev = rows[rows.length - 1];
    if (groupKey !== null && prev?.isGroup && prev.groupKey === groupKey) {
      prev.featureRefs.push(feature);
      prev.count++;
    } else {
      rows.push({
        key: `row-${i++}`,
        label,
        sub,
        layered: LAYERED_TYPES.has(feature.type),
        isGroup: groupKey !== null,
        groupKey,
        count: 1,
        featureRefs: [feature],
      });
    }
  }
  return rows;
}

/** Expand reordered rows back into a flat features array. */
export function flattenFeatureOrderRows(rows) {
  return rows.flatMap(r => r.featureRefs);
}

/**
 * True if the relative order of layered (terrain/hill-overlap-affecting)
 * features differs between the two feature arrays — the only thing a reorder
 * needs to trigger a terrain rebuild for. Moving any number of non-layered
 * rows (checkpoints, decorations, obstacles, ...) around, even past layered
 * ones, leaves this false since they're filtered out before comparing.
 */
export function layeredOrderChanged(prevFeatures, nextFeatures) {
  const prev = prevFeatures.filter(f => LAYERED_TYPES.has(f.type));
  const next = nextFeatures.filter(f => LAYERED_TYPES.has(f.type));
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (prev[i] !== next[i]) return true;
  }
  return false;
}
