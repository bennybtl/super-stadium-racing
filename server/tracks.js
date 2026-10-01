import { readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Tracks the server can race: the built-ins in src/tracks plus every pack in
 * track-packs/<pack>/. Keys are filenames without .json — the same keys the
 * game uses (TrackLoader) — and are unique across all of them. Tracks saved
 * only in a player's browser (the editor) don't exist here.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function trackFiles() {
  const dirs = [join(root, "src", "tracks")];
  const packs = join(root, "track-packs");
  if (existsSync(packs)) {
    for (const pack of readdirSync(packs, { withFileTypes: true })) {
      if (pack.isDirectory()) dirs.push(join(packs, pack.name));
    }
  }
  const files = new Map(); // key → absolute path
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".json") && !files.has(f.slice(0, -5))) files.set(f.slice(0, -5), join(dir, f));
    }
  }
  return files;
}
