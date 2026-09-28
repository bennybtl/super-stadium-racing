/**
 * Seeded randomness for the simulation (docs/MULTIPLAYER.md, Phase 2).
 *
 * Everything random that can change a race's outcome — roughness bumps, AI
 * line choice and boost rolls, pickup spawns — draws from a stream made here
 * instead of Math.random, so a race replays exactly from its seed.
 *
 * Each consumer gets its own stream, derived from the race seed and a label
 * (`rngStream(seed, 'truck:player')`). Streams don't interleave, so one truck's
 * draws never shift another's — which is what lets a client predict just its
 * own truck and still match the server.
 *
 * Consumers default to Math.random when nothing is injected, so code outside
 * a RaceSimulation behaves as before.
 */

/** mulberry32: a small, fast 32-bit PRNG. Returns () => [0, 1). */
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a label into a seed (FNV-1a over the label, then a murmur3 finaliser). */
export function deriveSeed(seed, label) {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** The stream for one consumer of a race: `rngStream(raceSeed, 'pickups')`. */
export function rngStream(seed, label) {
  return createRng(deriveSeed(seed, label));
}

/** A fresh race seed (browser single-player; a server would mint and send one). */
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296) >>> 0;
}
