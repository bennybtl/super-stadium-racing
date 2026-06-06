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
   * @param {object} feature — Bridge feature config (centerX, centerZ, height, width, depth, angle, thickness, etc.)
   * @param {object} track — Track instance with getHeightAt() method
   * @param {number} terrainY — Terrain height at bridge center
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   * @param {object} driveSurfaceManager — Optional drive surface registration manager
   * @param {object} surfaceTopologyGraph — Optional connectivity graph for layered surfaces
   */
  constructor(feature, track, terrainY, scene, shadows, driveSurfaceManager = null, surfaceTopologyGraph = null) {
    this.feature = feature;
    this.track = track;
    this.scene = scene;
    this._driveSurfaceManager = driveSurfaceManager;
    this._surfaceTopologyGraph = surfaceTopologyGraph;

    const thickness = feature.thickness ?? 0.4;
    const deckY = terrainY + (feature.height ?? 5) + thickness / 2;
    const deckTopY = deckY + thickness / 2;
    const angleY = ((feature.angle ?? 0) * Math.PI) / 180;

    const collision = feature.collision ?? {};
    const width = feature.width ?? 20;
    const depth = feature.depth ?? 8;
    const transitionEnabled = feature.transitionEnabled === true;
    const transitionDepth = feature.transitionDepth ?? 10;
    const transitionYOffset = Math.min(0, feature.transitionYOffset ?? 0);
    const surfaceLevel = feature.level ?? 1;
    const bridgeSurfaceKey = feature.id ?? `${feature.centerX}_${feature.centerZ}`;
    const deckColliderEnabled = collision.deckCollider ?? !transitionEnabled;
    const driveColliderFriction = collision.friction ?? 1.0;
    const driveColliderApplyFriction = collision.applyFriction ?? false;
    // End-caps use fixed editor/runtime defaults (no longer user-configurable).
    const endCapsEnabled = true;
    const endCapsOnDepth = true;
    const endCapsOnWidth = false;

    // Visible bridge deck mesh.
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

    const rampJoinInset = transitionEnabled
      ? Math.min(Math.max(0.8, thickness * 2), Math.max(0, depth / 2 - 0.25))
      : 0;
    const collisionDepth = Math.max(0.5, depth - rampJoinInset * 2);
    const collisionHeight = thickness;
    const collisionCenterY = deckY - thickness;

    this._collisionVolume = {
      x: feature.centerX,
      y: deckColliderEnabled ? collisionCenterY : this.mesh.position.y,
      z: feature.centerZ,
      heading: angleY,
      halfWidth: width / 2,
      halfHeight: deckColliderEnabled ? collisionHeight / 2 : thickness / 2,
      halfDepth: deckColliderEnabled ? collisionDepth / 2 : depth / 2,
    };

    if (deckColliderEnabled) {
      this.colliderMesh = MeshBuilder.CreateBox(
        `bridge_collision_${feature.centerX}_${feature.centerZ}`,
        {
          width,
          height: collisionHeight,
          depth: collisionDepth,
        },
        scene
      );
      this.colliderMesh.position = new Vector3(feature.centerX, collisionCenterY, feature.centerZ);
      this.colliderMesh.rotation.y = angleY;
      this.colliderMesh.isVisible = false;
      this.colliderMesh.isPickable = false;
      this.colliderMesh.metadata = this._createTruckColliderMetadata(
        driveColliderFriction,
        driveColliderApplyFriction,
        true // ignoreTop
      );
      this._driveSurfaceManager?.registerBoundary?.(this.colliderMesh, {
        surfaceType: "bridgeBoundary",
        level: feature.level ?? 1,
        tags: {
          surfaceKind: "bridge-deck-boundary",
          bridgeSurfaceKey: feature.id ?? `${feature.centerX}_${feature.centerZ}`,
        },
      });
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
    this._rampDriveSurfaces = [];
    this._rampDriveSurfaceIds = [];
    this._deckDriveSurface = null;
    this._deckDriveSurfaceId = null;
    this._topologyOwner = {};
    this._rampColliders = [];
    this._rampColliderAggregates = [];
    const driveProxyThickness = 0.12;

    const createDeckDriveSurface = () => {
      const drive = MeshBuilder.CreateBox(
        `bridge_drive_deck_${feature.centerX}_${feature.centerZ}`,
        {
          width,
          height: driveProxyThickness,
          depth,
        },
        scene
      );
      drive.position = new Vector3(
        feature.centerX,
        deckTopY - driveProxyThickness / 2,
        feature.centerZ
      );
      drive.rotation.y = angleY;
      drive.isVisible = true;
      drive.visibility = 0;
      drive.isPickable = true;
      drive.receiveShadows = false;
      return drive;
    };

    const registerTopologyNode = (mesh, kind, tags = {}) => {
      return this._surfaceTopologyGraph?.registerNode?.(this._topologyOwner, {
        mesh,
        layerId: surfaceLevel,
        role: 'drive',
        kind,
        tags: {
          bridgeSurfaceKey,
          ...tags,
        },
      }) ?? null;
    };

    const registerTopologyConnector = (fromNodeId, toNodeId, type, tags = {}, oneWay = false) => {
      return this._surfaceTopologyGraph?.registerConnector?.(this._topologyOwner, {
        fromNodeId,
        toNodeId,
        type,
        oneWay,
        tags: {
          bridgeSurfaceKey,
          ...tags,
        },
      }) ?? null;
    };

    const createRampDriveSurface = (sign, startX, startZ, topY, bottomY) => {
      const depthLength = transitionDepth;
      const slopeDown = Math.max(0, topY - bottomY);
      const pitch = Math.atan2(slopeDown, depthLength);
      const rotY = angleY + (sign === -1 ? Math.PI : 0);
      const dirX = Math.sin(rotY);
      const dirZ = Math.cos(rotY);
      const midX = startX + dirX * (depthLength / 2);
      const midZ = startZ + dirZ * (depthLength / 2);
      const drive = MeshBuilder.CreateBox(
        `bridge_drive_ramp_${sign}_${feature.centerX}_${feature.centerZ}`,
        {
          width,
          height: driveProxyThickness,
          depth: depthLength,
        },
        scene
      );
      drive.position = new Vector3(midX, (topY + bottomY) / 2, midZ);
      drive.rotation.y = rotY;
      drive.rotation.x = pitch;
      drive.isVisible = true;
      drive.visibility = 0;
      drive.isPickable = true;
      drive.receiveShadows = false;
      return drive;
    };

    const createRampMesh = (sign, startX, startZ, topY, bottomY) => {
      const depthLength = transitionDepth;
      const deltaY = bottomY - topY;
      const ramp = new Mesh(
        `bridge_ramp_${sign}_${feature.centerX}_${feature.centerZ}`,
        scene
      );

      const positions = [
        -width / 2, 0, 0,
         width / 2, 0, 0,
        -width / 2, deltaY, 0,
         width / 2, deltaY, 0,
        -width / 2, deltaY, depthLength,
         width / 2, deltaY, depthLength,
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
      const halfWidth = width / 2;
      const centerY = bottomY + rampHeight / 2;
      const rotY = angleY + (sign === -1 ? Math.PI : 0);
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const wallThickness = Math.min(0.5, width * 0.15);

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
          ...this._createTruckColliderMetadata(
            driveColliderFriction,
            driveColliderApplyFriction,
            ignoreTop
          ),
          truckColliderDebug: false,
        };
        return collider;
      };

      const colliders = [];
      // Left and right vertical wall colliders (inset by wallThickness to create guide rails).
      colliders.push(makeCollider(
        `bridge_ramp_collider_side_left_${sign}_${feature.centerX}_${feature.centerZ}`,
        wallThickness,
        rampHeight,
        depthLength - 2,
        -halfWidth + wallThickness,
        halfDepth,
        false
      ));
      colliders.push(makeCollider(
        `bridge_ramp_collider_side_right_${sign}_${feature.centerX}_${feature.centerZ}`,
        wallThickness,
        rampHeight,
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
        const rampBottomY = groundY + transitionYOffset;
        const ramp = createRampMesh(sign, startX, startZ, deckTopY, rampBottomY);
        const rampDrive = createRampDriveSurface(sign, startX, startZ, deckTopY, rampBottomY);
        const rampColliders = createRampColliderPerimeter(sign, startX, startZ, deckTopY, rampBottomY);
        const rampDriveSurfaceId = registerTopologyNode(rampDrive, 'bridge-ramp', {
          rampSign: sign,
          transitionEnabled,
        });

        if (this._driveSurfaceManager) {
          this._driveSurfaceManager.register(rampDrive, {
            surfaceType: 'bridgeRamp',
            level: surfaceLevel,
            tags: {
              surfaceKind: 'bridge-ramp',
              bridgeSurfaceKey,
              rampSign: sign,
              transitionEnabled,
            },
          });
        } else {
          rampDrive.metadata = {
            ...(rampDrive.metadata ?? {}),
            isTerrain: true,
            isDriveSurface: true,
            surfaceType: 'bridgeRamp',
            level: surfaceLevel,
            surfaceKind: 'bridge-ramp',
          };
        }

        this._ramps.push(ramp);
        this._rampDriveSurfaces.push(rampDrive);
        this._rampDriveSurfaceIds.push(rampDriveSurfaceId);
        for (const collider of rampColliders) {
          this._driveSurfaceManager?.registerBoundary?.(collider, {
            surfaceType: "bridgeBoundary",
            level: surfaceLevel,
            tags: {
              surfaceKind: "bridge-ramp-boundary",
              bridgeSurfaceKey,
              rampSign: sign,
            },
          });
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
    this._endCapAggregates = [];
    if (endCapsEnabled && (endCapsOnDepth || endCapsOnWidth)) {
      const endCapThickness = 0.5;
      const endCapHeight = 1;
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

        const capX = this.mesh.position.x + dirX * endOffset * sign;
        const capZ = this.mesh.position.z + dirZ * endOffset * sign;
        const terrainY = this.track.getHeightAt(capX, capZ);
        const capCenterY = terrainY + endCapHeight / 2;

        const cap = MeshBuilder.CreateBox(
          `bridge_endcap_${axis}_${sign > 0 ? "pos" : "neg"}_${feature.centerX}_${feature.centerZ}`,
          {
            width: capWidth,
            height: endCapHeight,
            depth: capDepth,
          },
          scene
        );

        cap.position = new Vector3(
          capX,
          capCenterY,
          capZ,
        );
        cap.rotation.y = angleY;
        cap.isVisible = false;
        cap.isPickable = false;
        cap.metadata = this._createTruckColliderMetadata(
          endCapFriction,
          endCapApplyFriction,
          false // ignoreTop
        );

        this._driveSurfaceManager?.registerBoundary?.(cap, {
          surfaceType: "bridgeBoundary",
          level: surfaceLevel,
          tags: {
            surfaceKind: "bridge-endcap-boundary",
            bridgeSurfaceKey,
            capAxis: axis,
          },
        });

        this._endCaps.push(cap);
        this._endCapAggregates.push(new PhysicsAggregate(cap, PhysicsShapeType.BOX, { mass: 0 }, scene));
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

    this._deckDriveSurface = createDeckDriveSurface();
    this._deckDriveSurfaceId = registerTopologyNode(this._deckDriveSurface, 'bridge-deck', {
      transitionEnabled,
    });

    // Register bridge mesh as drivable surface for raycasts and future nav layers.
    if (this._driveSurfaceManager) {
      this._driveSurfaceManager.register(this._deckDriveSurface, {
        surfaceType: "bridgeDeck",
        level: surfaceLevel,
        tags: {
          surfaceKind: "bridge-deck",
          bridgeSurfaceKey,
          transitionEnabled,
        },
      });
    } else {
      // Fallback path used by old call sites.
      this._deckDriveSurface.metadata = {
        ...(this._deckDriveSurface.metadata ?? {}),
        isTerrain: true,
        isDriveSurface: true,
        surfaceType: "bridgeDeck",
        level: surfaceLevel,
        surfaceKind: "bridge-deck",
      };
    }
    for (let i = 0; i < this._rampDriveSurfaceIds.length; i++) {
      const rampNodeId = this._rampDriveSurfaceIds[i];
      if (!Number.isFinite(rampNodeId) || !Number.isFinite(this._deckDriveSurfaceId)) continue;
      const sign = i === 0 ? 1 : -1;
      registerTopologyConnector(rampNodeId, this._deckDriveSurfaceId, 'DeckJoin', {
        rampSign: sign,
        direction: 'up',
      });
      registerTopologyConnector(this._deckDriveSurfaceId, rampNodeId, 'DeckJoin', {
        rampSign: sign,
        direction: 'down',
      });
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
    this._surfaceTopologyGraph?.removeByOwner?.(this._topologyOwner);
    this._driveSurfaceManager?.unregisterByMesh(this._deckDriveSurface);
    this._deckDriveSurface?.dispose();
    this._deckDriveSurface = null;
    this._deckDriveSurfaceId = null;
    for (const drive of this._rampDriveSurfaces ?? []) {
      this._driveSurfaceManager?.unregisterByMesh(drive);
      drive.dispose();
    }
    this._rampDriveSurfaces = [];
    this._rampDriveSurfaceIds = [];
    for (const ramp of this._ramps ?? []) {
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
    for (const agg of this._endCapAggregates ?? []) agg.dispose();
    this._endCapAggregates = [];
    this.mesh?.dispose();
  }

  /**
   * Create truck collider metadata with optional ignoreTop flag.
   * @private
   */
  _createTruckColliderMetadata(friction, applyFriction, ignoreTop = false) {
    const metadata = {
      ...(this.mesh?.metadata ?? {}),
      truckCollider: true,
      truckColliderFriction: friction,
      truckColliderApplyFriction: applyFriction,
    };
    if (ignoreTop) {
      metadata.truckColliderIgnoreTop = true;
    }
    return metadata;
  }
}
