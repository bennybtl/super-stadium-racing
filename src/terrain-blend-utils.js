function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function stableNoise(x, z) {
  const qx = Math.floor(x);
  const qz = Math.floor(z);
  const hash = Math.sin(qx * 12.9898 + qz * 78.233) * 43758.5453;
  return hash - Math.floor(hash);
}

/**
 * Determines whether to pick the primary terrain based on signed distance to
 * an edge and a deterministic noise threshold.
 *
 * signedDistToEdge > 0 means inside the feature.
 * signedDistToEdge < 0 means outside the feature.
 */
export function usePrimaryTerrainWithBlend(
  x,
  z,
  signedDistToEdge,
  innerBlend,
  outerBlend
) {
  const inner = Math.max(0, innerBlend ?? 0);
  const outer = Math.max(0, outerBlend ?? 0);

  if (signedDistToEdge >= inner) return true;
  if (signedDistToEdge <= -outer) return false;

  const span = Math.max(1e-6, inner + outer);
  const t = (signedDistToEdge + outer) / span;
  const primaryChance = clamp01(t);

  return stableNoise(x, z) < primaryChance;
}
