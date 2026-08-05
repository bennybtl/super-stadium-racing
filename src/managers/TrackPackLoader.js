import { unzipSync } from 'fflate';
import { getImageUrl, removeImage, setImage, setTrackJson } from './TrackStore.js';

const THUMBNAIL_MAX = 200;
const THUMBNAIL_QUALITY = 0.8;

/**
 * Load a track-pack zip file. Extracts .json tracks and .png images and
 * persists both through TrackStore (IndexedDB), then registers the tracks
 * with TrackLoader. Returns { loaded: number, errors: string[] }.
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
    // Skip macOS Archive Utility cruft: a `__MACOSX/` tree of AppleDouble
    // resource forks (`._<name>`) shadowing every real entry, plus the
    // .DS_Store it drops in. These carry the real file's extension but hold
    // binary metadata, so they fail to decode/parse if taken at face value.
    if (path.startsWith('__MACOSX/') || filename.startsWith('._') || filename === '.DS_Store') continue;

    if (filename.endsWith('.png') || filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      const type = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
      try {
        images.set(filename, await resizeImage(new Blob([data], { type })));
      } catch (e) {
        errors.push(`Failed to process image ${filename}: ${e.message}`);
      }
    } else if (filename.endsWith('.json')) {
      trackEntries.push({ filename, data });
    }
  }

  for (const [filename, blob] of images) {
    try {
      setImage(filename, blob);
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
      setTrackJson(key, json);
      trackLoader.loadTrackFromStorage(key);
      loaded++;
    } catch (e) {
      errors.push(`Failed to load track ${filename}: ${e.message}`);
    }
  }

  return { loaded, errors };
}

/**
 * Drop a locally stored preview image (pack import or editor screenshot).
 */
export function removeStoredTrackImage(imageFilename) {
  removeImage(imageFilename);
}

/**
 * A URL for a locally stored preview image, usable as an <img> src, or null
 * when the track's image only exists as a shipped file in public/tracks/.
 */
export function getStoredTrackImage(imageFilename) {
  if (!imageFilename) return null;
  return getImageUrl(imageFilename);
}

/**
 * Store a track image (data-URL or any loadable src) under `imageFilename`,
 * downscaled to the same thumbnail size used for pack imports. Used by the
 * editor's screenshot capture.
 */
export async function storeTrackImage(imageFilename, src) {
  if (!imageFilename || !src) {
    throw new Error(`Cannot store track image (filename="${imageFilename}", empty source: ${!src})`);
  }
  setImage(imageFilename, await resizeSrcToBlob(src));
}

function resizeImage(blob) {
  const url = URL.createObjectURL(blob);
  return resizeSrcToBlob(url).finally(() => URL.revokeObjectURL(url));
}

/**
 * Decode `src`, downscale it to fit THUMBNAIL_MAX on its longest side, and
 * re-encode as a JPEG Blob. Blobs (rather than data-URLs) keep the stored
 * bytes raw — no base64 inflation on the way into IndexedDB.
 */
function resizeSrcToBlob(src) {
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
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Failed to encode image')),
        'image/jpeg', THUMBNAIL_QUALITY,
      );
    };
    img.onerror = () => reject(new Error('Failed to decode image'));
    img.src = src;
  });
}
