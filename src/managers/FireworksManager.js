import { Vector3, Color4, ParticleSystem } from "@babylonjs/core";
import { getSharedCloudTexture } from "../truck/ParticleEffects.js";
import { isPointInPolygon } from "../polyline-utils.js";

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
/** Horizontal scatter (m) of launch points around the zone centre. */
const LAUNCH_SPREAD = 8;
/** Seconds a zone must wait before it can fire again. */
const ZONE_COOLDOWN = 2.5;
/** Safety cap on shells in flight / bursts alight at once. */
const MAX_TRAILS = 6;
const MAX_BURSTS = 6;
/** Particles emitted by one burst. */
const BURST_PARTICLES = 160;
/** Longest a burst's particles can stay alive (used to free pooled systems). */
const BURST_MAX_LIFETIME = 1.9;

// =============================================================================

/**
 * FireworksManager — launches a firework volley when a truck drives into a
 * `zoneType: "fireworks"` action zone.
 *
 * Each trigger fires `fireworkCount` shells from scattered points around the
 * zone centre. A shell is a trail particle system riding a ballistic point;
 * at apex the trail cuts out and a pooled burst system emits one radial
 * shell of sparks.
 *
 * Trail and burst systems are pooled and reused — a volley never allocates.
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
  }

  /**
   * Advance in-flight fireworks and fire any zone a truck has just entered.
   * `zones` are the track's `fireworks` action-zone features.
   */
  update(trucks, zones, dt) {
    this._checkZoneEntries(trucks, zones, dt);
    this._advanceQueue(dt);
    this._advanceShells(dt);
    this._releaseFinishedBursts(dt);
  }

  /**
   * Fire one volley centred on (x, z), rising from ground level there.
   * Exposed so anything else (a lap win, a stunt) can set off fireworks too.
   */
  launch(x, z, { count = 4, height = 25 } = {}) {
    const shells = Math.max(1, Math.min(MAX_TRAILS, Math.round(count)));
    const baseY = this.track?.getHeightAt?.(x, z) ?? 0;

    for (let i = 0; i < shells; i++) {
      this._queued.push({
        delay: i * LAUNCH_STAGGER,
        x: x + (Math.random() - 0.5) * LAUNCH_SPREAD,
        z: z + (Math.random() - 0.5) * LAUNCH_SPREAD,
        y: baseY,
        // Vary the apex so a volley doesn't burst as one flat layer.
        height: Math.max(6, height * (0.8 + Math.random() * 0.4)),
        color: SHELL_COLORS[Math.floor(Math.random() * SHELL_COLORS.length)],
      });
    }
  }

  dispose() {
    for (const t of this._trails) t.system.dispose();
    for (const b of this._bursts) b.system.dispose();
    this._trails = [];
    this._bursts = [];
    this._shells = [];
    this._queued = [];
    this._cooldowns.clear();
    this._insideByTruckId.clear();
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
          this.launch(zone.x ?? x, zone.z ?? z, {
            count: zone.fireworkCount ?? 4,
            height: zone.fireworkHeight ?? 25,
          });
          this._cooldowns.set(zone, ZONE_COOLDOWN);
        }
        if (inside) wasInside.add(zone);
        else wasInside.delete(zone);
      }
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
