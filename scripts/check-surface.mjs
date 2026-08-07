// Surface-height contract checks: `npm run check:surface`
//
// There are two answers to "what is the ground at (x,z)": the analytic
// heightfield (Track.getHeightAt — cheap, but blind to bridge decks and other
// registered surfaces) and the raycast stack (TerrainQuery → DriveSurfaceManager
// — layer-aware, but only finds *registered surface meshes*, so it legitimately
// misses open terrain).
//
// Neither is correct alone, so callers must combine them. That only works if a
// miss is distinguishable from a hit: TerrainQuery.tryHeightAt/tryHeightAtFast
// return null for "no surface here", which is a different statement from "the
// ground is at y = 0". Before that contract existed, the height APIs returned a
// caller-supplied fallback (defaulting to 0) on a miss, and two callers silently
// swallowed it:
//
//   1. floor      — TerrainPhysics._sampleFloorYAt documented an analytic
//                   fall-through that was unreachable whenever a terrainQuery
//                   existed (i.e. always). A miss returned the fallback instead.
//   2. respawn    — AI recovery placed the truck at fallback 0 (+0.6) wherever
//                   the raycast missed, regardless of the real ground height.
//
// The wheel-probe sampler deliberately does NOT fall through — see below.
// Pure arithmetic against stubbed samplers. Exits non-zero on any failure.

import { TerrainPhysics } from '../src/truck/TerrainPhysics.js';
import { AISpawnRecoveryController } from '../src/ai/controllers/AISpawnRecoveryController.js';

let failures = 0;
const check = (label, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${ok ? '' : ` (got ${actual}, want ${expected})`}`);
};

const ANALYTIC_Y = 12; // open terrain height reported by the heightfield
const DECK_Y = 30;     // a registered surface (bridge deck) above it

// ── 1. TerrainPhysics floor sampling ────────────────────────────────────────
{
  const track = { getHeightAt: () => ANALYTIC_Y };
  const makePhysics = (rayResult) => new TerrainPhysics(
    { heading: 0, velocity: { x: 0, y: 0, z: 0 } },
    0.75,
    { tryHeightAtFast: () => rayResult, getLastResolvedSurface: () => null },
  );

  check('floor: registered surface beats the heightfield',
    makePhysics(DECK_Y)._sampleFloorYAt(0, 0, 500, track, 0), DECK_Y);

  // The regression: this used to return the fallback and never consult `track`.
  check('floor: a miss falls through to the heightfield',
    makePhysics(null)._sampleFloorYAt(0, 0, 500, track, 0), ANALYTIC_Y);

  // The whole point of the null contract — 0 is a real height, not a miss.
  check('floor: a surface at y=0 is a hit, not a miss',
    makePhysics(0)._sampleFloorYAt(0, 0, 500, track, 99), 0);

  check('floor: fallback only when there is no track at all',
    makePhysics(null)._sampleFloorYAt(0, 0, 500, null, -7), -7);

  check('floor: sampleSurfaceYFastAt shares the path',
    makePhysics(null).sampleSurfaceYFastAt(0, 0, 500, track, 0), ANALYTIC_Y);

  // Deliberate asymmetry: these are the wheel probes either side of centre,
  // used to keep the truck level across a bridge-deck edge. A probe that misses
  // the deck must inherit the centre height, NOT drop to the ground beneath it.
  check('probe: a wheel miss inherits centre height, not the ground below',
    makePhysics(null)._sampleFastSurface(0, 0, 500, DECK_Y, {}).y, DECK_Y);
}

// ── 2. AI respawn placement ─────────────────────────────────────────────────
// Raycast-first is correct here (recovery targets path waypoints and topology
// connectors, which can sit on decks) — but a miss must not read as sea level.
{
  const makeCtrl = (rayY, analyticY) => new AISpawnRecoveryController({
    _terrainQuery: { tryHeightAt: () => rayY },
    track: analyticY == null ? null : { getHeightAt: () => analyticY },
  });

  check('respawn: deck hit wins',
    makeCtrl(DECK_Y, ANALYTIC_Y)._respawnGroundY(0, 0), DECK_Y);

  check('respawn: a miss falls through to the heightfield',
    makeCtrl(null, ANALYTIC_Y)._respawnGroundY(0, 0), ANALYTIC_Y);

  check('respawn: a surface at y=0 is a hit, not a miss',
    makeCtrl(0, ANALYTIC_Y)._respawnGroundY(0, 0), 0);

  // A pit: the old silent 0 would have lifted the truck out of it.
  check('respawn: negative ground is preserved',
    makeCtrl(null, -8)._respawnGroundY(0, 0), -8);

  check('respawn: 0 only when nothing can answer',
    makeCtrl(null, null)._respawnGroundY(0, 0), 0);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall surface checks pass');
process.exit(failures ? 1 : 0);
