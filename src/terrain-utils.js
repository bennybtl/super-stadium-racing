/**
 * Shared terrain texture utilities
 */

const _diffuseTextureCache = new Map();

function _applyCanvasBlur(ctx, width, height, radiusPx) {
  if (!radiusPx || radiusPx <= 0) return;
  const copy = document.createElement('canvas');
  copy.width = width;
  copy.height = height;
  const copyCtx = copy.getContext('2d');
  copyCtx.drawImage(ctx.canvas, 0, 0, width, height);

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.filter = `blur(${radiusPx}px)`;
  ctx.drawImage(copy, 0, 0, width, height);
  ctx.restore();
}

function _getDiffuseTextureEntry(filename) {
  if (!filename) return null;
  if (_diffuseTextureCache.has(filename)) return _diffuseTextureCache.get(filename);

  const entry = { img: new Image(), loaded: false, failed: false, promise: null };
  entry.img.crossOrigin = 'anonymous';
  entry.promise = new Promise(resolve => {
    entry.img.onload = () => {
      entry.loaded = true;
      resolve(entry);
    };
    entry.img.onerror = () => {
      entry.failed = true;
      resolve(entry);
    };
  });
  entry.img.src = new URL(`./assets/${filename}`, import.meta.url).href;
  _diffuseTextureCache.set(filename, entry);
  return entry;
}

/**
 * Paint terrain texture from terrainManager grid to a canvas context.
 * Adds random noise for visual variation.
 * Skips blending during editing mode for performance but applies terrain color.
 * 
 * @param {CanvasRenderingContext2D} ctx - Canvas context from DynamicTexture
 * @param {TerrainManager} terrainManager - Terrain manager with grid data
 * @param {number} pixelsPerCell - How many pixels represent one terrain cell
 * @param {boolean} isEditing - Whether the terrain is in editing mode
 */
export async function paintTerrainTexture(ctx, terrainManager, pixelsPerCell, isEditing = false) {
  const n = terrainManager.cellsPerSide;
  const xEdges = new Array(n + 1);
  const yEdges = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    xEdges[i] = Math.floor(i * pixelsPerCell);
    yEdges[i] = Math.floor(i * pixelsPerCell);
  }
  const canvasWidth = xEdges[n];
  const canvasHeight = yEdges[n];

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      if (!cell) continue;

      const x0 = xEdges[col];
      const y0 = yEdges[row];
      const cellW = Math.max(1, xEdges[col + 1] - x0);
      const cellH = Math.max(1, yEdges[row + 1] - y0);
      const blendWidthX = cellW;
      const blendWidthY = cellH;

      // Apply terrain color directly during editing mode
      if (isEditing) {
        const r = Math.round((cell.color?.r ?? 0) * 255);
        const g = Math.round((cell.color?.g ?? 0) * 255);
        const b = Math.round((cell.color?.b ?? 0) * 255);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x0, y0, cellW, cellH);
        continue;
      }

      // Blending logic for non-editing mode
      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < cellH; py++) {
        for (let pxx = 0; pxx < cellW; pxx++) {
          let blendR = cell.color.r * 255;
          let blendG = cell.color.g * 255;
          let blendB = cell.color.b * 255;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = cellW - 1 - pxx;
            const distL = pxx;
            const distB = cellH - 1 - py;
            const distA = py;

            if (rDiff && distR < blendWidthX) {
              const w = 1 - distR / blendWidthX;
              totalWeight += w;
              blendR += rCell.color.r * 255 * w;
              blendG += rCell.color.g * 255 * w;
              blendB += rCell.color.b * 255 * w;
            }
            if (lDiff && distL < blendWidthX) {
              const w = 1 - distL / blendWidthX;
              totalWeight += w;
              blendR += lCell.color.r * 255 * w;
              blendG += lCell.color.g * 255 * w;
              blendB += lCell.color.b * 255 * w;
            }
            if (bDiff && distB < blendWidthY) {
              const w = 1 - distB / blendWidthY;
              totalWeight += w;
              blendR += bCell.color.r * 255 * w;
              blendG += bCell.color.g * 255 * w;
              blendB += bCell.color.b * 255 * w;
            }
            if (aDiff && distA < blendWidthY) {
              const w = 1 - distA / blendWidthY;
              totalWeight += w;
              blendR += aCell.color.r * 255 * w;
              blendG += aCell.color.g * 255 * w;
              blendB += aCell.color.b * 255 * w;
            }
          }

          const r = Math.round(Math.max(0, Math.min(255, blendR / totalWeight)));
          const g = Math.round(Math.max(0, Math.min(255, blendG / totalWeight)));
          const b = Math.round(Math.max(0, Math.min(255, blendB / totalWeight)));
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
        }
      }
    }
  }

  // Apply blur only in non-editing mode
  if (!isEditing) {
    _applyCanvasBlur(ctx, canvasWidth, canvasHeight, Math.max(1, Math.min(4, pixelsPerCell * 0.08)));
  }
}

/**
 * Paint a grayscale specular mask from the terrainManager grid.
 * Mud and water cells are bright (shiny/wet); dry terrain cells are near-black (matte).
 * Uses the same boundary-blending approach as paintTerrainTexture.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context from a DynamicTexture
 * @param {TerrainManager} terrainManager - Terrain manager with grid data
 * @param {number} pixelsPerCell - How many pixels represent one terrain cell
 */
export function paintTerrainSpecularMap(ctx, terrainManager, pixelsPerCell) {
  const n = terrainManager.cellsPerSide;
  const xEdges = new Array(n + 1);
  const yEdges = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    xEdges[i] = Math.floor(i * pixelsPerCell);
    yEdges[i] = Math.floor(i * pixelsPerCell);
  }
  const canvasWidth = xEdges[n];
  const canvasHeight = yEdges[n];

  // Convert a cell's specular [0..1] to a 0-255 grey value
  function cellGrey(cell) {
    return Math.round((cell.specular ?? 0.03) * 255);
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      const sv = cellGrey(cell);
      const x0 = xEdges[col];
      const y0 = yEdges[row];
      const cellW = Math.max(1, xEdges[col + 1] - x0);
      const cellH = Math.max(1, yEdges[row + 1] - y0);
      const blendWidthX = cellW;
      const blendWidthY = cellH;

      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < cellH; py++) {
        for (let pxx = 0; pxx < cellW; pxx++) {
          let blendV = sv;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = cellW - 1 - pxx;
            const distL = pxx;
            const distB = cellH - 1 - py;
            const distA = py;

            if (rDiff && distR < blendWidthX) {
              const w = 1 - distR / blendWidthX;
              totalWeight += w;
              blendV += cellGrey(rCell) * w;
            }
            if (lDiff && distL < blendWidthX) {
              const w = 1 - distL / blendWidthX;
              totalWeight += w;
              blendV += cellGrey(lCell) * w;
            }
            if (bDiff && distB < blendWidthY) {
              const w = 1 - distB / blendWidthY;
              totalWeight += w;
              blendV += cellGrey(bCell) * w;
            }
            if (aDiff && distA < blendWidthY) {
              const w = 1 - distA / blendWidthY;
              totalWeight += w;
              blendV += cellGrey(aCell) * w;
            }
          }

          const v = Math.round(Math.max(0, Math.min(255, blendV / totalWeight)));
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
        }
      }
    }
  }

  // Smooth abrupt wet/dry specular transitions so highlights don't appear as
  // hard squares when terrain types change.
  _applyCanvasBlur(ctx, canvasWidth, canvasHeight, Math.max(1, Math.min(5, pixelsPerCell * 0.1)));
}
