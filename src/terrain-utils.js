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
  for (let row = 0; row < terrainManager.cellsPerSide; row++) {
    for (let col = 0; col < terrainManager.cellsPerSide; col++) {
      const index = row * terrainManager.cellsPerSide + col;
      const color = terrainManager.grid[index].color;
      const baseR = Math.floor(color.r * 255);
      const baseG = Math.floor(color.g * 255);
      const baseB = Math.floor(color.b * 255);
      const px = Math.ceil(pixelsPerCell);
      const x0 = Math.floor(col * pixelsPerCell);
      const y0 = Math.floor(row * pixelsPerCell);
      for (let py = 0; py < px; py++) {
        for (let pxx = 0; pxx < px; pxx++) {
          const n = (Math.random() - 0.5) * 18;
          const r = Math.max(0, Math.min(255, baseR + n));
          const g = Math.max(0, Math.min(255, baseG + n * 0.9));
          const b = Math.max(0, Math.min(255, baseB + n * 0.8));
          ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
          ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
        }
      }
    }
  }
}
