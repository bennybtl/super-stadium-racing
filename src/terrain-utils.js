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
 * 
 * @param {CanvasRenderingContext2D} ctx - Canvas context from DynamicTexture
 * @param {TerrainManager} terrainManager - Terrain manager with grid data
 * @param {number} pixelsPerCell - How many pixels represent one terrain cell
 */
export async function paintTerrainTexture(ctx, terrainManager, pixelsPerCell) {
  const n = terrainManager.cellsPerSide;
  const xEdges = new Array(n + 1);
  const yEdges = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    xEdges[i] = Math.floor(i * pixelsPerCell);
    yEdges[i] = Math.floor(i * pixelsPerCell);
  }
  const canvasWidth = xEdges[n];
  const canvasHeight = yEdges[n];

  // Optional textured overlay layers for any terrain type.
  // Terrain cells can define:
  //   diffuseTexture: 'filename.png'
  //   diffuseTextureWorldUnitsPerTile: number (optional, default 10)
  //   diffuseTextureBlendMode: Canvas globalCompositeOperation (optional, default 'source-over')
  //   diffuseTextureOpacity: number 0..1 (optional, default 1)
  const texturedTerrainByName = new Map();
  for (const cell of terrainManager.grid) {
    if (!cell?.name || !cell?.diffuseTexture || texturedTerrainByName.has(cell.name)) continue;
    texturedTerrainByName.set(cell.name, cell);
  }

  // Wait for diffuse textures before painting so first render already shows them.
  const textureEntries = [...texturedTerrainByName.values()]
    .map(cell => _getDiffuseTextureEntry(cell.diffuseTexture))
    .filter(Boolean);
  await Promise.all(textureEntries.map(e => e.promise));

  // Pass 1: paint the color base (all terrains), including boundary blends.
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const index = row * n + col;
      const cell = terrainManager.grid[index];

      const { r: cr, g: cg, b: cb } = cell.color;
      const x0 = xEdges[col];
      const y0 = yEdges[row];
      const cellW = Math.max(1, xEdges[col + 1] - x0);
      const cellH = Math.max(1, yEdges[row + 1] - y0);
      const blendWidthX = cellW;
      const blendWidthY = cellH;

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

      for (let py = 0; py < cellH; py++) {
        for (let pxx = 0; pxx < cellW; pxx++) {
          let blendR = cr * 255, blendG = cg * 255, blendB = cb * 255;
          let totalWeight = 1.0;

          if (anyBlend) {
            const distR = cellW - 1 - pxx; // pixels from right edge
            const distL = pxx;           // pixels from left edge
            const distB = cellH - 1 - py;  // pixels from bottom edge
            const distA = py;            // pixels from top edge

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

  // Soften hard cell boundaries from the terrain grid before textured overlays.
  // Radius scales with cell pixel size so it stays subtle across resolutions.
  _applyCanvasBlur(ctx, canvasWidth, canvasHeight, Math.max(1, Math.min(4, pixelsPerCell * 0.08)));

  // Pass 2: paint optional diffuse textures over their terrain cells.
  // This lets blend modes combine texture detail with the color base.
  const validBlendModes = new Set([
    'source-over', 'multiply', 'overlay', 'screen', 'soft-light',
    'hard-light', 'darken', 'lighten', 'color-burn', 'color-dodge',
    'difference', 'exclusion'
  ]);

  for (const [terrainName, terrainCell] of texturedTerrainByName) {
    const textureEntry = _getDiffuseTextureEntry(terrainCell.diffuseTexture);
    const isLoaded = !!(textureEntry?.loaded && textureEntry.img?.naturalWidth > 0);
    if (!isLoaded) continue;

    const worldUnitsPerTile = terrainCell.diffuseTextureWorldUnitsPerTile ?? 10;
    const tileSize = pixelsPerCell * (worldUnitsPerTile / terrainManager.cellSize);
    const pattern = ctx.createPattern(textureEntry.img, 'repeat');
    const scale = tileSize / textureEntry.img.naturalWidth;
    pattern.setTransform(new DOMMatrix([scale, 0, 0, scale, 0, 0]));

    const blendMode = validBlendModes.has(terrainCell.diffuseTextureBlendMode)
      ? terrainCell.diffuseTextureBlendMode
      : 'source-over';
    const opacity = Math.max(0, Math.min(1, terrainCell.diffuseTextureOpacity ?? 1));

    ctx.save();
    ctx.globalCompositeOperation = blendMode;
    ctx.globalAlpha = opacity;
    ctx.fillStyle = pattern;

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const cell = terrainManager.grid[row * n + col];
        if (cell?.name !== terrainName) continue;
        const x0 = xEdges[col];
        const y0 = yEdges[row];
        const cellW = Math.max(1, xEdges[col + 1] - x0);
        const cellH = Math.max(1, yEdges[row + 1] - y0);
        ctx.fillRect(x0, y0, cellW, cellH);
      }
    }

    ctx.restore();
  }

  // Final tiny soften pass to reduce visible square seams where optional
  // textured overlays begin/end at terrain boundaries.
  _applyCanvasBlur(ctx, canvasWidth, canvasHeight, Math.max(0.5, Math.min(1.5, pixelsPerCell * 0.02)));
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
