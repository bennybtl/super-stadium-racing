import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
  VertexData,
} from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";

/**
 * Bridge — runtime bridge deck mesh + static physics body.
 *
 * A bridge is a solid elevated platform vehicles can drive over or pass under.
 * It does not deform terrain; height is applied as a vertical offset above the
 * sampled terrain at the bridge center.
 */
export class Bridge {
  /**
   * @param {object} feature
   * @param {number} terrainY
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, terrainY, scene, shadows, driveSurfaceManager = null) {
    this.feature = feature;
    this.track = track;
    this.scene = scene;
    this._driveSurfaceManager = driveSurfaceManager;

    const thickness = feature.thickness ?? 0.4;
    const deckY = terrainY + (feature.height ?? 5) + thickness / 2;
    const deckTopY = deckY + thickness / 2;
    const angleY = ((feature.angle ?? 0) * Math.PI) / 180;

    const collision = feature.collision ?? {};
    const collisionEnabled = true;
    const width = feature.width ?? 20;
    const depth = feature.depth ?? 8;
    const driveColliderFriction = collision.friction ?? 1.0;
    const driveColliderApplyFriction = collision.applyFriction ?? false;
    // End-caps are an opt-in safety feature. Default off so bridges remain
    // passable from below unless explicitly configured per track.
    const endCapsEnabled = collision.endCaps === true;
    const endCapsOnDepth = collision.endCapsOnDepth ?? true;
    const endCapsOnWidth = collision.endCapsOnWidth ?? false;

    // Visible bridge deck. This mesh is also the collision body.
    this.mesh = MeshBuilder.CreateBox(
      `bridge_render_${feature.centerX}_${feature.centerZ}`,
      {
        width,
        height: thickness,
        depth,
      },
      scene
    );
    this.mesh.position = new Vector3(feature.centerX, deckY, feature.centerZ);
    this.mesh.rotation.y = angleY;
    this.mesh.isPickable = true;

    const collisionHeight = thickness;
    const collisionCenterY = deckY - thickness;

    this._collisionVolume = {
      x: feature.centerX,
      y: collisionEnabled ? collisionCenterY : this.mesh.position.y,
      z: feature.centerZ,
      heading: angleY,
      halfWidth: width / 2,
      halfHeight: collisionHeight / 2,
      halfDepth: depth / 2,
    };

    if (collisionEnabled) {
      this.colliderMesh = MeshBuilder.CreateBox(
        `bridge_collision_${feature.centerX}_${feature.centerZ}`,
        {
          width,
          height: collisionHeight,
          depth,
        },
        scene
      );
      this.colliderMesh.position = new Vector3(feature.centerX, collisionCenterY, feature.centerZ);
      this.colliderMesh.rotation.y = angleY;
      this.colliderMesh.isVisible = false;
      this.colliderMesh.isPickable = false;
      this.colliderMesh.metadata = {
        ...(this.colliderMesh.metadata ?? {}),
        truckCollider: true,
        truckColliderFriction: driveColliderFriction,
        truckColliderApplyFriction: driveColliderApplyFriction,
        truckColliderIgnoreTop: true,
      };
      this.colliderAggregate = new PhysicsAggregate(
        this.colliderMesh,
        PhysicsShapeType.BOX,
        { mass: 0 },
        scene
      );
    }

    const materialTypeName = feature.materialType ?? 'packed_dirt';
    const terrainType = Object.values(TERRAIN_TYPES).find(t => t.name === materialTypeName) || TERRAIN_TYPES.PACKED_DIRT;
    this._material = new StandardMaterial(
      `bridgeMat_${feature.centerX}_${feature.centerZ}`,
      scene
    );
    this._material.diffuseColor = terrainType.color ?? new Color3(0.52, 0.40, 0.22);
    this._material.specularColor = new Color3(
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13
    );
    this._material.backFaceCulling = false;
    this.mesh.material = this._material;

    this._ramps = [];
    this._rampColliders = [];
    this._rampColliderAggregates = [];

    const transitionEnabled = feature.transitionEnabled === true;
    const transitionDepth = feature.transitionDepth ?? 10;
    const rampWidth = width;

    const createRampMesh = (sign, startX, startZ, topY, bottomY) => {
      const depthLength = transitionDepth;
      const deltaY = bottomY - topY;
      const ramp = new Mesh(
        `bridge_ramp_${sign}_${feature.centerX}_${feature.centerZ}`,
        scene
      );

      const positions = [
        -rampWidth / 2, 0, 0,
         rampWidth / 2, 0, 0,
        -rampWidth / 2, deltaY, 0,
         rampWidth / 2, deltaY, 0,
        -rampWidth / 2, deltaY, depthLength,
         rampWidth / 2, deltaY, depthLength,
      ];

      const indices = [
        0, 1, 3, 0, 3, 2,
        0, 1, 5, 0, 5, 4,
        2, 3, 5, 2, 5, 4,
        0, 2, 4,
        1, 5, 3,
      ];

      const uvs = [
        0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0,
      ];

      const vd = new VertexData();
      vd.positions = positions;
      vd.indices = indices;
      vd.uvs = uvs;
      VertexData.ComputeNormals(positions, indices, vd.normals = []);
      vd.applyToMesh(ramp);
      ramp.convertToFlatShadedMesh();

      ramp.position = new Vector3(startX, topY, startZ);
      ramp.rotation.y = angleY + (sign === -1 ? Math.PI : 0);
      ramp.isPickable = true;
      ramp.receiveShadows = true;
      ramp.material = this._material;
      shadows?.addShadowCaster(ramp);

      return ramp;
    };

    const createRampColliderPerimeter = (sign, startX, startZ, topY, bottomY) => {
      const depthLength = transitionDepth;
      const rampHeight = Math.max(0.001, topY - bottomY);
      const halfDepth = depthLength / 2;
      const halfWidth = rampWidth / 2;
      const halfRampHeight = rampHeight / 2;
      const centerY = bottomY + halfRampHeight / 2;
      const rotY = angleY + (sign === -1 ? Math.PI : 0);
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const wallThickness = Math.min(0.5, rampWidth * 0.15);

      const makeCollider = (name, width, height, depth, localX, localZ, ignoreTop = false) => {
        const collider = MeshBuilder.CreateBox(
          name,
          { width, height, depth },
          scene
        );
        collider.position = new Vector3(
          startX + localX * cosY + localZ * sinY,
          centerY,
          startZ - localX * sinY + localZ * cosY,
        );
        collider.rotation.y = rotY;
        collider.isVisible = false;
        collider.isPickable = false;
        collider.metadata = {
          ...(collider.metadata ?? {}),
          truckCollider: true,
          truckColliderFriction: driveColliderFriction,
          truckColliderApplyFriction: driveColliderApplyFriction,
          truckColliderDebug: false,
          ...(ignoreTop ? { truckColliderIgnoreTop: true } : {}),
        };
        return collider;
      };

      const colliders = [];
      // Left and right vertical wall colliders.
      colliders.push(makeCollider(
        `bridge_ramp_collider_side_left_${sign}_${feature.centerX}_${feature.centerZ}`,
        wallThickness,
        halfRampHeight,
        depthLength - 2,
        -halfWidth + wallThickness,
        halfDepth,
        false
      ));
      colliders.push(makeCollider(
        `bridge_ramp_collider_side_right_${sign}_${feature.centerX}_${feature.centerZ}`,
        wallThickness,
        halfRampHeight,
        depthLength - 2,
        halfWidth - wallThickness,
        halfDepth,
        false
      ));
      return colliders;
    };

    if (transitionEnabled && transitionDepth > 0) {
      const rampOffsetX = Math.sin(angleY) * (depth / 2 + transitionDepth);
      const rampOffsetZ = Math.cos(angleY) * (depth / 2 + transitionDepth);
      const startOffsetX = Math.sin(angleY) * (depth / 2);
      const startOffsetZ = Math.cos(angleY) * (depth / 2);

      const createRamp = sign => {
        const startX = feature.centerX + startOffsetX * sign;
        const startZ = feature.centerZ + startOffsetZ * sign;
        const endX = feature.centerX + rampOffsetX * sign;
        const endZ = feature.centerZ + rampOffsetZ * sign;
        const groundY = this.track.getHeightAt(endX, endZ);
        const ramp = createRampMesh(sign, startX, startZ, deckTopY, groundY);
        const rampColliders = createRampColliderPerimeter(sign, startX, startZ, deckTopY - thickness, groundY - thickness);

        if (this._driveSurfaceManager) {
          this._driveSurfaceManager.register(ramp, {
            surfaceType: 'bridge',
            level: feature.level ?? 1,
          });
        } else {
          ramp.metadata = {
            ...(ramp.metadata ?? {}),
            isTerrain: true,
          };
        }

        this._ramps.push(ramp);
        for (const collider of rampColliders) {
          this._rampColliders.push(collider);
          this._rampColliderAggregates.push(new PhysicsAggregate(collider, PhysicsShapeType.BOX, { mass: 0 }, scene));
        }
      };

      createRamp(1);
      createRamp(-1);
    }

    // Optional end-cap blockers: thin vertical planes at each bridge end that
    // extend downward through terrain. These prevent uphill under-bridge
    // tunneling at the transition where floor/ceiling constraints conflict.
    this._endCaps = [];
    if (collisionEnabled && endCapsEnabled && (endCapsOnDepth || endCapsOnWidth)) {
      const endCapThickness = collision.endCapThickness ?? 1.2;
      const endCapDrop = collision.endCapDrop ?? Math.max(30, (feature.height ?? 5) + 24);
      const endCapPad = collision.endCapPad ?? 0.4;
      const endCapFriction = collision.endCapFriction ?? 1.0;
      const endCapApplyFriction = collision.endCapApplyFriction ?? false;
      const endCapSpanAtDepthEnds = width + endCapPad;
      const endCapSpanAtWidthSides = depth + endCapPad;

      const dirDepthX = Math.sin(angleY);      // local +Z axis
      const dirDepthZ = Math.cos(angleY);
      const dirWidthX = Math.cos(angleY);      // local +X axis
      const dirWidthZ = -Math.sin(angleY);
      const baseY = this.mesh.position.y - thickness / 2;
      const capCenterY = baseY - endCapDrop / 2;

      const createEndCap = (sign, axis) => {
        const isDepthCap = axis === "depth";
        const capWidth = isDepthCap ? endCapSpanAtDepthEnds : endCapThickness;
        const capDepth = isDepthCap ? endCapThickness : endCapSpanAtWidthSides;
        // Position caps so their thickness extends inward under the bridge
        // (flush with the outer edge), rather than protruding outward.
        const endOffset = isDepthCap
          ? depth / 2 - endCapThickness / 2
          : width / 2 - endCapThickness / 2;
        const dirX = isDepthCap ? dirDepthX : dirWidthX;
        const dirZ = isDepthCap ? dirDepthZ : dirWidthZ;

        const cap = MeshBuilder.CreateBox(
          `bridge_endcap_${axis}_${sign > 0 ? "pos" : "neg"}_${feature.centerX}_${feature.centerZ}`,
          {
            width: capWidth,
            height: endCapDrop,
            depth: capDepth,
          },
          scene
        );

        cap.position = new Vector3(
          this.mesh.position.x + dirX * endOffset * sign,
          capCenterY,
          this.mesh.position.z + dirZ * endOffset * sign,
        );
        cap.rotation.y = angleY;
        cap.isVisible = false;
        cap.isPickable = false;
        cap.metadata = {
          ...(cap.metadata ?? {}),
          truckCollider: true,
          truckColliderFriction: endCapFriction,
          truckColliderApplyFriction: endCapApplyFriction,
        };

        this._endCaps.push(cap);
      };

      if (endCapsOnDepth) {
        createEndCap(1, "depth");
        createEndCap(-1, "depth");
      }
      if (endCapsOnWidth) {
        createEndCap(1, "width");
        createEndCap(-1, "width");
      }
    }

    this.mesh.receiveShadows = true;
    shadows?.addShadowCaster(this.mesh);

    // Register bridge mesh as drivable surface for raycasts and future nav layers.
    if (this._driveSurfaceManager) {
      this._driveSurfaceManager.register(this.mesh, {
        surfaceType: "bridge",
        level: feature.level ?? 1,
      });
    } else {
      // Fallback path used by old call sites.
      this.mesh.metadata = {
        ...(this.mesh.metadata ?? {}),
        isTerrain: true,
      };
    }
  }

  getCollisionVolume() {
    if (!this._collisionVolume || !this.mesh) return null;

    this._collisionVolume.x = this.colliderMesh?.position.x ?? this.mesh.position.x;
    this._collisionVolume.y = this.colliderMesh?.position.y ?? this.mesh.position.y;
    this._collisionVolume.z = this.colliderMesh?.position.z ?? this.mesh.position.z;
    return this._collisionVolume;
  }

  dispose() {
    this._driveSurfaceManager?.unregisterByMesh(this.mesh);
    for (const ramp of this._ramps ?? []) {
      this._driveSurfaceManager?.unregisterByMesh(ramp);
      ramp.dispose();
    }
    this._ramps = [];
    for (const collider of this._rampColliders ?? []) collider.dispose();
    this._rampColliders = [];
    for (const agg of this._rampColliderAggregates ?? []) agg.dispose();
    this._rampColliderAggregates = [];
    this.colliderAggregate?.dispose();
    this.colliderMesh?.dispose();
    this._material?.dispose();
    for (const cap of this._endCaps ?? []) cap.dispose();
    this._endCaps = [];
    this.mesh?.dispose();
  }
}
