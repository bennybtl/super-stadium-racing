import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import { getSharedCloudTexture } from "../truck/ParticleEffects.js";
import { isPointInPolygon } from "../polyline-utils.js";
import { FireworkLaunchers } from "../objects/FireworkLaunchers.js";
import { resolveSparkColor, DEFAULT_SPARK_COLOR } from "../objects/sparkColors.js";

// =============================================================================
// Tunable constants
// =============================================================================

/** Shell colours, picked at random per launch. */
const SHELL_COLORS = [
  [1.00, 0.30, 0.30],
  [1.00, 0.75, 0.20],
  [0.35, 0.75, 1.00],
  [0.55, 1.00, 0.40],
  [1.00, 0.40, 0.85],
  [0.75, 0.60, 1.00],
  [1.00, 1.00, 0.80],
];

/** Downward acceleration on a rising shell (m/s²). Tuned for a lofty arc. */
const SHELL_GRAVITY = 14;
/** Seconds between the shells of one volley. */
const LAUNCH_STAGGER = 0.16;
/** Horizontal scatter (m) of launch points when firing without cans. */
const LAUNCH_SPREAD = 8;
/** Horizontal jitter (m) applied to shells leaving a mortar can. */
const MUZZLE_JITTER = 0.3;
/** Seconds a zone must wait before it can fire again. */
const ZONE_COOLDOWN = 2.5;
/** Safety cap on shells in flight / bursts alight at once. */
const MAX_TRAILS = 6;
const MAX_BURSTS = 6;
/** Particles emitted by one burst. */
const BURST_PARTICLES = 160;
/** Longest a burst's particles can stay alive (used to free pooled systems). */
const BURST_MAX_LIFETIME = 1.9;

/** Sustained emitters (spark fountains, flame blasts): pool cap and per-mode feel. */
const MAX_JETS = 6;
const SPARK_EMIT_RATE = 400;
const SPARK_MAX_LIFETIME = 1.1;
/** Gravity on fountain sparks (downward-positive) — reach is solved against it. */
const SPARK_GRAVITY = 9;
const FLAME_EMIT_RATE = 260;
const FLAME_MAX_LIFETIME = 0.6;
/** Same convention, negative: hot gas keeps climbing instead of falling. */
const FLAME_GRAVITY = -1.5;

// =============================================================================

/**
 * FireworksManager — launches a firework volley when a truck drives into a
 * `zoneType: "fireworks"` action zone.
 *
 * Each zone gets a pair of mortar cans (FireworkLaunchers) built the first time
 * it is seen, and fires one of three ways (`fireworkMode`):
 *
 *   shell  – `fireworkCount` shells alternate between the two muzzles. Each is a
 *            trail particle system riding a ballistic point; at apex the trail
 *            cuts out and a pooled burst system emits one radial shell of sparks.
 *   sparks – both cans run a gerb-style fountain of sparks for `fireworkDuration`.
 *   flame  – both cans throw a short column of fire for `fireworkDuration`.
 *
 * Every particle system is pooled and reused — a trigger never allocates.
 *
 * Usage:
 *   const fw = new FireworksManager(scene, track);
 *   fw.update(trucks, zones, dt);   // each frame
 *   fw.dispose();                   // on mode teardown
 */
export class FireworksManager {
  constructor(scene, track = null) {
    this.scene = scene;
    this.track = track;

    /** @type {{ system: ParticleSystem, emitter: Vector3, busy: boolean }[]} */
    this._trails = [];
    /** @type {{ system: ParticleSystem, emitter: Vector3, busyFor: number }[]} */
    this._bursts = [];

    /** Shells climbing toward their burst point. */
    this._shells = [];
    /** Staggered launches waiting on their turn in the volley. */
    this._queued = [];
    /** Cooldown seconds remaining, keyed by zone feature. */
    this._cooldowns = new Map();
    /** Which zones each truck was inside last frame, for edge detection. */
    this._insideByTruckId = new Map();
    /** @type {Map<object, FireworkLaunchers>} mortar cans, keyed by zone feature. */
    this._launchersByZone = new Map();
    /** Sustained emitters (fountains, flames), pooled per mode. */
    this._jets = [];
  }

  /**
   * Advance in-flight fireworks and fire any zone a truck has just entered.
   * `zones` are the track's `fireworks` action-zone features.
   */
  update(trucks, zones, dt) {
    this._syncLaunchers(zones);
    this._checkZoneEntries(trucks, zones, dt);
    this._advanceQueue(dt);
    this._advanceShells(dt);
    this._advanceJets(dt);
    this._releaseFinishedBursts(dt);
  }

  /**
   * Fire one volley centred on (x, z).
   *
   * With `points` (muzzle positions from a zone's cans) shells alternate between
   * the tubes; without them they rise from scattered spots around (x, z) at
   * ground level, so anything else — a lap win, a stunt — can set off fireworks
   * anywhere without needing launchers.
   */
  launch(x, z, { count = 4, height = 25, points = null } = {}) {
    const shells = Math.max(1, Math.min(MAX_TRAILS, Math.round(count)));
    const baseY = this.track?.getHeightAt?.(x, z) ?? 0;

    for (let i = 0; i < shells; i++) {
      const muzzle = points?.length ? points[i % points.length] : null;
      this._queued.push({
        delay: i * LAUNCH_STAGGER,
        // Muzzle shells get a touch of jitter so consecutive shots out of the
        // same tube don't trace one identical line.
        x: muzzle ? muzzle.x + (Math.random() - 0.5) * MUZZLE_JITTER : x + (Math.random() - 0.5) * LAUNCH_SPREAD,
        z: muzzle ? muzzle.z + (Math.random() - 0.5) * MUZZLE_JITTER : z + (Math.random() - 0.5) * LAUNCH_SPREAD,
        y: muzzle ? muzzle.y : baseY,
        // Vary the apex so a volley doesn't burst as one flat layer.
        height: Math.max(6, height * (0.8 + Math.random() * 0.4)),
        color: SHELL_COLORS[Math.floor(Math.random() * SHELL_COLORS.length)],
      });
    }
  }

  dispose() {
    for (const t of this._trails) t.system.dispose();
    for (const b of this._bursts) b.system.dispose();
    for (const j of this._jets) j.system.dispose();
    for (const launchers of this._launchersByZone.values()) launchers.dispose();
    this._launchersByZone.clear();
    this._trails = [];
    this._bursts = [];
    this._jets = [];
    this._shells = [];
    this._queued = [];
    this._cooldowns.clear();
    this._insideByTruckId.clear();
  }

  // ── Launchers ──────────────────────────────────────────────────────────────

  /** Build cans for zones we haven't seen yet, and drop any that went away. */
  _syncLaunchers(zones) {
    if (!this.track) return;

    for (const zone of zones ?? []) {
      if (!this._launchersByZone.has(zone)) {
        this._launchersByZone.set(zone, new FireworkLaunchers(zone, this.track, this.scene));
      }
    }

    if (this._launchersByZone.size === (zones?.length ?? 0)) return;
    const live = new Set(zones ?? []);
    for (const [zone, launchers] of this._launchersByZone) {
      if (live.has(zone)) continue;
      launchers.dispose();
      this._launchersByZone.delete(zone);
    }
  }

  // ── Triggering ─────────────────────────────────────────────────────────────

  _checkZoneEntries(trucks, zones, dt) {
    for (const [zone, remaining] of this._cooldowns) {
      const next = remaining - dt;
      if (next <= 0) this._cooldowns.delete(zone);
      else this._cooldowns.set(zone, next);
    }

    if (!zones?.length) return;

    for (let i = 0; i < trucks.length; i++) {
      const truck = trucks[i]?.truck ?? trucks[i];
      if (!truck?.mesh) continue;
      const truckId = trucks[i]?.id ?? truck.id ?? i;

      let wasInside = this._insideByTruckId.get(truckId);
      if (!wasInside) {
        wasInside = new Set();
        this._insideByTruckId.set(truckId, wasInside);
      }

      const { x, z } = truck.mesh.position;
      for (const zone of zones) {
        const inside = isPointInZone(x, z, zone);
        // Edge trigger: only the frame a truck crosses in, and only once the
        // zone's cooldown has expired (a pack of trucks shouldn't chain-fire it).
        if (inside && !wasInside.has(zone) && !this._cooldowns.has(zone)) {
          this._fireZone(zone, x, z);
        }
        if (inside) wasInside.add(zone);
        else wasInside.delete(zone);
      }
    }
  }

  /**
   * Set a zone off in whichever mode it is authored for, right now, ignoring
   * cooldowns. `points` are the muzzles to fire from — the caller's own cans in
   * the editor preview, or the manager's for a zone it built itself.
   *
   * @returns {number} seconds the zone should stay shut afterwards.
   */
  trigger(zone, points = null, fallbackX = 0, fallbackZ = 0) {
    const mode = zone.fireworkMode ?? 'shell';
    const duration = Math.max(0.2, zone.fireworkDuration ?? 2);

    if (mode === 'sparks' || mode === 'flame') {
      this._startJets(mode, points, duration, zone.fireworkHeight ?? 10, zone.fireworkColor);
      return Math.max(ZONE_COOLDOWN, duration + 0.5);
    }

    this.launch(zone.x ?? fallbackX, zone.z ?? fallbackZ, {
      count: zone.fireworkCount ?? 4,
      height: zone.fireworkHeight ?? 25,
      points,
    });
    return ZONE_COOLDOWN;
  }

  /**
   * Fire a zone a truck has just driven into, and start its cooldown. A
   * sustained mode holds the zone shut until its own run has finished.
   */
  _fireZone(zone, truckX, truckZ) {
    const points = this._launchersByZone.get(zone)?.launchPoints ?? null;
    this._cooldowns.set(zone, this.trigger(zone, points, truckX, truckZ));
  }

  // ── Sustained emitters (sparks / flame) ────────────────────────────────────

  /**
   * Run a fountain or flame out of every muzzle for `duration` seconds.
   * `reach` is the height the jet should throw to, solved against the mode's own
   * gravity so the slider means roughly the same thing as the shell burst height.
   * `colorName` tints spark fountains; flame always burns fire-coloured.
   */
  _startJets(mode, points, duration, reach, colorName = DEFAULT_SPARK_COLOR) {
    const muzzles = points?.length ? points : [];
    if (!muzzles.length) return;

    const gravity = mode === 'flame' ? FLAME_GRAVITY : SPARK_GRAVITY;
    // Flame climbs under negative gravity, so fall back to a plain speed for it.
    const power = gravity > 0
      ? Math.sqrt(2 * gravity * Math.max(1, reach))
      : Math.max(10, reach * 1.55);

    for (const muzzle of muzzles) {
      const jet = this._acquireJet(mode);
      if (!jet) return;

      jet.busy = true;
      jet.emitFor = duration;
      // Hold the system out of the pool until the last particle has died.
      jet.busyFor = duration + (mode === 'flame' ? FLAME_MAX_LIFETIME : SPARK_MAX_LIFETIME);
      jet.emitter.set(muzzle.x, muzzle.y, muzzle.z);
      jet.system.minEmitPower = power * 0.7;
      jet.system.maxEmitPower = power;
      jet.system.emitRate = mode === 'flame' ? FLAME_EMIT_RATE : SPARK_EMIT_RATE;
      // Colours are read at emission, so re-tinting a pooled system only affects
      // the sparks it is about to throw — anything still in the air keeps its own.
      if (mode === 'sparks') this._tintSparkJet(jet, colorName);
    }
  }

  _tintSparkJet(jet, colorName) {
    const { core, body, dead } = resolveSparkColor(colorName);
    jet.system.color1 = new Color4(core[0], core[1], core[2], 1);
    jet.system.color2 = new Color4(body[0], body[1], body[2], 1);
    jet.system.colorDead = new Color4(dead[0], dead[1], dead[2], 0);
  }

  _advanceJets(dt) {
    for (const jet of this._jets) {
      if (!jet.busy) continue;

      jet.emitFor -= dt;
      if (jet.emitFor <= 0 && jet.system.emitRate !== 0) jet.system.emitRate = 0;

      jet.busyFor -= dt;
      if (jet.busyFor <= 0) jet.busy = false;
    }
  }

  // ── Flight ─────────────────────────────────────────────────────────────────

  _advanceQueue(dt) {
    for (let i = this._queued.length - 1; i >= 0; i--) {
      const q = this._queued[i];
      q.delay -= dt;
      if (q.delay > 0) continue;
      this._queued.splice(i, 1);
      this._launchShell(q);
    }
  }

  _launchShell({ x, y, z, height, color }) {
    const trail = this._acquireTrail();
    if (!trail) return; // pool exhausted — drop the shell rather than allocate

    trail.busy = true;
    trail.emitter.set(x, y, z);
    trail.system.color1 = new Color4(color[0], color[1], color[2], 0.9);
    trail.system.color2 = new Color4(1, 1, 1, 0.6);
    trail.system.colorDead = new Color4(color[0], color[1], color[2], 0);
    trail.system.emitRate = 220;

    this._shells.push({
      trail,
      color,
      // Exact launch speed to peak at `height`, so the burst lands where asked.
      vy: Math.sqrt(2 * SHELL_GRAVITY * height),
      x, y, z,
    });
  }

  _advanceShells(dt) {
    for (let i = this._shells.length - 1; i >= 0; i--) {
      const shell = this._shells[i];
      shell.vy -= SHELL_GRAVITY * dt;
      shell.y += shell.vy * dt;
      shell.trail.emitter.set(shell.x, shell.y, shell.z);

      if (shell.vy > 0) continue;

      // Apex: cut the trail and pop.
      shell.trail.system.emitRate = 0;
      shell.trail.busy = false;
      this._shells.splice(i, 1);
      this._burst(shell.x, shell.y, shell.z, shell.color);
    }
  }

  _burst(x, y, z, color) {
    const burst = this._acquireBurst();
    if (!burst) return;

    burst.busyFor = BURST_MAX_LIFETIME;
    burst.emitter.set(x, y, z);
    burst.system.color1 = new Color4(color[0], color[1], color[2], 1);
    burst.system.color2 = new Color4(
      Math.min(1, color[0] + 0.35),
      Math.min(1, color[1] + 0.35),
      Math.min(1, color[2] + 0.35),
      1,
    );
    burst.system.colorDead = new Color4(color[0] * 0.4, color[1] * 0.4, color[2] * 0.4, 0);
    burst.system.manualEmitCount = BURST_PARTICLES;
  }

  _releaseFinishedBursts(dt) {
    for (const burst of this._bursts) {
      if (burst.busyFor > 0) burst.busyFor -= dt;
    }
  }

  // ── Pools ──────────────────────────────────────────────────────────────────

  _acquireTrail() {
    const free = this._trails.find(t => !t.busy);
    if (free) return free;
    if (this._trails.length >= MAX_TRAILS) return null;
    const trail = this._createTrail(this._trails.length);
    this._trails.push(trail);
    return trail;
  }

  _acquireJet(mode) {
    const free = this._jets.find(j => !j.busy && j.mode === mode);
    if (free) return free;
    if (this._jets.length >= MAX_JETS) return null;
    const jet = mode === 'flame'
      ? this._createFlameJet(this._jets.length)
      : this._createSparkJet(this._jets.length);
    this._jets.push(jet);
    return jet;
  }

  _acquireBurst() {
    const free = this._bursts.find(b => b.busyFor <= 0);
    if (free) return free;
    if (this._bursts.length >= MAX_BURSTS) return null;
    const burst = this._createBurst(this._bursts.length);
    this._bursts.push(burst);
    return burst;
  }

  _createTrail(index) {
    const emitter = new Vector3();
    const system = new ParticleSystem(`fwTrail${index}`, 260, this.scene);
    system.particleTexture = getSharedCloudTexture(this.scene);
    system.emitter = emitter;
    system.minEmitBox = new Vector3(-0.15, -0.15, -0.15);
    system.maxEmitBox = new Vector3(0.15, 0.15, 0.15);

    system.minSize = 0.35;
    system.maxSize = 0.9;
    system.minLifeTime = 0.12;
    system.maxLifeTime = 0.35;

    system.emitRate = 0;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.gravity = new Vector3(0, -3, 0);
    system.direction1 = new Vector3(-0.6, -1.2, -0.6);
    system.direction2 = new Vector3(0.6, -0.2, 0.6);
    system.minEmitPower = 0.4;
    system.maxEmitPower = 1.4;
    system.updateSpeed = 0.01;

    system.start();
    return { system, emitter, busy: false };
  }

  /** Gerb fountain: a tight cone of small, long-lived gold sparks. */
  _createSparkJet(index) {
    const emitter = new Vector3();
    const system = new ParticleSystem(`fwSparks${index}`, 500, this.scene);
    system.particleTexture = getSharedCloudTexture(this.scene);
    system.emitter = emitter;
    system.minEmitBox = new Vector3(-0.1, 0, -0.1);
    system.maxEmitBox = new Vector3(0.1, 0, 0.1);

    system.minSize = 0.14;
    system.maxSize = 0.3;
    system.minLifeTime = 0.45;
    system.maxLifeTime = SPARK_MAX_LIFETIME;

    system.emitRate = 0;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.gravity = new Vector3(0, -SPARK_GRAVITY, 0);
    system.direction1 = new Vector3(-0.15, 1, -0.15);
    system.direction2 = new Vector3(0.15, 1, 0.15);
    system.minAngularSpeed = 0;
    system.maxAngularSpeed = Math.PI * 1.5;
    system.updateSpeed = 0.01;

    system.start();
    const jet = { system, emitter, mode: 'sparks', busy: false, emitFor: 0, busyFor: 0 };
    this._tintSparkJet(jet, DEFAULT_SPARK_COLOR);
    return jet;
  }

  /** Flame blast: a fat, short-lived column of fire that keeps rising as it fades. */
  _createFlameJet(index) {
    const emitter = new Vector3();
    const system = new ParticleSystem(`fwFlame${index}`, 420, this.scene);
    system.particleTexture = getSharedCloudTexture(this.scene);
    system.emitter = emitter;
    system.minEmitBox = new Vector3(-0.2, 0, -0.2);
    system.maxEmitBox = new Vector3(0.2, 0, 0.2);

    system.color1 = new Color4(1.0, 0.85, 0.35, 0.9);
    system.color2 = new Color4(1.0, 0.35, 0.05, 0.8);
    system.colorDead = new Color4(0.35, 0.06, 0.0, 0);

    system.minSize = 1.0;
    system.maxSize = 3.0;
    system.minLifeTime = 0.22;
    system.maxLifeTime = FLAME_MAX_LIFETIME;

    system.emitRate = 0;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    // Negative gravity: the column keeps climbing and widening as it burns out.
    system.gravity = new Vector3(0, -FLAME_GRAVITY, 0);
    system.direction1 = new Vector3(-0.35, 1, -0.35);
    system.direction2 = new Vector3(0.35, 1, 0.35);
    system.minAngularSpeed = 0;
    system.maxAngularSpeed = Math.PI;
    system.updateSpeed = 0.012;

    system.start();
    return { system, emitter, mode: 'flame', busy: false, emitFor: 0, busyFor: 0 };
  }

  _createBurst(index) {
    const emitter = new Vector3();
    const system = new ParticleSystem(`fwBurst${index}`, BURST_PARTICLES + 40, this.scene);
    system.particleTexture = getSharedCloudTexture(this.scene);
    system.emitter = emitter;
    // A zero-range sphere emitter puts every particle on one shell and sends it
    // straight outward — the radial pop a firework needs.
    system.createSphereEmitter(1.0, 0);

    system.minSize = 0.45;
    system.maxSize = 1.3;
    system.minLifeTime = 1.0;
    system.maxLifeTime = BURST_MAX_LIFETIME;

    system.emitRate = 0;
    system.blendMode = ParticleSystem.BLENDMODE_ADD;
    system.gravity = new Vector3(0, -7, 0);
    system.minEmitPower = 9;
    system.maxEmitPower = 15;
    system.minAngularSpeed = 0;
    system.maxAngularSpeed = Math.PI;
    system.updateSpeed = 0.012;

    system.start();
    return { system, emitter, busyFor: 0 };
  }
}

/**
 * Point-in-zone test mirroring DriveMode.isPointInActionZone, kept local so the
 * manager stays usable without a mode instance.
 */
function isPointInZone(x, z, zone) {
  if (!zone) return false;

  if (zone.shape === 'polygon' && Array.isArray(zone.points)) {
    return isPointInPolygon(x, z, zone.points);
  }

  const dx = x - (zone.x ?? 0);
  const dz = z - (zone.z ?? 0);
  const r = Math.max(0, zone.radius ?? 0);
  return dx * dx + dz * dz < r * r;
}
