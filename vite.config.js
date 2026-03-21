import { defineConfig } from "vite";

export default defineConfig({
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
