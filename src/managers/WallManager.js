import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

/**
 * WallManager - Creates and manages race track walls (straight and curved).
 *
 * Walls are static physics bodies. Because trucks use PhysicsMotionType.ANIMATED,
 * the engine won't push them back automatically, so WallManager registers a
 * Babylon collision observable on each truck's physics body and manually cancels
 * the velocity component that drives into the wall.
 */
export class WallManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // All individual wall segment meshes (straight + curved arc segments)
    this.wallMeshes = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────

  createWalls() {
    for (const feature of this.track.features) {
      if (feature.type === "wall") {
        this.createStraightWall(feature);
      } else if (feature.type === "curvedWall") {
        this.createCurvedWall(feature);
      } else if (feature.type === "polyWall") {
        this.createPolyWall(feature);
      }
    }
  }

  createStraightWall(feature) {
    // Auto-calculate segments: ~one per 4 units of length, minimum 1
    const segments = feature.segments ?? Math.max(1, Math.round(feature.length / 4));
    const segLength = feature.length / segments;

    // Direction the wall runs along in world space (local X after rotation.y = heading)
    const dirX = Math.cos(feature.heading);
    const dirZ = -Math.sin(feature.heading);

    for (let i = 0; i < segments; i++) {
      const offset = -feature.length / 2 + (i + 0.5) * segLength;
      const px = feature.centerX + dirX * offset;
      const pz = feature.centerZ + dirZ * offset;
      const terrainHeight = this.track.getHeightAt(px, pz);

      const mesh = MeshBuilder.CreateBox("wall", {
        width: segLength * 1.02, // tiny overlap prevents gaps between segments
        height: feature.height,
        depth: feature.thickness,
      }, this.scene);

      mesh.position = new Vector3(px, terrainHeight + feature.height / 2, pz);
      mesh.rotation.y = feature.heading;

      // Store half-extents for per-frame collision checks
      mesh._wallHalfLength = (segLength * 1.02) / 2;
      mesh._wallHalfThick  = feature.thickness / 2;
      mesh._wallHeading    = feature.heading;
      mesh._wallFriction   = feature.friction ?? 0.1;

      this._applyWallMaterial(mesh);
      this._addPhysics(mesh);
      this.wallMeshes.push(mesh);
    }
  }

  createCurvedWall(feature) {
    const { centerX, centerZ, radius, startAngle, endAngle, height, segments, thickness } = feature;
    const arcSpan = endAngle - startAngle;
    const segmentAngle = arcSpan / segments;
    // Width of each segment — slightly overlapping to avoid gaps
    const segmentLength = 2 * radius * Math.sin(Math.abs(segmentAngle) / 2) * 1.05;

    for (let i = 0; i < segments; i++) {
      const midAngle = startAngle + (i + 0.5) * segmentAngle;

      // Position on the arc
      const px = centerX + Math.cos(midAngle) * radius;
      const pz = centerZ - Math.sin(midAngle) * radius; // negate sin so CCW matches world Z

      const terrainHeight = this.track.getHeightAt(px, pz);

      const mesh = MeshBuilder.CreateBox("wall_arc", {
        width: segmentLength,
        height,
        depth: thickness,
      }, this.scene);

      mesh.position = new Vector3(px, terrainHeight + height / 2, pz);
      // Segment faces outward from the arc centre — perpendicular to the radius
      mesh.rotation.y = midAngle + Math.PI / 2;

      // Store half-extents for per-frame collision checks
      mesh._wallHalfLength = (segmentLength * 1.05) / 2;
      mesh._wallHalfThick  = thickness / 2;
      mesh._wallHeading    = midAngle + Math.PI / 2;
      mesh._wallFriction   = feature.friction ?? 0.1;

      this._applyWallMaterial(mesh);
      this._addPhysics(mesh);
      this.wallMeshes.push(mesh);
    }
  }

  createPolyWall(feature) {
    const { points, height, thickness, friction } = feature;
    if (!points || points.length < 2) return;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];

      const dx     = p1.x - p0.x;
      const dz     = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      // heading: angle such that cos(h)=dx/len and -sin(h)=dz/len
      // matches the convention used by createStraightWall
      const heading = Math.atan2(-dz, dx);

      // Sub-segment so each piece is ~4 units long (terrain-following)
      const numSegs = Math.max(1, Math.round(length / 4));
      const segLen  = length / numSegs;
      const dirX    = dx / length;
      const dirZ    = dz / length;

      for (let s = 0; s < numSegs; s++) {
        const t  = (s + 0.5) * segLen;
        const px = p0.x + dirX * t;
        const pz = p0.z + dirZ * t;
        const terrainHeight = this.track.getHeightAt(px, pz);

        const mesh = MeshBuilder.CreateBox("wall_poly", {
          width:  segLen * 1.02,
          height,
          depth:  thickness,
        }, this.scene);

        mesh.position = new Vector3(px, terrainHeight + height / 2, pz);
        mesh.rotation.y = heading;

        mesh._wallHalfLength = (segLen * 1.02) / 2;
        mesh._wallHalfThick  = thickness / 2;
        mesh._wallHeading    = heading;
        mesh._wallFriction   = friction ?? 0.1;

        this._applyWallMaterial(mesh);
        this._addPhysics(mesh);
        this.wallMeshes.push(mesh);
      }
    }
  }

  // ─── Pre-frame velocity clamp (call BEFORE updateTruck) ────────────────

  /**
   * Predicts each truck's next position and cancels any velocity component
   * that would drive it into a wall. Call this BEFORE updateTruck() so that
   * grip/drift physics cannot re-inject wall-ward motion during the move step.
   */
  preUpdate(trucks, dt) {
    const TRUCK_RADIUS = 0.75;
    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;
      for (const seg of this.wallMeshes) {
        this._preClampVelocity(truck, seg, TRUCK_RADIUS, dt);
      }
    }
  }

  _preClampVelocity(truck, seg, truckRadius, dt) {
    const vel = truck.state.velocity;
    const pos = truck.mesh.position;
    const h    = seg._wallHeading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);

    const halfLen   = seg._wallHalfLength + truckRadius;
    const halfThick = seg._wallHalfThick  + truckRadius;

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
      const retain = 1 - seg._wallFriction;
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
    const TRUCK_RADIUS = 0.75; // half of truck width (1.5)
    if (!this._prevPositions) this._prevPositions = new Map();
    for (const truckData of trucks) {
      const truck = truckData.truck ?? truckData;
      if (!truck.mesh || !truck.state) continue;
      const id = truck.mesh.uniqueId;
      const pos = truck.mesh.position;
      const prevPos = this._prevPositions.get(id) ?? pos.clone();

      for (const seg of this.wallMeshes) {
        this._resolveCollision(truck, seg, TRUCK_RADIUS, prevPos);
      }

      // Record resolved position for next frame's swept test
      this._prevPositions.set(id, pos.clone());
    }
  }

  _resolveCollision(truck, seg, truckRadius, prevPos) {
    const pos  = truck.mesh.position;
    const h    = seg._wallHeading;
    const cosH = Math.cos(h);
    const sinH = Math.sin(h);

    const halfLen   = seg._wallHalfLength + truckRadius;
    const halfThick = seg._wallHalfThick  + truckRadius;

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
      const retain = 1 - seg._wallFriction;
      vel.x *= retain;
      vel.z *= retain;

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
      console.log(
        `[Wall] COLLISION HEADING SNAP` +
        ` | truckHeading=${deg(truckH)}` +
        ` | wallSegHeading=${deg(h)}` +
        ` | parallel0=${deg(wallParallel0)} (diff=${deg(diff0)})` +
        ` | parallel1=${deg(wallParallel1)} (diff=${deg(diff1)})` +
        ` | snappedTo=${deg(newHeading)}`
      );
    }

    // Push the truck back to the wall surface
    let correctionZ = 0;
    if (Math.abs(localZ) < halfThick) {
      correctionZ = signZ * halfThick - localZ;
      pos.x += sinH * correctionZ;
      pos.z += cosH * correctionZ;
    }

    // ── Debug logging (once per collision, throttled per segment) ─────────
    const now = performance.now();
    if (!seg._lastLogTime || now - seg._lastLogTime > 200) {
      seg._lastLogTime = now;
      const r = (v) => v.toFixed(3);
      console.log(
        `[Wall] ${collisionType} | wallH=${r(h * 180/Math.PI)}°` +
        ` | localX=${r(localX)} localZ=${r(localZ)} signZ=${signZ}` +
        ` | halfThick=±${r(halfThick)}` +
        ` | velBefore=(${r(velXBefore)}, ${r(velZBefore)}) dot=${r(velDotNormal)}` +
        ` | velAfter=(${r(vel.x)}, ${r(vel.z)})` +
        ` | cancelled=${didCancel} | correctionZ=${r(correctionZ)}`
      );
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this._disposeMeshes();
    this._prevPositions = new Map();
    this.createWalls();
  }

  dispose() {
    this._disposeMeshes();
  }

  // ─── AI Helpers ──────────────────────────────────────────────────────────

  /**
   * Returns an array of { x, z, halfLength, heading } descriptors for every
   * wall segment so AIDriver can mark those grid cells as blocked.
   */
  getWallSegments() {
    return this.wallMeshes.map(mesh => ({
      x: mesh.position.x,
      z: mesh.position.z,
      halfLength: mesh._wallHalfLength,
      halfDepth:  mesh._wallHalfThick,
      heading: mesh._wallHeading,
    }));
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  _applyWallMaterial(mesh) {
    const mat = new StandardMaterial("wallMat", this.scene);
    mat.diffuseColor = new Color3(0.55, 0.55, 0.55);
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mesh.material = mat;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
  }

  _addPhysics(mesh) {
    new PhysicsAggregate(mesh, PhysicsShapeType.BOX, {
      mass: 0,       // static — never moves
      restitution: 0.2,
      friction: 0.8,
    }, this.scene);
  }

  _disposeMeshes() {
    for (const mesh of this.wallMeshes) {
      if (mesh.physicsBody) mesh.physicsBody.dispose();
      mesh.dispose();
    }
    this.wallMeshes = [];
  }
}
