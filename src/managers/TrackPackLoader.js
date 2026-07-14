import { unzipSync } from 'fflate';

const IMAGE_STORAGE_PREFIX = 'trackImage_';
const THUMBNAIL_MAX = 200;
const THUMBNAIL_QUALITY = 0.8;

/**
 * Load a track-pack zip file. Extracts .json tracks and .png images,
 * stores tracks via TrackLoader and images as data-URLs in localStorage.
 * Returns { loaded: number, errors: string[] }.
 */
export async function loadTrackPack(file, trackLoader) {
  const buffer = await file.arrayBuffer();
  const entries = unzipSync(new Uint8Array(buffer));

  const images = new Map();
  const trackEntries = [];
  const errors = [];

  for (const [path, data] of Object.entries(entries)) {
    const filename = path.split('/').pop();
    if (!filename) continue;

    if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      const type = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const blob = new Blob([data], { type });
      try {
        const dataUrl = await resizeImageToDataUrl(blob);
        images.set(filename, dataUrl);
      } catch (e) {
        errors.push(`Failed to process image ${filename}: ${e.message}`);
      }
    } else if (filename.endsWith('.json')) {
      trackEntries.push({ filename, data });
    }
  }

  for (const [filename, dataUrl] of images) {
    try {
      localStorage.setItem(IMAGE_STORAGE_PREFIX + filename, dataUrl);
    } catch (e) {
      errors.push(`Failed to store image ${filename}: ${e.message}`);
    }
  }

  let loaded = 0;
  for (const { filename, data } of trackEntries) {
    try {
      const json = new TextDecoder().decode(data);
      JSON.parse(json);
      const key = filename.replace('.json', '');
      localStorage.setItem(`track_${key}`, json);
      trackLoader.loadTrackFromStorage(key);
      loaded++;
    } catch (e) {
      errors.push(`Failed to load track ${filename}: ${e.message}`);
    }
  }

  return { loaded, errors };
}

/**
 * Look up a track image from localStorage (for pack-imported tracks).
 * Returns a data-URL string or null.
 */
export function removeStoredTrackImage(imageFilename) {
  if (!imageFilename) return;
  try { localStorage.removeItem(IMAGE_STORAGE_PREFIX + imageFilename); } catch {}
}

export function getStoredTrackImage(imageFilename) {
  if (!imageFilename) return null;
  try {
    return localStorage.getItem(IMAGE_STORAGE_PREFIX + imageFilename);
  } catch {
    return null;
  }
}

function resizeImageToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > THUMBNAIL_MAX || height > THUMBNAIL_MAX) {
        const scale = THUMBNAIL_MAX / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to decode image'));
    };
    img.src = URL.createObjectURL(blob);
  });
}
