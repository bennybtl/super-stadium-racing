import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

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

    // Optional collision proxy overrides. When omitted, collision follows the
    // same dimensions as the visible bridge (backward-compatible behavior).
    const collision = feature.collision ?? {};
    const collisionWidth = collision.width ?? feature.width ?? 20;
    const collisionDepth = collision.depth ?? feature.depth ?? 8;
    const collisionThickness = collision.thickness ?? thickness;
    const collisionYOffset = collision.yOffset ?? 0;
    const driveColliderFriction = collision.friction ?? 1.0;
    const driveColliderApplyFriction = collision.applyFriction ?? false;
    // End-caps are an opt-in safety feature. Default off so bridges remain
    // passable from below unless explicitly configured per track.
    const endCapsEnabled = collision.endCaps === true;
    const endCapsOnDepth = collision.endCapsOnDepth ?? true;
    const endCapsOnWidth = collision.endCapsOnWidth ?? false;

    // Visible deck mesh (render only).
    this.mesh = MeshBuilder.CreateBox(
      `bridge_render_${feature.centerX}_${feature.centerZ}`,
      {
        width: feature.width ?? 20,
        height: thickness,
        depth: feature.depth ?? 8,
      },
      scene
    );
    this.mesh.position = new Vector3(feature.centerX, deckY, feature.centerZ);
    this.mesh.rotation.y = angleY;

    // Drivable/collision proxy mesh (physics + raycast surface).
    this.driveMesh = MeshBuilder.CreateBox(
      `bridge_drive_${feature.centerX}_${feature.centerZ}`,
      {
        width: collisionWidth,
        height: collisionThickness,
        depth: collisionDepth,
      },
      scene
    );
    this.driveMesh.position = new Vector3(
      feature.centerX,
      deckY + collisionYOffset,
      feature.centerZ
    );
    this.driveMesh.rotation.y = angleY;
    this.driveMesh.isVisible = false;
    this.driveMesh.metadata = {
      ...(this.driveMesh.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: driveColliderFriction,
      truckColliderApplyFriction: driveColliderApplyFriction,
      // Top-of-deck contact is handled by TerrainPhysics floor sampling.
      // StaticBodyCollisionManager should only block underside/side penetration.
      truckColliderIgnoreTop: true,
    };

    this._collisionVolume = {
      x: this.driveMesh.position.x,
      y: this.driveMesh.position.y,
      z: this.driveMesh.position.z,
      heading: angleY,
      halfWidth: collisionWidth / 2,
      halfHeight: collisionThickness / 2,
      halfDepth: collisionDepth / 2,
    };

    // Ensure the proxy participates in TerrainQuery raycasts.
    this.driveMesh.isPickable = true;

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
      // Backward-compat: endCapWidth controls span for depth-end caps.
      const endCapSpanDepth = (collision.endCapSpanDepth ?? collision.endCapWidth ?? collisionWidth) + endCapPad;
      const endCapSpanWidth = (collision.endCapSpanWidth ?? collision.endCapDepth ?? collisionDepth) + endCapPad;

      const dirDepthX = Math.sin(angleY);      // local +Z axis
      const dirDepthZ = Math.cos(angleY);
      const dirWidthX = Math.cos(angleY);      // local +X axis
      const dirWidthZ = -Math.sin(angleY);
      const baseY = this.driveMesh.position.y - collisionThickness / 2;
      const capCenterY = baseY - endCapDrop / 2;

      const createEndCap = (sign, axis) => {
        const isDepthCap = axis === "depth";
        const capWidth = isDepthCap ? endCapSpanDepth : endCapThickness;
        const capDepth = isDepthCap ? endCapThickness : endCapSpanWidth;
        // Position caps so their thickness extends inward under the bridge
        // (flush with the outer edge), rather than protruding outward.
        const endOffset = isDepthCap
          ? collisionDepth / 2 - endCapThickness / 2
          : collisionWidth / 2 - endCapThickness / 2;
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
          this.driveMesh.position.x + dirX * endOffset * sign,
          capCenterY,
          this.driveMesh.position.z + dirZ * endOffset * sign,
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

    this._material = new StandardMaterial(
      `bridgeMat_${feature.centerX}_${feature.centerZ}`,
      scene
    );
    this._material.diffuseColor = new Color3(0.52, 0.40, 0.22);
    this._material.specularColor = new Color3(0.1, 0.1, 0.1);
    this.mesh.material = this._material;

    this.mesh.receiveShadows = true;
    shadows?.addShadowCaster(this.mesh);

    // Register proxy as drivable surface for raycasts and future nav layers.
    if (this._driveSurfaceManager) {
      this._driveSurfaceManager.register(this.driveMesh, {
        surfaceType: "bridge",
        level: feature.level ?? 1,
      });
    } else {
      // Fallback path used by old call sites.
      this.driveMesh.metadata = {
        ...(this.driveMesh.metadata ?? {}),
        isTerrain: true,
      };
    }

    this.aggregate = new PhysicsAggregate(
      this.driveMesh,
      PhysicsShapeType.BOX,
      { mass: 0 },
      scene
    );
  }

  getCollisionVolume() {
    if (!this._collisionVolume || !this.driveMesh) return null;

    this._collisionVolume.x = this.driveMesh.position.x;
    this._collisionVolume.y = this.driveMesh.position.y;
    this._collisionVolume.z = this.driveMesh.position.z;
    return this._collisionVolume;
  }

  dispose() {
    this._driveSurfaceManager?.unregisterByMesh(this.driveMesh);
    this.aggregate?.dispose();
    this._material?.dispose();
    for (const cap of this._endCaps ?? []) cap.dispose();
    this._endCaps = [];
    this.driveMesh?.dispose();
    this.mesh?.dispose();
  }
}
