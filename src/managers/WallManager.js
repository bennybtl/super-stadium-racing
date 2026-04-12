import { PolyWall } from "../objects/PolyWall.js";
import { BezierWall } from "../objects/BezierWall.js";
import { PolyCurb } from "../objects/PolyCurb.js";
import { TRUCK_RADIUS } from "../constants.js";

/**
 * WallManager - Creates and manages race track walls (poly).
 *
 * Wall construction and disposal is delegated to the object classes in
 * src/objects/. This manager is responsible for spawning walls from track
 * features, running per-frame velocity clamping and collision resolution
 * against trucks, and the reset/dispose lifecycle.
 *
 * Trucks use PhysicsMotionType.ANIMATED so the engine won't push them back
 * automatically. WallManager manually cancels the velocity component that
 * drives into each wall segment every frame.
 */
export class WallManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // Wall objects (PolyWall, BezierWall)
    this._walls = [];

    // Curb objects (PolyCurb) — stored separately so they are never included
    // in _segments and therefore never trigger velocity-cancellation logic.
    // Trucks can freely drive over curbs; their visual presence comes from
    // the WallSegment boxes with alternating red/white material.
    this._curbs = [];
  }

  // ─── Convenience getter — flat list of all WallSegment instances ─────────
  get _segments() {
    return this._walls.flatMap(w => w.segments);
  }

  createPolyWall(feature) {
    this._walls.push(new PolyWall(feature, this.track, this.scene, this.shadows));
  }

  createBezierWall(feature) {
    this._walls.push(new BezierWall(feature, this.track, this.scene, this.shadows));
  }

  createPolyCurb(feature) {
    this._curbs.push(new PolyCurb(feature, this.track, this.scene, this.shadows));
  }

  // ─── Pre-frame velocity clamp (call BEFORE updateTruck) ────────────────

  /**
   * Predicts each truck's next position and cancels any velocity component
   * that would drive it into a wall. Call this BEFORE updateTruck() so that
   * grip/drift physics cannot re-inject wall-ward motion during the move step.
   */
  preUpdate(trucks, dt) {
    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;
      const radius = truck.radius ?? TRUCK_RADIUS;
      for (const seg of this._segments) {
        this._preClampVelocity(truck, seg, radius, dt);
      }
    }
  }

  _preClampVelocity(truck, seg, truckRadius, dt) {
    const vel = truck.state.velocity;
    const pos = truck.mesh.position;
    const h    = seg.heading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);

    const halfLen   = seg.halfLength + truckRadius;
    const halfThick = seg.halfThick  + truckRadius;

    // Current local-space position
    const dx     = pos.x - seg.position.x;
    const dz     = pos.z - seg.position.z;
    const curLocalX = cosH * dx - sinH * dz;
    const curLocalZ = sinH * dx + cosH * dz;

    // Predicted local-space position after this frame's movement
    const nextX = pos.x + vel.x * dt;
    const nextZ = pos.z + vel.z * dt;
    const ndx = nextX - seg.position.x;
    const ndz = nextZ - seg.position.z;
    const nextLocalX = cosH * ndx - sinH * ndz;
    const nextLocalZ = sinH * ndx + cosH * ndz;

    // Would the truck enter or cross the wall this frame?
    const nextInWall = Math.abs(nextLocalX) < halfLen && Math.abs(nextLocalZ) < halfThick;
    const crosses    = curLocalZ * nextLocalZ < 0;

    if (!nextInWall && !crosses) return;
    // Make sure the truck is within the wall's length (not flying past an end)
    if (Math.abs(curLocalX) > halfLen && Math.abs(nextLocalX) > halfLen) return;

    // Truck is about to hit the wall — cancel only the into-wall component.
    const signZ   = Math.sign(curLocalZ) || 1;
    const normalX = sinH * signZ;
    const normalZ = cosH * signZ;
    const velDotNormal = vel.x * normalX + vel.z * normalZ;
    if (velDotNormal < 0) {
      vel.x -= normalX * velDotNormal;
      vel.z -= normalZ * velDotNormal;
      // Bleed off a fraction of the remaining (tangential) speed
      const retain = 1 - seg.friction;
      vel.x *= retain;
      vel.z *= retain;
    }
  }

  // ─── Per-frame Collision ─────────────────────────────────────────────────

  /**
   * Call every game-loop frame with the trucks array from main.js.
   * For each truck × wall segment: push the truck out, cancel into-wall
   * velocity, and smoothly correct its heading so it slides along the wall.
   */
  update(trucks) {
    if (!this._prevPositions) this._prevPositions = new Map();
    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;
      const id = truck.mesh.uniqueId;
      const pos = truck.mesh.position;
      const prevPos = this._prevPositions.get(id) ?? pos.clone();

      for (const seg of this._segments) {
        this._resolveCollision(truck, seg, truck.radius ?? TRUCK_RADIUS, prevPos);
      }

      // Record resolved position for next frame's swept test
      this._prevPositions.set(id, pos.clone());
    }
  }

  _resolveCollision(truck, seg, truckRadius, prevPos) {
    const pos  = truck.mesh.position;
    const h    = seg.heading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);

    const halfLen   = seg.halfLength + truckRadius;
    const halfThick = seg.halfThick  + truckRadius;

    const dx     = pos.x - seg.position.x;
    const dz     = pos.z - seg.position.z;
    const localX = cosH * dx - sinH * dz;
    const localZ = sinH * dx + cosH * dz;

    const pdx        = prevPos.x - seg.position.x;
    const pdz        = prevPos.z - seg.position.z;
    const prevLocalX = cosH * pdx - sinH * pdz;
    const prevLocalZ = sinH * pdx + cosH * pdz;

    // signZ = which side of the wall the truck came from
    const prevSignZ = Math.sign(prevLocalZ);
    const signZ = prevSignZ !== 0 ? prevSignZ : (Math.sign(localZ) || 1);

    const crossed = prevLocalZ * localZ < 0;
    const inWall  = Math.abs(localX) < halfLen && Math.abs(localZ) < halfThick;

    let collisionType;
    if (crossed) {
      // Swept: verify the crossing point is within the wall's length
      const t      = Math.abs(prevLocalZ) / (Math.abs(prevLocalZ) + Math.abs(localZ));
      const crossX = prevLocalX + t * (localX - prevLocalX);
      if (Math.abs(crossX) > halfLen) return;
      collisionType = 'swept';
    } else if (inWall) {
      collisionType = 'overlap';
    } else {
      return;
    }

    const vel     = truck.state.velocity;
    const normalX = sinH * signZ;
    const normalZ = cosH * signZ;
    const velDotNormal = vel.x * normalX + vel.z * normalZ;

    // Cancel only the into-wall velocity component — preserve the parallel
    // component so the truck slides along the wall face.
    const velXBefore = vel.x, velZBefore = vel.z;
    const didCancel = velDotNormal < 0;
    if (didCancel) {
      vel.x -= normalX * velDotNormal;
      vel.z -= normalZ * velDotNormal;
      // Bleed off a fraction of the remaining (tangential) speed
      const retain = 1 - seg.friction;
      vel.x *= retain;
      vel.z *= retain;

      // Only snap heading if the truck is moving significantly into the wall
      // If the truck is nearly parallel and trying to steer away, don't force it parallel
      const speedIntoWall = Math.abs(velDotNormal);
      const shouldSnapHeading = speedIntoWall > 3; // Only snap if moving hard into wall
      
      if (shouldSnapHeading) {
        // Snap truck heading to whichever wall-parallel direction is closest
        // to the truck's current heading. The wall's normal is (sin(h), cos(h)),
        // so the two parallel directions are h+π/2 and h-π/2.
        const truckH = truck.state.heading;
        const wallParallel0 = h + Math.PI / 2;
        const wallParallel1 = h - Math.PI / 2;

        // Angular distance (wrapped to [-π, π]) to each candidate
        const diff0 = ((truckH - wallParallel0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const diff1 = ((truckH - wallParallel1 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        
        const newHeading = Math.abs(diff0) <= Math.abs(diff1) ? wallParallel0 : wallParallel1;
        truck.state.heading = newHeading;

        const deg = v => (v * 180 / Math.PI).toFixed(1) + '°';
      }
    }

    // Push the truck back to the wall surface (with a small buffer)
    let correctionZ = 0;
    const bufferDistance = 0.05; // Small buffer to prevent getting stuck
    if (Math.abs(localZ) < halfThick) {
      correctionZ = signZ * (halfThick + bufferDistance) - localZ;
      pos.x += sinH * correctionZ;
      pos.z += cosH * correctionZ;
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
    this._prevPositions = new Map();
  }

  rebuild() {
    this.reset();
    for (const feature of this.track.features) {
      if (feature.type === "polyWall")   this.createPolyWall(feature);
      if (feature.type === "bezierWall") this.createBezierWall(feature);
      if (feature.type === "polyCurb")   this.createPolyCurb(feature);
    }
  }

  // ─── AI Helpers ──────────────────────────────────────────────────────────

  /**
   * Returns an array of { x, z, halfLength, heading } descriptors for every
   * wall segment so AIDriver can mark those grid cells as blocked.
   */
  getWallSegments() {
    return this._segments.map(seg => ({
      x: seg.position.x,
      z: seg.position.z,
      halfLength: seg.halfLength,
      halfDepth:  seg.halfThick,
      heading:    seg.heading,
    }));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  dispose() {
    for (const wall of this._walls) wall.dispose();
    this._walls = [];
    for (const curb of this._curbs) curb.dispose();
    this._curbs = [];
  }
}
