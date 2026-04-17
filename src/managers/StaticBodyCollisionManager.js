import { Matrix, Vector3 } from "@babylonjs/core";
import { TRUCK_HALF_HEIGHT, TRUCK_RADIUS } from "../constants.js";

const SKIN = 0.03;
const DEFAULT_FRICTION = 0.92;

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

  resetColliderCache() {
    this._colliders = [];
  }

  _getColliders() {
    if (this._colliders.length === 0) {
      this._colliders = this.scene.meshes.filter(mesh =>
        mesh?.metadata?.truckCollider === true &&
        !mesh.isDisposed() &&
        mesh.isEnabled()
      );
    }
    return this._colliders;
  }

  update(trucks) {
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

      for (const collider of colliders) {
        // Broad-phase only: swept AABB against collider world bounds.
        // This is conservative and much cheaper than repeated mesh intersections.
        const intersectsSweep = this._sweptAabbBroadphase(prevPos, truck.mesh.position, radius, halfHeight, collider);
        if (!intersectsSweep) continue;
        this._resolveTruckVsMesh(truck, prevPos, collider);
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

  _resolveTruckVsMesh(truck, prevPos, mesh) {
    const world = mesh.computeWorldMatrix(true);
    world.invertToRef(this._invWorld);

    const curLocal = Vector3.TransformCoordinates(truck.mesh.position, this._invWorld);
    const prevLocal = Vector3.TransformCoordinates(prevPos, this._invWorld);

    const bb = mesh.getBoundingInfo().boundingBox;
    const min = bb.minimum;
    const max = bb.maximum;

    const sx = Math.max(1e-6, Math.abs(mesh.scaling.x));
    const sy = Math.max(1e-6, Math.abs(mesh.scaling.y));
    const sz = Math.max(1e-6, Math.abs(mesh.scaling.z));

    const radius = truck.radius ?? TRUCK_RADIUS;
    const halfHeight = truck.halfHeight ?? TRUCK_HALF_HEIGHT;

    // Inflate collider in local space by truck extents.
    const minX = min.x - radius / sx;
    const maxX = max.x + radius / sx;
    const minY = min.y - halfHeight / sy;
    const maxY = max.y + halfHeight / sy;
    const minZ = min.z - radius / sz;
    const maxZ = max.z + radius / sz;

    // For bridge drive meshes, top-face support is provided by TerrainPhysics.
    // Ignore static-body resolution while the truck is on/above the top plane.
    if (mesh.metadata?.truckColliderIgnoreTop === true) {
      const TOP_EPS = 0.05;
      if (prevLocal.y >= maxY - TOP_EPS && curLocal.y >= maxY - TOP_EPS) {
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

      const candidates = [
        { axis: "x", side: "min", pen: penToMinX },
        { axis: "x", side: "max", pen: penToMaxX },
        { axis: "y", side: "min", pen: penToMinY },
        { axis: "y", side: "max", pen: penToMaxY },
        { axis: "z", side: "min", pen: penToMinZ },
        { axis: "z", side: "max", pen: penToMaxZ },
      ];

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
          if (truck.state.verticalVelocity > 0) truck.state.verticalVelocity = 0;
        }
      }
    }

    truck.mesh.position.copyFrom(newWorld);

    const localNormal =
      axis === "x" ? new Vector3(sign, 0, 0) :
      axis === "y" ? new Vector3(0, sign, 0) :
      new Vector3(0, 0, sign);

    const worldNormal = Vector3.TransformNormal(localNormal, world).normalize();

    const vel = truck.state.velocity;
    const velDot = vel.x * worldNormal.x + truck.state.verticalVelocity * worldNormal.y + vel.z * worldNormal.z;
    if (velDot < 0) {
      vel.x -= worldNormal.x * velDot;
      vel.z -= worldNormal.z * velDot;
      truck.state.verticalVelocity -= worldNormal.y * velDot;

      const applyFriction = mesh.metadata?.truckColliderApplyFriction !== false;
      if (applyFriction && Math.abs(worldNormal.y) < 0.2) {
        const friction = mesh.metadata?.truckColliderFriction ?? DEFAULT_FRICTION;
        vel.scaleInPlace(friction);
      }
    }
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
