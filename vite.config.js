import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = path.resolve(__dirname, "public/tracks");

/**
 * Exposes the list of track JSON files in public/tracks/ as a virtual module
 * (`virtual:track-manifest`), so a new track appears in-game just by dropping a
 * file in that folder — no source edits. The list is scanned at build time and
 * re-scanned on add/remove during dev (triggering a reload).
 */
function trackManifestPlugin() {
  const VIRTUAL_ID = "virtual:track-manifest";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;

  const readTrackFiles = () => {
    try {
      return fs.readdirSync(TRACKS_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort();
    } catch {
      return [];
    }
  };

  return {
    name: "track-manifest",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id === RESOLVED_ID) {
        return `export default ${JSON.stringify(readTrackFiles())};`;
      }
    },
    configureServer(server) {
      server.watcher.add(TRACKS_DIR);
      const invalidate = (file) => {
        if (!file.startsWith(TRACKS_DIR) || !file.endsWith(".json")) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", invalidate);
      server.watcher.on("unlink", invalidate);
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue(), trackManifestPlugin()],
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer used by Havok WASM
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
