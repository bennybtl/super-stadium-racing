import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
  resolve: {
    alias: [
      // Bare "@babylonjs/core" → our curated deep-import module (src/babylon.js),
      // so only the parts of Babylon the game uses are bundled (~2 MB, not the
      // barrel's ~6.5 MB). Exact match only: deep "@babylonjs/core/…" paths
      // (used by src/babylon.js itself and by @babylonjs/loaders) pass through.
      { find: /^@babylonjs\/core$/, replacement: fileURLToPath(new URL("./src/babylon.js", import.meta.url)) },
    ],
  },
  esbuild: {
    // Strip console.debug from production builds (68 call sites of dev
    // tracing). `pure` only lets the minifier drop the calls, so dev keeps
    // them. console.log / console.table stay: FrameProfiler's opt-in reports
    // and DebugManager's log dump use them. warn/error are untouched.
    pure: ["console.debug"],
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than the game, so split it into
        // its own chunks: after a deploy returning players re-download only the
        // app chunk, and the browser parses the pieces in parallel.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@babylonjs/havok")) return "havok";
          if (id.includes("@babylonjs/")) return "babylon";
          if (/node_modules\/(@vue|vue|pinia)\//.test(id)) return "vue";
          return "vendor";
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  server: {
    // Bind to all interfaces so devices on the local network (e.g. testing
    // multiplayer with other players) can load the page via this machine's IP.
    host: true,
    headers: {
      // Required for SharedArrayBuffer used by Havok WASM
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
