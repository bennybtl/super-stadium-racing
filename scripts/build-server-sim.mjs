// `npm run build:server-sim`: bundle the game's simulation for Node
// (server/lobby/sim-entry.js → server/build/sim.mjs) for the lobby child.
// Asset imports become empty, Vite's import.meta.glob an empty table — the
// headless sim needs neither. Havok stays external and loads from node_modules.

import * as esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'server', 'build', 'sim.mjs');

await esbuild.build({
  entryPoints: [join(root, 'server', 'lobby', 'sim-entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  external: ['@babylonjs/havok'],
  loader: Object.fromEntries(
    ['.png', '.jpg', '.jpeg', '.obj', '.mtl', '.glb', '.mp3', '.wav', '.ogg', '.svg'].map((e) => [e, 'empty']),
  ),
  define: { 'import.meta.glob': '__viteGlobStub' },
  banner: { js: 'globalThis.__viteGlobStub = () => ({});' },
  outfile,
  logLevel: 'warning',
});
console.log(`built ${outfile}`);
