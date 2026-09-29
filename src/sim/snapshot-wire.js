/**
 * One truck of RaceSimulation.getSnapshot() in the wire snapshot's short keys
 * (server/lobby/index.js sends it; src/net reads it):
 *   x y z h vx vy vz   pose + velocity      flags  1 grounded, 2 nitro, 4 finished, 8 speed pad
 *   lap cp n           laps, checkpoints, nitros left
 *   p rl sl th st      chassis pitch/roll, slip, throttle, steer
 *   bt sbt nd ns       nitro / speed-pad time left, head-on drive/steer lockouts
 *   sc                 suspension compression (a respawn zeroes it)
 */
export function wireTruck(s) {
  return {
    id: s.id, x: s.x, y: s.y, z: s.z, h: s.h, vx: s.vx, vy: s.vy, vz: s.vz, flags: s.flags,
    lap: s.lap, cp: s.cp, n: s.boosts, p: s.pitch, rl: s.roll, sl: s.slip, th: s.throttle, st: s.steer,
    bt: s.boostTimer, sbt: s.speedBoostTimer, nd: s.noDriveTimer, ns: s.noSteerTimer, sc: s.suspension,
  };
}
