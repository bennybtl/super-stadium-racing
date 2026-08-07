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

/**
 * Area-average resample of RGBA pixels, wrapping at the edges.
 *
 * Canvas `drawImage` downscaling uses a kernel that reaches past the source
 * border and clamps there, so the outermost pixels of a shrunken tile are built
 * from the wrong neighbours. The tile then no longer meets itself when repeated
 * and a perfectly seamless source draws a grid at the tile spacing.
 *
 * Averaging exactly the source region each destination pixel covers preserves
 * tileability: neighbouring tiles average adjacent regions of what is already a
 * periodic signal. Sample indices wrap as insurance for ranges that round past
 * an edge.
 */
export function resampleWrapped(src, srcWidth, srcHeight, dstWidth, dstHeight) {
  const dst = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const spanX = srcWidth / dstWidth;
  const spanY = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const y0 = y * spanY;
    const y1 = (y + 1) * spanY;
    for (let x = 0; x < dstWidth; x++) {
      const x0 = x * spanX;
      const x1 = (x + 1) * spanX;

      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (let j = Math.floor(y0); j < Math.ceil(y1); j++) {
        const wy = Math.min(j + 1, y1) - Math.max(j, y0);
        if (wy <= 0) continue;
        const jj = ((j % srcHeight) + srcHeight) % srcHeight;
        for (let i = Math.floor(x0); i < Math.ceil(x1); i++) {
          const wx = Math.min(i + 1, x1) - Math.max(i, x0);
          if (wx <= 0) continue;
          const ii = ((i % srcWidth) + srcWidth) % srcWidth;
          const w = wx * wy;
          const k = (jj * srcWidth + ii) * 4;
          r += src[k] * w;
          g += src[k + 1] * w;
          b += src[k + 2] * w;
          a += src[k + 3] * w;
          total += w;
        }
      }

      const o = (y * dstWidth + x) * 4;
      if (total > 0) {
        dst[o] = r / total;
        dst[o + 1] = g / total;
        dst[o + 2] = b / total;
        dst[o + 3] = a / total;
      }
    }
  }

  return dst;
}
