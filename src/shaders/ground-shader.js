/**
 * Custom ground shader with support for normal map decals
 * 
 * Uses a simpler approach: dynamically generates a combined normal map texture
 * by compositing multiple normal map decals onto a canvas, then applies it
 * to the standard material's bump texture.
 */

import { DynamicTexture, Texture, Vector2 } from "@babylonjs/core";

/**
 * Create a composite normal map texture from multiple decals
 * @param {Scene} scene - Babylon scene
 * @param {Array} normalMapDecals - Array of decal feature objects from track
 * @param {number} textureSize - Size of the generated texture (power of 2)
 * @param {number} worldSize - Size of the world space the texture covers
 * @returns {Promise<DynamicTexture>}
 */
export async function createCompositeNormalMap(scene, normalMapDecals, textureSize = 2048, worldSize = 160) {
  const dynamicTexture = new DynamicTexture(
    "compositeNormalMap",
    { width: textureSize, height: textureSize },
    scene,
    false
  );
  
  const ctx = dynamicTexture.getContext();
  const pixelsPerUnit = textureSize / worldSize;
  
  // Load and tile the base normal map across the entire ground
  const baseNormalImg = new Image();
  baseNormalImg.crossOrigin = "anonymous";
  const baseNormalPath = new URL('../assets/6481-normal.jpg', import.meta.url).href;
  
  await new Promise((resolve) => {
    baseNormalImg.onload = resolve;
    baseNormalImg.onerror = resolve;
    baseNormalImg.src = baseNormalPath;
  });
  
  // Draw the base normal map tiled 10x10 times across the ground
  if (baseNormalImg.complete && baseNormalImg.naturalWidth > 0) {
    const tileSize = textureSize / 10; // 10 repeats across the texture
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        ctx.drawImage(baseNormalImg, x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  } else {
    // Fallback: flat normal map (pointing up)
    ctx.fillStyle = "rgb(128, 128, 255)";
    ctx.fillRect(0, 0, textureSize, textureSize);
  }
  
  // If no decals, just return the base
  if (!normalMapDecals || normalMapDecals.length === 0) {
    dynamicTexture.update();
    return dynamicTexture;
  }
  
  // Load all normal map decal images
  const decalImages = await Promise.all(
    normalMapDecals.map(async (decal) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const normalMapPath = new URL(`../assets/${decal.normalMap}`, import.meta.url).href;
      
      return new Promise((resolve) => {
        img.onload = () => resolve({ decal, img });
        img.onerror = () => resolve({ decal, img: null });
        img.src = normalMapPath;
      });
    })
  );
  
  // Draw each decal onto the canvas
  for (const { decal, img } of decalImages) {
    if (!img) continue;
    
    const { centerX, centerZ, width, depth, angle = 0, repeatU = 1, repeatV = 1, intensity = 0.5 } = decal;
    
    // Convert world coordinates to canvas coordinates
    // World space: [-80, 80], Canvas space: [0, textureSize]
    const canvasCenterX = (centerX + worldSize / 2) * pixelsPerUnit;
    const canvasCenterY = (centerZ + worldSize / 2) * pixelsPerUnit;
    const canvasWidth = width * pixelsPerUnit;
    const canvasHeight = depth * pixelsPerUnit;
    
    ctx.save();
    
    // Apply transformations
    ctx.translate(canvasCenterX, canvasCenterY);
    ctx.rotate(angle * Math.PI / 180);
    ctx.scale(-1, 1); // Flip horizontally in local space to match texture orientation
    
    // Calculate tile size in canvas pixels
    // repeatU/repeatV determine how many times the texture repeats within width/depth
    const tilePixelWidth = canvasWidth / repeatU;
    const tilePixelHeight = canvasHeight / repeatV;
    
    // Adjust alpha for intensity (lower intensity = more transparent = less effect)
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'source-over';
    
    // Draw the image tiled across the decal area
    for (let ty = 0; ty < Math.ceil(repeatV); ty++) {
      for (let tx = 0; tx < Math.ceil(repeatU); tx++) {
        const x = -canvasWidth / 2 + tx * tilePixelWidth;
        const y = -canvasHeight / 2 + ty * tilePixelHeight;
        
        // Clip the last tile if repeat is not a whole number
        const drawWidth = (tx === Math.floor(repeatU) && repeatU % 1 !== 0)
          ? tilePixelWidth * (repeatU % 1)
          : tilePixelWidth;
        const drawHeight = (ty === Math.floor(repeatV) && repeatV % 1 !== 0)
          ? tilePixelHeight * (repeatV % 1)
          : tilePixelHeight;
        
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
      }
    }
    
    ctx.restore();
  }
  
  dynamicTexture.update();
  return dynamicTexture;
}

/**
 * Update an existing composite normal map with new decals
 * This is more efficient than recreating from scratch
 * @param {DynamicTexture} dynamicTexture - Existing composite texture
 * @param {Scene} scene - Babylon scene  
 * @param {Array} normalMapDecals - Array of decal feature objects
 * @param {number} worldSize - Size of the world space the texture covers
 * @returns {Promise<void>}
 */
export async function updateCompositeNormalMap(dynamicTexture, scene, normalMapDecals, worldSize = 160) {
  const textureSize = dynamicTexture.getSize().width;
  
  // Recreate the texture - simpler than trying to diff changes
  const ctx = dynamicTexture.getContext();
  const pixelsPerUnit = textureSize / worldSize;
  
  // Load and tile the base normal map across the entire ground
  const baseNormalImg = new Image();
  baseNormalImg.crossOrigin = "anonymous";
  const baseNormalPath = new URL('../assets/6481-normal.jpg', import.meta.url).href;
  
  await new Promise((resolve) => {
    baseNormalImg.onload = resolve;
    baseNormalImg.onerror = resolve;
    baseNormalImg.src = baseNormalPath;
  });
  
  // Draw the base normal map tiled 10x10 times across the ground
  if (baseNormalImg.complete && baseNormalImg.naturalWidth > 0) {
    const tileSize = textureSize / 10; // 10 repeats across the texture
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        ctx.drawImage(baseNormalImg, x * tileSize, y * tileSize, tileSize, tileSize);
      }
    }
  } else {
    // Fallback: flat normal map (pointing up)
    ctx.fillStyle = "rgb(128, 128, 255)";
    ctx.fillRect(0, 0, textureSize, textureSize);
  }
  
  if (!normalMapDecals || normalMapDecals.length === 0) {
    dynamicTexture.update();
    return;
  }
  
  // Load all normal map decal images
  const decalImages = await Promise.all(
    normalMapDecals.map(async (decal) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const normalMapPath = new URL(`../assets/${decal.normalMap}`, import.meta.url).href;
      
      return new Promise((resolve) => {
        img.onload = () => resolve({ decal, img });
        img.onerror = () => resolve({ decal, img: null });
        img.src = normalMapPath;
      });
    })
  );
  
  // Draw each decal
  for (const { decal, img } of decalImages) {
    if (!img) continue;
    
    const { centerX, centerZ, width, depth, angle = 0, repeatU = 1, repeatV = 1, intensity = 0.5 } = decal;
    
    const canvasCenterX = (centerX + worldSize / 2) * pixelsPerUnit;
    const canvasCenterY = (centerZ + worldSize / 2) * pixelsPerUnit;
    const canvasWidth = width * pixelsPerUnit;
    const canvasHeight = depth * pixelsPerUnit;
    
    ctx.save();
    ctx.translate(canvasCenterX, canvasCenterY);
    ctx.rotate(angle * Math.PI / 180);
    
    // Calculate tile size in canvas pixels
    const tilePixelWidth = canvasWidth / repeatU;
    const tilePixelHeight = canvasHeight / repeatV;
    
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'source-over';
    
    // Draw the image tiled across the decal area
    for (let ty = 0; ty < Math.ceil(repeatV); ty++) {
      for (let tx = 0; tx < Math.ceil(repeatU); tx++) {
        const x = -canvasWidth / 2 + tx * tilePixelWidth;
        const y = -canvasHeight / 2 + ty * tilePixelHeight;
        
        // Clip the last tile if repeat is not a whole number
        const drawWidth = (tx === Math.floor(repeatU) && repeatU % 1 !== 0)
          ? tilePixelWidth * (repeatU % 1)
          : tilePixelWidth;
        const drawHeight = (ty === Math.floor(repeatV) && repeatV % 1 !== 0)
          ? tilePixelHeight * (repeatV % 1)
          : tilePixelHeight;
        
        ctx.drawImage(img, x, y, drawWidth, drawHeight);
      }
    }
    
    ctx.restore();
  }
  
  dynamicTexture.update();
}
