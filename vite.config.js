import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
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
