import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");
const PORT = Number(process.env.PORT) || 8080;

const app = express();

// Required for SharedArrayBuffer, which Havok's WASM build needs — mirrors
// the headers vite.config.js sets for the dev server (dev's don't apply once
// the app is served as a static production build).
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  next();
});

app.use(express.static(distDir));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[offroad-web] serving dist/ on http://0.0.0.0:${PORT}`);
});
