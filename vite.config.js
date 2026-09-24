import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
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
          if (/colyseus/.test(id)) return "colyseus";
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
