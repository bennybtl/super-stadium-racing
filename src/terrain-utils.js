/**
 * Shared terrain texture utilities
 */

/**
 * Paint terrain texture from terrainManager grid to a canvas context.
 * Adds random noise for visual variation.
 * 
 * @param {CanvasRenderingContext2D} ctx - Canvas context from DynamicTexture
 * @param {TerrainManager} terrainManager - Terrain manager with grid data
 * @param {number} pixelsPerCell - How many pixels represent one terrain cell
 */
export function paintTerrainTexture(ctx, terrainManager, pixelsPerCell) {
  const n = terrainManager.cellsPerSide;
  const px = Math.ceil(pixelsPerCell);
  // How far into a cell (in pixels) the blend extends. One full cell width
  // means the transition spans two cells total — tune smaller for sharper edges.
  const blendWidth = px;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = row * n + col;
      const cell = terrainManager.grid[index];
      const { r: cr, g: cg, b: cb } = cell.color;
      const x0 = Math.floor(col * pixelsPerCell);
      const y0 = Math.floor(row * pixelsPerCell);

      // Fetch the four axis-aligned neighbours (null at grid edges)
      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      // Only blend toward neighbours that are a different terrain type
      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          let blendR = cr * 255, blendG = cg * 255, blendB = cb * 255;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = px - 1 - pxx; // pixels from right edge
            const distL = pxx;           // pixels from left edge
            const distB = px - 1 - py;  // pixels from bottom edge
            const distA = py;            // pixels from top edge

            if (rDiff && distR < blendWidth) {
              const w = 1 - distR / blendWidth;
              totalWeight += w;
              blendR += rCell.color.r * 255 * w;
              blendG += rCell.color.g * 255 * w;
              blendB += rCell.color.b * 255 * w;
            }
            if (lDiff && distL < blendWidth) {
              const w = 1 - distL / blendWidth;
              totalWeight += w;
              blendR += lCell.color.r * 255 * w;
              blendG += lCell.color.g * 255 * w;
              blendB += lCell.color.b * 255 * w;
            }
            if (bDiff && distB < blendWidth) {
              const w = 1 - distB / blendWidth;
              totalWeight += w;
              blendR += bCell.color.r * 255 * w;
              blendG += bCell.color.g * 255 * w;
              blendB += bCell.color.b * 255 * w;
            }
            if (aDiff && distA < blendWidth) {
              const w = 1 - distA / blendWidth;
              totalWeight += w;
              blendR += aCell.color.r * 255 * w;
              blendG += aCell.color.g * 255 * w;
              blendB += aCell.color.b * 255 * w;
            }
          }

          // const noise = (Math.random() - 0.5) * 18;
          const noise = 0;
          const r = Math.max(0, Math.min(255, blendR / totalWeight + noise));
          const g = Math.max(0, Math.min(255, blendG / totalWeight + noise * 0.9));
          const b = Math.max(0, Math.min(255, blendB / totalWeight + noise * 0.8));
          ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
          ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
        }
      }
    }
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
  const px = Math.ceil(pixelsPerCell);
  const blendWidth = px;

  // Convert a cell's specular [0..1] to a 0-255 grey value
  function cellGrey(cell) {
    return Math.round((cell.specular ?? 0.03) * 255);
  }

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const cell = terrainManager.grid[row * n + col];
      const sv = cellGrey(cell);
      const x0 = Math.floor(col * pixelsPerCell);
      const y0 = Math.floor(row * pixelsPerCell);

      const rCell = col + 1 < n ? terrainManager.grid[row * n + col + 1] : null;
      const lCell = col > 0     ? terrainManager.grid[row * n + col - 1] : null;
      const bCell = row + 1 < n ? terrainManager.grid[(row + 1) * n + col] : null;
      const aCell = row > 0     ? terrainManager.grid[(row - 1) * n + col] : null;

      const rDiff = rCell && rCell !== cell;
      const lDiff = lCell && lCell !== cell;
      const bDiff = bCell && bCell !== cell;
      const aDiff = aCell && aCell !== cell;
      const anyBlend = rDiff || lDiff || bDiff || aDiff;

      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          let blendV = sv;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = px - 1 - pxx;
            const distL = pxx;
            const distB = px - 1 - py;
            const distA = py;

            if (rDiff && distR < blendWidth) {
              const w = 1 - distR / blendWidth;
              totalWeight += w;
              blendV += cellGrey(rCell) * w;
            }
            if (lDiff && distL < blendWidth) {
              const w = 1 - distL / blendWidth;
              totalWeight += w;
              blendV += cellGrey(lCell) * w;
            }
            if (bDiff && distB < blendWidth) {
              const w = 1 - distB / blendWidth;
              totalWeight += w;
              blendV += cellGrey(bCell) * w;
            }
            if (aDiff && distA < blendWidth) {
              const w = 1 - distA / blendWidth;
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
}
