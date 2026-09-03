import { defineConfig } from "vitest/config";

// Unit tests cover the pure-logic modules only (no Babylon scene, no DOM):
// grid math, polyline math, championship scoring, upgrade economy, colour
// coercion. Rendering / editor / physics code is exercised by the app itself
// and the scripts/check-*.mjs suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
