import { Matrix, Vector3 } from "@babylonjs/core";
import { TRUCK_DEPTH, TRUCK_HALF_HEIGHT, TRUCK_RADIUS, TRUCK_WIDTH } from "../constants.js";

const SKIN = 0.03;
const DEFAULT_FRICTION = 0.92;
const FRICTION_REF_FPS = 60; // friction metadata is authored as a per-60fps-frame retain factor
const BOUNCE_COEFFICIENT = 1.5; // > 1.0 creates bounce on perpendicular collisions
const BOUNCE_ANGLE_THRESHOLD = Math.cos(30 * Math.PI / 180); // ~0.866 for ±30 degrees

/**
 * StaticBodyCollisionManager
 *
 * Generic truck-vs-static-body resolver for kinematic truck motion.
 * Any mesh can opt-in by setting:
 *   mesh.metadata.truckCollider = true
 * Optional per-mesh tuning:
 *   mesh.metadata.truckColliderFriction = 0..1
 */
export class StaticBodyCollisionManager {
  constructor(scene) {
    this.scene = scene;
    this._prevPositions = new Map();
    this._invWorld = new Matrix();
    this._colliders = [];
  }

  dispose() {
    this._colliders = [];
  }

  reset() {
    this._prevPositions.clear();
  }

  /**
   * Call immediately after teleporting a truck so the swept-AABB broadphase
   * doesn't treat the teleport as a wall-crossing trajectory.
   */
  notifyTeleport(truck) {
    if (truck?.mesh) {
      this._prevPositions.set(truck.mesh.uniqueId, truck.mesh.position.clone());
    }
  }

  resetColliderCache() {
    this._colliders = [];
  }

  _getColliders() {
    if (this._colliders.length === 0) {
      this._colliders = this.scene.meshes.filter(mesh =>
        (mesh?.metadata?.truckCollider === true ||
          mesh?.metadata?.polylineCollider != null) &&
        !mesh.isDisposed() &&
        mesh.isEnabled()
      );
    }
    return this._colliders;
  }

  update(trucks, dt = 1 / FRICTION_REF_FPS) {
    const colliders = this._getColliders();

    if (colliders.length === 0) {
      this._cachePrevPositions(trucks);
      return;
    }

    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck?.mesh || !truck?.state) continue;

      const id = truck.mesh.uniqueId;
      const prevPos = this._prevPositions.get(id) ?? truck.mesh.position.clone();
      const radius = truck.radius ?? TRUCK_RADIUS;
      const halfHeight = truck.halfHeight ?? TRUCK_HALF_HEIGHT;
      // Overlapping colliders (adjacent wall segments) must not each scrub speed.
      const frame = { frictionApplied: false };

      for (const collider of colliders) {
        // Broad-phase only: swept AABB against collider world bounds.
        // This is conservative and much cheaper than repeated mesh intersections.
        const intersectsSweep = this._sweptAabbBroadphase(prevPos, truck.mesh.position, radius, halfHeight, collider);
        if (collider.metadata?.truckColliderDebug) {
          console.debug(
            `[StaticBodyCollisionManager] collider check`,
            collider.name,
            { intersectsSweep, truckPos: truck.mesh.position.asArray?.() ?? truck.mesh.position, colliderMin: collider.getBoundingInfo().boundingBox.minimumWorld.asArray?.(), colliderMax: collider.getBoundingInfo().boundingBox.maximumWorld.asArray?.() }
          );
        }
        if (!intersectsSweep) continue;
        if (collider.metadata?.polylineCollider) {
          this._resolveTruckVsPolyline(truck, prevPos, collider, dt, frame);
        } else {
          this._resolveTruckVsMesh(truck, prevPos, collider, dt, frame);
        }
      }

      this._prevPositions.set(id, truck.mesh.position.clone());
    }
  }

  _cachePrevPositions(trucks) {
    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck?.mesh) continue;
      this._prevPositions.set(truck.mesh.uniqueId, truck.mesh.position.clone());
    }
  }

  _sweptAabbBroadphase(prevPos, curPos, radius, halfHeight, collider) {
    const minX = Math.min(prevPos.x, curPos.x) - radius;
    const minY = Math.min(prevPos.y, curPos.y) - halfHeight;
    const minZ = Math.min(prevPos.z, curPos.z) - radius;
    const maxX = Math.max(prevPos.x, curPos.x) + radius;
    const maxY = Math.max(prevPos.y, curPos.y) + halfHeight;
    const maxZ = Math.max(prevPos.z, curPos.z) + radius;

    const bb = collider.getBoundingInfo().boundingBox;
    const cMin = bb.minimumWorld;
    const cMax = bb.maximumWorld;

    return !(
      maxX < cMin.x || minX > cMax.x ||
      maxY < cMin.y || minY > cMax.y ||
      maxZ < cMin.z || minZ > cMax.z
    );
  }

  _resolveTruckVsMesh(truck, prevPos, mesh, dt, frame) {
    const world = mesh.computeWorldMatrix(true);
    world.invertToRef(this._invWorld);

    const curLocal = Vector3.TransformCoordinates(truck.mesh.position, this._invWorld);
    const prevLocal = Vector3.TransformCoordinates(prevPos, this._invWorld);

    const bb = mesh.getBoundingInfo().boundingBox;
    const min = bb.minimum;
    const max = bb.maximum;

    const halfHeight = truck.halfHeight ?? TRUCK_HALF_HEIGHT;

    // Inflate the collider by the truck's oriented half-extents projected onto
    // each collider axis (Minkowski sum), not by its circumradius. Using the
    // circumradius made a 1.5×3.0 truck collide as a 3.35×3.35 square, so
    // driving parallel to a wall "hit" it while still ~0.9 units clear.
    const { eX, eY, eZ, sx, sy, sz } = this._truckExtentsInColliderSpace(truck, world, halfHeight);

    const minX = min.x - eX / sx;
    const maxX = max.x + eX / sx;
    const minY = min.y - eY / sy;
    const maxY = max.y + eY / sy;
    const minZ = min.z - eZ / sz;
    const maxZ = max.z + eZ / sz;

    // Wall segments are long, thin boxes (length ≫ thickness) that overlap along
    // their length. When the truck slides alongside one, the cheapest penetration
    // exit is often along the LENGTH axis at a seam/end — which ejects the truck
    // down the wall and produces a normal pointing along its travel, faking a
    // "head-on" hit and triggering the bounce/steer-lock. For such elongated
    // colliders we treat the long horizontal axis as a glancing artifact: never
    // resolve or bounce along it, so the truck pops out the face and keeps sliding.
    const halfExtX = (maxX - minX) / 2;
    const halfExtZ = (maxZ - minZ) / 2;
    const longHorizAxis = halfExtX >= halfExtZ ? "x" : "z";
    const isElongated =
      Math.max(halfExtX, halfExtZ) >= 2 * Math.max(1e-6, Math.min(halfExtX, halfExtZ));

    // For bridge drive meshes, top-face support is provided by TerrainPhysics.
    // Ignore static-body resolution while the truck is on/above the top plane.
    if (mesh.metadata?.truckColliderIgnoreTop === true) {
      const TOP_EPS = 0.05;
      if (prevLocal.y >= maxY - TOP_EPS && curLocal.y >= maxY - TOP_EPS) {
        if (mesh.metadata?.truckColliderDebug) {
          console.debug(`[StaticBodyCollisionManager] ignore top skip`, mesh.name, {
            prevLocalY: prevLocal.y,
            curLocalY: curLocal.y,
            maxY,
          });
        }
        return;
      }
    }

    const inBox =
      curLocal.x >= minX && curLocal.x <= maxX &&
      curLocal.y >= minY && curLocal.y <= maxY &&
      curLocal.z >= minZ && curLocal.z <= maxZ;

    let axis = null;
    let sign = 1;

    // Prefer swept time-of-impact whenever possible so we keep the entry side
    // (critical for thin colliders: entering from below should not pop out top).
    const swept = this._sweptHitAABB(prevLocal, curLocal, minX, maxX, minY, maxY, minZ, maxZ);

    if (swept) {
      axis = swept.axis;
      sign = swept.sign;

      const dx = curLocal.x - prevLocal.x;
      const dy = curLocal.y - prevLocal.y;
      const dz = curLocal.z - prevLocal.z;
      curLocal.x = prevLocal.x + dx * swept.t;
      curLocal.y = prevLocal.y + dy * swept.t;
      curLocal.z = prevLocal.z + dz * swept.t;

      if (axis === "x") curLocal.x = sign < 0 ? minX - SKIN : maxX + SKIN;
      if (axis === "y") curLocal.y = sign < 0 ? minY - SKIN : maxY + SKIN;
      if (axis === "z") curLocal.z = sign < 0 ? minZ - SKIN : maxZ + SKIN;
    } else if (inBox) {
      const penToMinX = curLocal.x - minX;
      const penToMaxX = maxX - curLocal.x;
      const penToMinY = curLocal.y - minY;
      const penToMaxY = maxY - curLocal.y;
      const penToMinZ = curLocal.z - minZ;
      const penToMaxZ = maxZ - curLocal.z;

      let candidates = [
        { axis: "x", side: "min", pen: penToMinX },
        { axis: "x", side: "max", pen: penToMaxX },
        { axis: "y", side: "min", pen: penToMinY },
        { axis: "y", side: "max", pen: penToMaxY },
        { axis: "z", side: "min", pen: penToMinZ },
        { axis: "z", side: "max", pen: penToMaxZ },
      ];

      // Don't eject along a wall's length — resolve out the face (or top) instead.
      if (isElongated) candidates = candidates.filter(c => c.axis !== longHorizAxis);

      candidates.sort((a, b) => a.pen - b.pen);
      axis = candidates[0].axis;
      sign = candidates[0].side === "min" ? -1 : 1;

      if (axis === "x") curLocal.x = sign < 0 ? minX - SKIN : maxX + SKIN;
      if (axis === "y") curLocal.y = sign < 0 ? minY - SKIN : maxY + SKIN;
      if (axis === "z") curLocal.z = sign < 0 ? minZ - SKIN : maxZ + SKIN;
    } else {
      return;
    }

    const newWorld = Vector3.TransformCoordinates(curLocal, world);

    // Ceiling guard: if underside resolution would push the truck below the
    // currently resolved floor, keep it on the floor and block forward advance.
    // This prevents "bridge pushes truck into hill" tunneling on uphill approaches.
    if (axis === "y" && sign < 0) {
      const floorY = truck.terrainPhysics?.lastFloorY;
      if (Number.isFinite(floorY)) {
        const minCenterY = floorY + halfHeight + SKIN;
        if (newWorld.y < minCenterY) {
          newWorld.x = prevPos.x;
          newWorld.z = prevPos.z;
          newWorld.y = minCenterY;

          truck.state.velocity.x *= 0.2;
          truck.state.velocity.z *= 0.2;
          if (truck.state.velocity.y > 0) truck.state.velocity.y = 0;
        }
      }
    }

    truck.mesh.position.copyFrom(newWorld);

    if (mesh.metadata?.truckColliderDebug) {
      console.debug(`[StaticBodyCollisionManager] resolved collision`, mesh.name, {
        axis,
        sign,
        newWorld: newWorld.asArray?.() ?? newWorld,
        prevPos: prevPos.asArray?.() ?? prevPos,
        curPos: truck.mesh.position.asArray?.() ?? truck.mesh.position,
      });
    }

    const localNormal =
      axis === "x" ? new Vector3(sign, 0, 0) :
      axis === "y" ? new Vector3(0, sign, 0) :
      new Vector3(0, 0, sign);

    const worldNormal = Vector3.TransformNormal(localNormal, world).normalize();

    // A hit resolved along an elongated collider's long horizontal axis is a
    // seam/end artifact of sliding past a wall, not a real face impact — never
    // bounce off it, no matter how aligned the velocity looks.
    const glancingLengthHit = isElongated && axis === longHorizAxis;
    const applyFriction = mesh.metadata?.truckColliderApplyFriction !== false;
    this._applyContactResponse(truck, worldNormal, dt, frame, {
      allowBounce: !glancingLengthHit,
      retain: applyFriction
        ? (mesh.metadata?.truckColliderFriction ?? DEFAULT_FRICTION)
        : null,
    });
  }

  /**
   * Shared velocity response for a resolved contact: cancels the into-surface
   * component, bounces + locks controls on head-on hits, and scrubs the
   * along-surface component by `retain` (per-60fps-frame factor; null = none).
   */
  _applyContactResponse(truck, worldNormal, dt, frame, { allowBounce, retain }) {
    const vel = truck.state.velocity;
    const velDot = vel.x * worldNormal.x + vel.y * worldNormal.y + vel.z * worldNormal.z;
    if (velDot >= 0) return;

    // Check if collision is head-on (within ±30 degrees of perpendicular)
    const velMagnitude = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const isHeadOn = allowBounce && velMagnitude > 0 && Math.abs(velDot) / velMagnitude >= BOUNCE_ANGLE_THRESHOLD;

    // Apply bounce coefficient only on head-on collisions, otherwise use 1.0 (no bounce)
    const bounceCoeff = isHeadOn ? BOUNCE_COEFFICIENT : 1.0;
    vel.x -= worldNormal.x * velDot * bounceCoeff;
    vel.y -= worldNormal.y * velDot * bounceCoeff;
    vel.z -= worldNormal.z * velDot * bounceCoeff;

    // If head-on, suppress forward drive force AND steering for 500ms so neither
    // overrides the bounce — the truck rebounds straight back along the normal.
    if (isHeadOn && truck.state) {
      // Set cooldown timestamps; drive + steering logic check these and skip while active.
      truck.state.noDriveUntil = Date.now() + 500;
      truck.state.noSteerUntil = Date.now() + 500;
    }

    if (retain != null && !frame.frictionApplied && Math.abs(worldNormal.y) < 0.2) {
      // Scrub only the along-wall component — the into-wall component was just
      // resolved above, and scaling the whole vector killed forward speed while
      // merely grazing. Exponent makes the decay frame-rate independent.
      const scale = Math.pow(retain, Math.max(0, dt) * FRICTION_REF_FPS);
      const vn = vel.x * worldNormal.x + vel.y * worldNormal.y + vel.z * worldNormal.z;
      vel.x = worldNormal.x * vn + (vel.x - worldNormal.x * vn) * scale;
      vel.y = worldNormal.y * vn + (vel.y - worldNormal.y * vn) * scale;
      vel.z = worldNormal.z * vn + (vel.z - worldNormal.z * vn) * scale;
      frame.frictionApplied = true;
    }
  }

  /**
   * Analytic truck-vs-polyline-wall resolver (poly walls). The wall is treated
   * as its true shape — a thick centerline ribbon — instead of a chain of box
   * segments, so there are no internal seam/end faces to ghost-hit while
   * driving alongside it. The contact normal is always the real face normal
   * (perpendicular to the centerline), continuous along curves; open ends
   * resolve radially from the endpoint (rounded cap).
   *
   * Collider data (mesh.metadata.polylineCollider) comes from the same
   * resampled centerline as the visible ribbon:
   *   { xs, zs, topY, botY, halfThick, closed, retain }
   */
  _resolveTruckVsPolyline(truck, prevPos, mesh, dt, frame) {
    const c = mesh.metadata.polylineCollider;
    const xs = c.xs, zs = c.zs;
    const n = xs.length;
    if (n < 2) return;

    const pos = truck.mesh.position;
    const halfHeight = truck.halfHeight ?? TRUCK_HALF_HEIGHT;

    const hit = this._closestOnPolyline(xs, zs, c.closed, pos.x, pos.z);
    if (!hit) return;
    const { cx, cz, i, j, t } = hit;

    // Vertical gate: interpolated wall extents at the closest point.
    const top = c.topY[i] + (c.topY[j] - c.topY[i]) * t;
    const bot = c.botY[i] + (c.botY[j] - c.botY[i]) * t;
    const truckBot = pos.y - halfHeight;
    if (truckBot >= top || pos.y + halfHeight <= bot) return;

    // Outward direction from centerline to truck; if the truck center sits
    // exactly on the centerline, fall back to the segment's left normal.
    let dx = pos.x - cx, dz = pos.z - cz;
    const d = Math.hypot(dx, dz);
    const segLen = Math.hypot(xs[j] - xs[i], zs[j] - zs[i]) || 1;
    const lnx = -(zs[j] - zs[i]) / segLen; // segment left normal
    const lnz = (xs[j] - xs[i]) / segLen;
    if (d < 1e-6) {
      dx = lnx;
      dz = lnz;
    } else {
      dx /= d;
      dz /= d;
    }

    // Tunneling guard: did the truck cross to the other side since last frame?
    // Only meaningful when the closest point is interior to the polyline — at a
    // clamped open end the "side" is measured against the last segment's
    // extended line, and legitimately driving around the tip flips it.
    const atOpenEnd =
      !c.closed && ((i === 0 && t <= 0) || (j === n - 1 && t >= 1));
    const prevSide = Math.sign((prevPos.x - cx) * lnx + (prevPos.z - cz) * lnz);
    const curSide = Math.sign(dx * lnx + dz * lnz);
    const crossed =
      !atOpenEnd && prevSide !== 0 && curSide !== 0 && prevSide !== curSide;
    if (crossed) {
      // Resolve back to the side the truck came from.
      dx = lnx * prevSide;
      dz = lnz * prevSide;
    }

    const reach = c.halfThick + this._truckSupportXZ(truck, dx, dz);
    const penLateral = crossed ? reach + d : reach - d;
    if (penLateral <= 0) return;

    // Landing on top beats lateral ejection when it's the smaller correction
    // (preserves driving onto/along a wall top, as the old box chain allowed).
    const penTop = top - truckBot;
    if (!crossed && penTop < penLateral) {
      pos.y = top + halfHeight + SKIN;
      this._applyContactResponse(truck, new Vector3(0, 1, 0), dt, frame, {
        allowBounce: true,
        retain: null,
      });
      return;
    }

    pos.x = cx + dx * (reach + SKIN);
    pos.z = cz + dz * (reach + SKIN);
    this._applyContactResponse(truck, new Vector3(dx, 0, dz), dt, frame, {
      allowBounce: true,
      retain: c.retain ?? DEFAULT_FRICTION,
    });
  }

  /** Closest point on a (possibly closed) XZ polyline to (px, pz). */
  _closestOnPolyline(xs, zs, closed, px, pz) {
    const n = xs.length;
    const segCount = closed ? n : n - 1;
    let best = null;
    for (let i = 0; i < segCount; i++) {
      const j = (i + 1) % n;
      const abx = xs[j] - xs[i];
      const abz = zs[j] - zs[i];
      const lenSq = abx * abx + abz * abz;
      let t = lenSq > 1e-12 ? ((px - xs[i]) * abx + (pz - zs[i]) * abz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = xs[i] + abx * t;
      const cz = zs[i] + abz * t;
      const dSq = (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
      if (!best || dSq < best.distSq) best = { cx, cz, i, j, t, distSq: dSq };
    }
    return best;
  }

  /** Truck OBB half-extent projected onto a horizontal unit direction. */
  _truckSupportXZ(truck, nx, nz) {
    const halfDepth = (truck.depth ?? TRUCK_DEPTH) / 2;
    const halfWidth = (truck.width ?? TRUCK_WIDTH) / 2;
    const h = truck.state.heading;
    const fwdX = Math.sin(h), fwdZ = Math.cos(h);
    const rightX = Math.cos(h), rightZ = -Math.sin(h);
    return (
      halfDepth * Math.abs(fwdX * nx + fwdZ * nz) +
      halfWidth * Math.abs(rightX * nx + rightZ * nz)
    );
  }

  /**
   * Support function for the truck's oriented box against the collider's local
   * axes: how far the truck reaches along each of the collider's X/Y/Z axes.
   * Also returns each axis' world scale, taken from the world matrix so parented
   * colliders are handled as well as `mesh.scaling` ones.
   */
  _truckExtentsInColliderSpace(truck, world, halfHeight) {
    const halfDepth = (truck.depth ?? TRUCK_DEPTH) / 2;   // along truck forward
    const halfWidth = (truck.width ?? TRUCK_WIDTH) / 2;   // along truck right

    const h = truck.state.heading;
    const fwdX = Math.sin(h), fwdZ = Math.cos(h);
    const rightX = Math.cos(h), rightZ = -Math.sin(h);

    const m = world.m;
    const out = {};
    const keys = ["X", "Y", "Z"];
    for (let i = 0; i < 3; i++) {
      const ax = m[i * 4], ay = m[i * 4 + 1], az = m[i * 4 + 2];
      const scale = Math.max(1e-6, Math.hypot(ax, ay, az));
      const nx = ax / scale, ny = ay / scale, nz = az / scale;
      out["e" + keys[i]] =
        halfDepth * Math.abs(fwdX * nx + fwdZ * nz) +
        halfWidth * Math.abs(rightX * nx + rightZ * nz) +
        halfHeight * Math.abs(ny);
      out["s" + keys[i].toLowerCase()] = scale;
    }
    return out;
  }

  _sweptHitAABB(prev, cur, minX, maxX, minY, maxY, minZ, maxZ) {
    const d = {
      x: cur.x - prev.x,
      y: cur.y - prev.y,
      z: cur.z - prev.z,
    };

    let tEnter = 0;
    let tExit = 1;
    let hitAxis = null;
    let hitSign = 1;

    const axes = [
      ["x", minX, maxX],
      ["y", minY, maxY],
      ["z", minZ, maxZ],
    ];

    for (const [axis, min, max] of axes) {
      const p = prev[axis];
      const v = d[axis];

      if (Math.abs(v) < 1e-6) {
        if (p < min || p > max) return null;
        continue;
      }

      const t1 = (min - p) / v;
      const t2 = (max - p) / v;
      const enter = Math.min(t1, t2);
      const exit = Math.max(t1, t2);

      if (enter > tEnter) {
        tEnter = enter;
        hitAxis = axis;
        hitSign = t1 > t2 ? 1 : -1;
      }

      tExit = Math.min(tExit, exit);
      if (tEnter > tExit) return null;
    }

    if (tEnter < 0 || tEnter > 1 || !hitAxis) return null;
    return { t: tEnter, axis: hitAxis, sign: hitSign };
  }
}
