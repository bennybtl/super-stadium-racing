/**
 * Shared loader + cache for the sponsor/brand logo images in
 * src/assets/brands/. Used by track signs and by the decal systems (a "brand"
 * decal shape stamps one of these logos onto the ground or a wall).
 *
 * Resolves to a decoded HTMLImageElement, or null when the filename is empty or
 * the image fails to load — callers draw a fallback in that case.
 */

const _cache = new Map();

export function loadBrandImage(filename) {
  const key = filename || "";
  if (_cache.has(key)) return _cache.get(key);

  const p = new Promise((resolve) => {
    if (!filename) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL(`../assets/brands/${filename}`, import.meta.url).href;
  });

  _cache.set(key, p);
  return p;
}
