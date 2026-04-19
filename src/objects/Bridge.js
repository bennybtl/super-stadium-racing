import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
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
  constructor(feature, terrainY, scene, shadows, driveSurfaceManager = null) {
    this.feature = feature;
    this.scene = scene;
    this._driveSurfaceManager = driveSurfaceManager;

    const thickness = feature.thickness ?? 0.4;
    const deckY = terrainY + (feature.height ?? 5) + thickness / 2;
    const angleY = ((feature.angle ?? 0) * Math.PI) / 180;

    const collision = feature.collision ?? {};
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
    this.mesh.metadata = {
      ...(this.mesh.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: driveColliderFriction,
      truckColliderApplyFriction: driveColliderApplyFriction,
      // Top-of-deck contact is handled by TerrainPhysics floor sampling.
      // StaticBodyCollisionManager should only block underside/side penetration.
      truckColliderIgnoreTop: true,
    };

    this._collisionVolume = {
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z,
      heading: angleY,
      halfWidth: width / 2,
      halfHeight: thickness / 2,
      halfDepth: depth / 2,
    };

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
    this.mesh.material = this._material;

    // Optional end-cap blockers: thin vertical planes at each bridge end that
    // extend downward through terrain. These prevent uphill under-bridge
    // tunneling at the transition where floor/ceiling constraints conflict.
    this._endCaps = [];
    if (endCapsEnabled && (endCapsOnDepth || endCapsOnWidth)) {
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

    this.aggregate = new PhysicsAggregate(
      this.mesh,
      PhysicsShapeType.BOX,
      { mass: 0 },
      scene
    );
  }

  getCollisionVolume() {
    if (!this._collisionVolume || !this.mesh) return null;

    this._collisionVolume.x = this.mesh.position.x;
    this._collisionVolume.y = this.mesh.position.y;
    this._collisionVolume.z = this.mesh.position.z;
    return this._collisionVolume;
  }

  dispose() {
    this._driveSurfaceManager?.unregisterByMesh(this.mesh);
    this.aggregate?.dispose();
    this._material?.dispose();
    for (const cap of this._endCaps ?? []) cap.dispose();
    this._endCaps = [];
    this.mesh?.dispose();
  }
}
