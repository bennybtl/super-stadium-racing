import { Mesh, VertexData, StandardMaterial, MultiMaterial, SubMesh, Color3, PhysicsAggregate, PhysicsShapeType, Texture } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../world/terrain.js";
import { _lerp, _clamp } from "../world/terrain-utils.js";
import { resolveSurfaceTexture, surfaceTextureUrl } from "../world/surface-textures.js";

const _bridgeTextureModules = import.meta.glob('../assets/textures/*', { eager: true, query: '?url', import: 'default' });
const _bridgeNormalModules = import.meta.glob('../assets/normals/*', { eager: true, query: '?url', import: 'default' });

const _bridgeTextureUrls = {};
for (const [path, url] of Object.entries(_bridgeTextureModules)) {
  const relativePath = path.replace('../assets/', '');
  const filename = path.split('/').at(-1);
  _bridgeTextureUrls[relativePath] = url;
  _bridgeTextureUrls[filename] = url;
}

const _bridgeNormalUrls = {};
for (const [path, url] of Object.entries(_bridgeNormalModules)) {
  const relativePath = path.replace('../assets/', '');
  const filename = path.split('/').at(-1);
  _bridgeNormalUrls[relativePath] = url;
  _bridgeNormalUrls[filename] = url;
}

function _resolveBridgeAssetUrl(pathOrName, map) {
  if (!pathOrName || typeof pathOrName !== 'string') return null;
  return map[pathOrName] ?? map[pathOrName.split('/').at(-1)] ?? null;
}

/**
 * A usable hex color, or null for "use the terrain look" — and also null for a
 * 'tex:*' value, which the texture path handles instead. Accepts the literal
 * 'terrain' so panels can carry one value for every case.
 */
function _resolveFlatColor(value) {
  if (typeof value !== 'string') return null;
  if (!value || value === 'terrain') return null;
  if (resolveSurfaceTexture(value)) return null;
  return value;
}

function _lerpColor(colorA, colorB, t) {
  return new Color3(
    _lerp(colorA.r, colorB.r, t),
    _lerp(colorA.g, colorB.g, t),
    _lerp(colorA.b, colorB.b, t)
  );
}

const DRIVE_COLLIDER_OVERLAP = 0.35;

// The slab's underside is pulled up to sit just below the terrain wherever it
// would otherwise sink beneath it (a tilted "drive box" ramp, or a slab flat on
// grade). The terrain is not a shadow occluder, so any caster geometry below
// the surface is still lit in the shadow map and throws a phantom shadow back
// toward the key light. An elevated bridge keeps its full nominal thickness.
const BRIDGE_UNDERGRADE_EMBED = 0.3;
const BRIDGE_MIN_SLAB = 0.1; // never thin the slab below this (keeps it solid)
const TERRAIN_SEAM_MIN_LENGTH = 0.75;
const TERRAIN_SEAM_MAX_LENGTH = 3.0;
const TERRAIN_SEAM_SLOPE_LENGTH_SCALE = 1.5;

/**
 * BridgeMesh — a drivable elevated surface defined by a grid of control points
 * with absolute world-Y heights, similar to the terrain meshGrid feature but
 * with a solid top + bottom + sides and proper drive-surface registration.
 *
 * Feature format:
 *   {
 *     type:         'bridgeMesh',
 *     centerX:      number,
 *     centerZ:      number,
 *     width:        number,        // total width (X axis)
 *     depth:        number,        // total depth (Z axis)
 *     cols:         number,        // control-point columns (≥ 2)
 *     rows:         number,        // control-point rows    (≥ 2)
 *     heights:      number[],      // absolute world Y, row-major (rows × cols)
 *     rotation:     number,        // yaw in degrees
 *     thickness:    number,        // vertical thickness of the slab
 *     layerId:      number,        // surface layer id (default 1)
 *     level:        number,        // legacy alias for layerId
 *   }
 *
 * The top face is registered as a drive surface so TerrainQuery raycasts land
 * directly on it at the correct height and slope — no separate proxy needed.
 */
export class BridgeMesh {
  constructor(feature, track, scene, shadows = null, driveSurfaceManager = null, terrainBlendConfig = null) {
    this.feature = feature;
    this._track = track;
    this._scene = scene;
    this._driveSurfaceManager = driveSurfaceManager;
    this._surfaceTopologyGraph = scene?.metadata?.surfaceTopologyGraph ?? null;
    this._terrainSeamMeshes = [];
    this._terrainSeamPhysics = [];

    const {
      centerX, centerZ,
      cols, rows,
      width, depth,
      heights,
      offsetsX, offsetsZ,
      smoothing = 0,
      rotation = 0,
      thickness = 0.4,
      level = 1,
      layerId = level,
    } = feature;
    const resolvedLayerId = Number.isFinite(layerId) ? layerId : 1;
    const safeHeights = Array.isArray(heights) ? heights : new Array(cols * rows).fill(0);
    const safeOffsetsX = Array.isArray(offsetsX) ? offsetsX : null;
    const safeOffsetsZ = Array.isArray(offsetsZ) ? offsetsZ : null;

    // Geometry grid: when smoothing is on, densify the control grid and blend
    // toward a Catmull-Rom bicubic surface (same maths as the terrain meshGrid
    // feature's `smoothing`). The visual slab AND the drive/physics mesh are both
    // built from this so the truck sits on exactly what's drawn.
    const geo = _resampleGridForGeometry({
      cols, rows,
      heights: safeHeights,
      offsetsX: safeOffsetsX,
      offsetsZ: safeOffsetsZ,
      smoothing,
    });
    const connectorEndpoints = _buildAutoBridgeMeshConnectorEndpoints({
      track,
      centerX,
      centerZ,
      cols,
      rows,
      width,
      depth,
      heights: safeHeights,
      rotation,
    });

    const bridgeMeshKey = `${centerX}_${centerZ}`;
    this._bridgeMeshKey = bridgeMeshKey;
    this._resolvedLayerId = resolvedLayerId;
    this._geometryState = {
      centerX,
      centerZ,
      cols,
      rows,
      width,
      depth,
      heights: safeHeights,
      offsetsX: safeOffsetsX,
      offsetsZ: safeOffsetsZ,
      rotation,
    };

    const terrainType = TERRAIN_TYPES.PACKED_DIRT;
    const terrainColor = terrainType.color ?? new Color3(0.52, 0.40, 0.22);
    const webglVersion = scene?.getEngine?.()?.webGLVersion ?? 2;
    const hasTerrainBlendResources =
      webglVersion >= 2 &&
      typeof terrainBlendConfig?.pluginClass === 'function' &&
      typeof terrainBlendConfig?.resolveTerrainTypeIndex === 'function' &&
      !!terrainBlendConfig?.terrainIdTexture &&
      !!terrainBlendConfig?.terrainPropertyTexture &&
      !!terrainBlendConfig?.terrainWaterOverlayTexture &&
      !!terrainBlendConfig?.terrainWearOverlayTexture &&
      !!terrainBlendConfig?.terrainDetailTexture &&
      Number.isFinite(terrainBlendConfig?.terrainTypeCount) &&
      Number.isFinite(terrainBlendConfig?.terrainCellCount) &&
      Number.isFinite(terrainBlendConfig?.terrainWorldHalfWidth) &&
      Number.isFinite(terrainBlendConfig?.terrainWorldHalfDepth);

    // ── Material ─────────────────────────────────────────────────────────────
    // A hex color or a 'tex:*' surface texture opts out of the terrain look
    // entirely: plain diffuse, no blend plugin, no terrain textures, no normal
    // map. `feature.color` styles the top face, `feature.sideColor` the sides +
    // bottom (absent = same material as the top).
    const textureWorldTile = Math.max(1, terrainType.diffuseTextureWorldUnitsPerTile ?? 24);
    const diffuseTilesU = Math.max(0.01, width / textureWorldTile);
    const diffuseTilesV = Math.max(0.01, depth / textureWorldTile);

    const createSurfaceMaterial = (name, styleValue) => {
      const colorHex = _resolveFlatColor(styleValue);
      const surfaceTexture = resolveSurfaceTexture(styleValue);
      const material = new StandardMaterial(name, scene);
      material.diffuseColor = terrainColor;
      material.specularColor = new Color3(
        terrainType.specular ?? 0.13,
        terrainType.specular ?? 0.13,
        terrainType.specular ?? 0.13
      );
      if (surfaceTexture) {
        const surfaceUrl = surfaceTextureUrl(styleValue);
        const surfaceTile = Math.max(1, surfaceTexture.worldUnitsPerTile ?? 12);
        if (surfaceUrl) {
          const surfaceDiffuse = new Texture(surfaceUrl, scene, true, false);
          surfaceDiffuse.uScale = Math.max(0.01, width / surfaceTile);
          surfaceDiffuse.vScale = Math.max(0.01, depth / surfaceTile);
          material.diffuseTexture = surfaceDiffuse;
          material.diffuseColor = Color3.White();
        }
        const surfaceSpecular = surfaceTexture.specular ?? 0.12;
        material.specularColor = new Color3(surfaceSpecular, surfaceSpecular, surfaceSpecular);
      } else if (colorHex) {
        material.diffuseColor = Color3.FromHexString(colorHex);
      } else if (hasTerrainBlendResources) {
        new terrainBlendConfig.pluginClass(
          material,
          terrainBlendConfig.terrainIdTexture,
          terrainBlendConfig.terrainPropertyTexture,
          terrainBlendConfig.terrainWaterOverlayTexture,
          // Deck-only wear: the racing line's wear where it's ON a deck, not the
          // ground-level wear of paths passing underneath (that's what the main
          // terrainWearOverlay would print through). See terrain-utils' bake.
          terrainBlendConfig.terrainDeckWearOverlayTexture
            ?? terrainBlendConfig.terrainWearOverlayTexture,
          terrainBlendConfig.terrainDetailTexture,
          terrainBlendConfig.terrainTypeCount,
          terrainBlendConfig.terrainCellCount,
          terrainBlendConfig.terrainWorldHalfWidth,
          terrainBlendConfig.terrainWorldHalfDepth,
          {
            forcedTerrainTypeIndex: -1,
            detailNormalTexture: terrainBlendConfig.terrainDetailNormalTexture,
          }
        );
        material.diffuseColor = Color3.White();
        material.specularColor = Color3.White();
        material.specularPower = 48;
      } else {
        const diffuseUrl = _resolveBridgeAssetUrl(terrainType.diffuseTexture, _bridgeTextureUrls);
        if (diffuseUrl) {
          const diffuseTexture = new Texture(diffuseUrl, scene, true, false);
          diffuseTexture.uScale = diffuseTilesU;
          diffuseTexture.vScale = diffuseTilesV;
          material.diffuseTexture = diffuseTexture;
          // StandardMaterial multiplies texture by diffuseColor. Approximate
          // texture-opacity blending by tinting toward white as texture influence
          // increases, without darkening the whole surface.
          const textureInfluence = _clamp(terrainType.diffuseTextureOpacity ?? 1, 0, 1);
          material.diffuseColor = _lerpColor(terrainColor, Color3.White(), textureInfluence);
        }
      }

      const normalUrl = (colorHex || surfaceTexture)
        ? null
        : _resolveBridgeAssetUrl(terrainType.normalMap, _bridgeNormalUrls);
      if (normalUrl) {
        const bumpTexture = new Texture(normalUrl, scene, true, false);
        bumpTexture.uScale = diffuseTilesU;
        bumpTexture.vScale = diffuseTilesV;
        material.bumpTexture = bumpTexture;
        material.bumpTexture.level = (terrainType.normalMapIntensity ?? 1) * 0.6;
      }
      // The slab is a closed, outward-wound solid (_buildSolidVD), so cull back
      // faces — a double-sided caster drops a second, offset shadow under the
      // single point light.
      material.backFaceCulling = true;
      return material;
    };

    this._material = createSurfaceMaterial(`bmMat_${centerX}_${centerZ}`, feature.color);
    // Only build a second material when the sides are styled independently —
    // otherwise the whole slab stays a single-material, single-submesh mesh.
    this._sideMaterial = feature.sideColor === undefined || feature.sideColor === null
      ? null
      : createSurfaceMaterial(`bmSideMat_${centerX}_${centerZ}`, feature.sideColor);

    // ── Visual mesh (top + bottom + sides) ───────────────────────────────────
    this._mesh = new Mesh(`bridge_mesh_${centerX}_${centerZ}`, scene);
    const solidVD = _buildSolidVD(centerX, centerZ, geo.cols, geo.rows, width, depth, geo.heights, thickness, rotation, geo.offsetsX, geo.offsetsZ, track);
    solidVD.applyToMesh(this._mesh);
    if (this._sideMaterial) {
      // _buildSolidVD emits the top face first, then bottom + the four sides.
      const topIndexCount = Math.max(0, (geo.rows - 1) * (geo.cols - 1) * 6);
      const vertexCount = solidVD.positions.length / 3;
      this._multiMaterial = new MultiMaterial(`bmMulti_${centerX}_${centerZ}`, scene);
      this._multiMaterial.subMaterials = [this._material, this._sideMaterial];
      this._mesh.material = this._multiMaterial;
      this._mesh.subMeshes = [];
      new SubMesh(0, 0, vertexCount, 0, topIndexCount, this._mesh);
      new SubMesh(1, 0, vertexCount, topIndexCount, solidVD.indices.length - topIndexCount, this._mesh);
    } else {
      this._mesh.material = this._material;
    }
    this._mesh.isPickable = false;
    // Surface decals resolve their projection target with a downward ray for
    // `surfaceDecalTarget` meshes, so a decal stamped over the deck lands on it.
    this._mesh.metadata = { ...(this._mesh.metadata ?? {}), surfaceDecalTarget: true };
    // Casts onto the ground, but does NOT receive — the same tradeoff the terrain
    // makes (see SceneBuilder, "the ground receives shadows but is NOT a caster").
    // The shadow generator is a blurred exponential cube map on the one stadium
    // light that carries most of the illumination, so a large flat face that both
    // casts and receives sits in its own blurred shadow and loses that light,
    // rendering markedly darker than the identically-materialed terrain beside it.
    //
    // An inset shadow-caster proxy was tried to win back deck shadows and does
    // not work: ESM fades the shadow over `depthScale` (50) units of NORMALIZED
    // depth, so escaping it needs a separation of several percent of the light's
    // whole range — metres, not centimetres — which no longer reads as the deck's
    // own shadow. Selective per-receiver exclusion would be needed instead.
    this._mesh.receiveShadows = false;
    shadows?.addShadowCaster(this._mesh);

    // ── Drive surface mesh (top face only, invisible but pickable) ───────────
    // This is what TerrainQuery raycasts onto. Its vertex heights exactly match
    // the visual top surface so normal computation and floor-Y are correct.
    this._driveMesh = new Mesh(`bridge_mesh_drive_${centerX}_${centerZ}`, scene);
    const driveVD = _buildTopFaceVD(
      centerX,
      centerZ,
      geo.cols,
      geo.rows,
      width,
      depth,
      geo.heights,
      rotation,
      DRIVE_COLLIDER_OVERLAP,
      geo.offsetsX,
      geo.offsetsZ
    );
    driveVD.applyToMesh(this._driveMesh);
    this._driveMesh.isVisible = true;
    this._driveMesh.visibility = 0;
    this._driveMesh.isPickable = true;
    this._driveMesh.receiveShadows = false;
    this._driveMeshPhysics = new PhysicsAggregate(this._driveMesh, PhysicsShapeType.MESH, { mass: 0 }, scene);

    let deckSurfaceId = null;
    if (driveSurfaceManager) {
      deckSurfaceId = driveSurfaceManager.register(this._driveMesh, {
        surfaceType: 'bridgeMesh',
        level: resolvedLayerId,
        tags: {
          surfaceKind: 'bridge-mesh',
          surfaceFace: 'top',
          normalFilterMode: 'absoluteY',
          bridgeMeshKey,
        },
      });
    }

    this._registerTopologyGraph({
      bridgeMeshKey,
      level: resolvedLayerId,
      deckSurfaceId,
      connectorEndpoints,
      centerX,
      centerZ,
      cols,
      rows,
      width,
      depth,
      heights: safeHeights,
      rotation,
    });
  }

  updateTerrainSeamSurfaces(sides = []) {
    this._disposeTerrainSeamSurfaces();

    const uniqueSides = [...new Set((Array.isArray(sides) ? sides : []).filter(side =>
      side === 'north' || side === 'south' || side === 'east' || side === 'west'
    ))];
    if (uniqueSides.length === 0 || !this._track || !this._scene) return;

    for (const side of uniqueSides) {
      const seamVD = _buildTerrainSeamVD({
        track: this._track,
        ...this._geometryState,
        side,
      });
      if (!seamVD) continue;

      const seamMesh = new Mesh(`bridge_mesh_seam_${this._bridgeMeshKey}_${side}`, this._scene);
      seamVD.applyToMesh(seamMesh);
      seamMesh.isVisible = true;
      seamMesh.visibility = 0;
      seamMesh.isPickable = true;
      seamMesh.receiveShadows = false;

      const seamPhysics = new PhysicsAggregate(seamMesh, PhysicsShapeType.MESH, { mass: 0 }, this._scene);
      this._terrainSeamMeshes.push(seamMesh);
      this._terrainSeamPhysics.push(seamPhysics);

      if (this._driveSurfaceManager) {
        this._driveSurfaceManager.register(seamMesh, {
          surfaceType: 'bridgeMeshSeam',
          level: this._resolvedLayerId,
          tags: {
            surfaceKind: 'bridge-mesh-seam',
            surfaceFace: 'top',
            normalFilterMode: 'absoluteY',
            bridgeMeshKey: this._bridgeMeshKey,
            seamSide: side,
          },
        });
      }
    }
  }

  _disposeTerrainSeamSurfaces() {
    for (const mesh of this._terrainSeamMeshes) {
      this._driveSurfaceManager?.unregisterByMesh?.(mesh);
      mesh?.dispose?.();
    }
    for (const aggregate of this._terrainSeamPhysics) {
      aggregate?.dispose?.();
    }
    this._terrainSeamMeshes = [];
    this._terrainSeamPhysics = [];
  }

  _registerTopologyGraph({
    bridgeMeshKey,
    level,
    deckSurfaceId,
    connectorEndpoints,
    centerX,
    centerZ,
    cols,
    rows,
    width,
    depth,
    heights,
    rotation,
  }) {
    if (!this._surfaceTopologyGraph) return;

    const resolvedDeckSurfaceId = deckSurfaceId ?? this._driveMesh?.metadata?.surfaceId ?? null;
    const deckNodeId = this._surfaceTopologyGraph.registerNode(this, {
      mesh: this._driveMesh,
      surfaceId: resolvedDeckSurfaceId,
      layerId: level,
      role: 'drive',
      kind: 'bridge-mesh-deck',
      tags: {
        bridgeMeshKey,
      },
    });

    if (!Number.isFinite(deckNodeId)) return;

    for (let index = 0; index < (connectorEndpoints?.length ?? 0); index++) {
      const endpoint = connectorEndpoints[index];
      const endpointWorld = _computeBridgeMeshEndpointWorldPosition({
        centerX,
        centerZ,
        cols,
        rows,
        width,
        depth,
        heights,
        rotation,
        side: endpoint.side,
        offset: endpoint.offset,
      });

      const endpointNodeId = this._surfaceTopologyGraph.registerNode(this, {
        mesh: null,
        surfaceId: null,
        layerId: level,
        role: 'drive',
        kind: 'bridge-mesh-connector-endpoint',
        connectorType: 'DeckJoin',
        tags: {
          bridgeMeshKey,
          endpointIndex: index,
          endpointSide: endpoint.side,
          endpointOffset: endpoint.offset,
          targetLayerId: endpoint.targetLayerId,
          endpointAutoTerrainDy: endpoint.autoTerrainDy,
          endpointWorldX: endpointWorld.x,
          endpointWorldY: endpointWorld.y,
          endpointWorldZ: endpointWorld.z,
        },
      });

      if (!Number.isFinite(endpointNodeId)) continue;

      this._surfaceTopologyGraph.registerConnector(this, {
        fromNodeId: deckNodeId,
        toNodeId: endpointNodeId,
        fromSurfaceId: resolvedDeckSurfaceId,
        toSurfaceId: null,
        type: 'DeckJoin',
        oneWay: true,
        tags: {
          bridgeMeshKey,
          endpointIndex: index,
          direction: 'deck-to-endpoint',
        },
      });

      this._surfaceTopologyGraph.registerConnector(this, {
        fromNodeId: endpointNodeId,
        toNodeId: deckNodeId,
        fromSurfaceId: null,
        toSurfaceId: resolvedDeckSurfaceId,
        type: 'DeckJoin',
        oneWay: true,
        tags: {
          bridgeMeshKey,
          endpointIndex: index,
          direction: 'endpoint-to-deck',
        },
      });
    }
  }

  dispose() {
    this._disposeTerrainSeamSurfaces();
    this._surfaceTopologyGraph?.removeByOwner?.(this);
    this._driveSurfaceManager?.unregisterByMesh?.(this._driveMesh);
    this._driveMeshPhysics?.dispose?.();
    this._driveMeshPhysics = null;
    this._driveMesh?.dispose();
    this._driveMesh = null;
    this._mesh?.dispose();
    this._mesh = null;
    this._multiMaterial?.dispose();
    this._multiMaterial = null;
    this._material?.dispose();
    this._material = null;
    this._sideMaterial?.dispose();
    this._sideMaterial = null;
  }
}

function _buildAutoBridgeMeshConnectorEndpoints({
  track,
  centerX,
  centerZ,
  cols,
  rows,
  width,
  depth,
  heights,
  rotation,
}) {
  const candidateSides = ['north', 'south', 'east', 'west'];
  const candidates = candidateSides.map(side => {
    const endpointWorld = _computeBridgeMeshEndpointWorldPosition({
      centerX,
      centerZ,
      cols,
      rows,
      width,
      depth,
      heights,
      rotation,
      side,
      offset: 0,
    });

    const terrainY = track?.getHeightAt?.(endpointWorld.x, endpointWorld.z);
    const dy = Number.isFinite(terrainY)
      ? Math.abs(endpointWorld.y - terrainY)
      : Infinity;

    return {
      enabled: true,
      side,
      offset: 0,
      targetLayerId: 0,
      autoTerrainDy: dy,
    };
  });

  candidates.sort((a, b) => a.autoTerrainDy - b.autoTerrainDy);
  return candidates.slice(0, 2);
}

function _computeBridgeMeshEndpointWorldPosition({
  centerX,
  centerZ,
  cols,
  rows,
  width,
  depth,
  heights,
  rotation,
  side,
  offset,
}) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const safeOffset = Number.isFinite(offset) ? Math.max(-1, Math.min(1, offset)) : 0;

  let localX = 0;
  let localZ = 0;
  switch (side) {
    case 'south':
      localX = safeOffset * halfW;
      localZ = halfD;
      break;
    case 'east':
      localX = halfW;
      localZ = safeOffset * halfD;
      break;
    case 'west':
      localX = -halfW;
      localZ = safeOffset * halfD;
      break;
    case 'north':
    default:
      localX = safeOffset * halfW;
      localZ = -halfD;
      break;
  }

  const rotated = _rotateVector(localX, localZ, rotation);
  return {
    x: centerX + rotated.x,
    y: _sampleBridgeHeightAtLocal({ cols, rows, width, depth, heights, localX, localZ }),
    z: centerZ + rotated.z,
  };
}

function _sampleBridgeHeightAtLocal({ cols, rows, width, depth, heights, localX, localZ }) {
  if (!Array.isArray(heights) || heights.length === 0) return 0;

  const maxCol = Math.max(0, cols - 1);
  const maxRow = Math.max(0, rows - 1);
  const u = width > 0 ? Math.max(0, Math.min(1, (localX + width / 2) / width)) : 0;
  const v = depth > 0 ? Math.max(0, Math.min(1, (localZ + depth / 2) / depth)) : 0;
  const col = u * maxCol;
  const row = v * maxRow;

  const c0 = Math.max(0, Math.min(Math.floor(col), maxCol));
  const r0 = Math.max(0, Math.min(Math.floor(row), maxRow));
  const c1 = Math.max(0, Math.min(c0 + 1, maxCol));
  const r1 = Math.max(0, Math.min(r0 + 1, maxRow));
  const tc = col - c0;
  const tr = row - r0;

  const h00 = heights[r0 * cols + c0] ?? 0;
  const h10 = heights[r0 * cols + c1] ?? h00;
  const h01 = heights[r1 * cols + c0] ?? h00;
  const h11 = heights[r1 * cols + c1] ?? h10;

  return (
    h00 * (1 - tc) * (1 - tr) +
    h10 * tc * (1 - tr) +
    h01 * (1 - tc) * tr +
    h11 * tc * tr
  );
}

// ── Private mesh-building helpers ─────────────────────────────────────────────

// How many sub-cells each control-grid cell is split into when smoothing > 0.
// Kept modest: the drive mesh is a Havok MESH collider raycast every frame and
// is excluded from the picking octree (see AGENT.md §3b), so tessellation is a
// direct per-ray triangle cost.
const _SMOOTH_SUBDIV = 3;

/**
 * Catmull-Rom 1D — interpolates p1→p2 with tangents from the neighbours. Passes
 * through every control point, so smoothing rounds the surface *between* handles
 * without pulling it off the heights the user set. Mirrors Track.getHeightAt's
 * meshGrid `smoothing` maths.
 */
function _catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * When `smoothing` is 0 (or the grid is degenerate) return the control grid
 * untouched. Otherwise densify it `_SMOOTH_SUBDIV`× per axis and blend each new
 * vertex's height from the raw bilinear value toward a bicubic Catmull-Rom
 * surface by `smoothing`. Per-point X/Z offsets are carried across by plain
 * bilinear interpolation so a warped quad stays warped.
 */
function _resampleGridForGeometry({ cols, rows, heights, offsetsX, offsetsZ, smoothing }) {
  const s = Math.max(0, Math.min(1, smoothing ?? 0));
  if (s <= 0 || cols < 2 || rows < 2) {
    return { cols, rows, heights, offsetsX, offsetsZ };
  }

  const sub = _SMOOTH_SUBDIV;
  const nCols = (cols - 1) * sub + 1;
  const nRows = (rows - 1) * sub + 1;

  const H = (r, c) => heights[
    Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
  ] ?? 0;
  const sampleOffset = (arr, r, c) => arr?.[
    Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
  ] ?? 0;

  const outH = new Array(nCols * nRows);
  const outX = offsetsX ? new Array(nCols * nRows).fill(0) : null;
  const outZ = offsetsZ ? new Array(nCols * nRows).fill(0) : null;

  for (let r = 0; r < nRows; r++) {
    const gr = r / sub;
    const r0 = Math.max(0, Math.min(Math.floor(gr), rows - 2));
    const tr = gr - r0;
    for (let c = 0; c < nCols; c++) {
      const gc = c / sub;
      const c0 = Math.max(0, Math.min(Math.floor(gc), cols - 2));
      const tc = gc - c0;

      const bilinear =
        H(r0, c0)     * (1 - tc) * (1 - tr) +
        H(r0, c0 + 1) *      tc  * (1 - tr) +
        H(r0 + 1, c0) * (1 - tc) *      tr  +
        H(r0 + 1, c0 + 1) *  tc  *      tr;

      const row0 = _catmullRom(H(r0 - 1, c0 - 1), H(r0 - 1, c0), H(r0 - 1, c0 + 1), H(r0 - 1, c0 + 2), tc);
      const row1 = _catmullRom(H(r0,     c0 - 1), H(r0,     c0), H(r0,     c0 + 1), H(r0,     c0 + 2), tc);
      const row2 = _catmullRom(H(r0 + 1, c0 - 1), H(r0 + 1, c0), H(r0 + 1, c0 + 1), H(r0 + 1, c0 + 2), tc);
      const row3 = _catmullRom(H(r0 + 2, c0 - 1), H(r0 + 2, c0), H(r0 + 2, c0 + 1), H(r0 + 2, c0 + 2), tc);
      const bicubic = _catmullRom(row0, row1, row2, row3, tr);

      const idx = r * nCols + c;
      outH[idx] = bilinear + (bicubic - bilinear) * s;

      if (outX) {
        outX[idx] =
          sampleOffset(offsetsX, r0, c0)         * (1 - tc) * (1 - tr) +
          sampleOffset(offsetsX, r0, c0 + 1)     *      tc  * (1 - tr) +
          sampleOffset(offsetsX, r0 + 1, c0)     * (1 - tc) *      tr  +
          sampleOffset(offsetsX, r0 + 1, c0 + 1) *      tc  *      tr;
      }
      if (outZ) {
        outZ[idx] =
          sampleOffset(offsetsZ, r0, c0)         * (1 - tc) * (1 - tr) +
          sampleOffset(offsetsZ, r0, c0 + 1)     *      tc  * (1 - tr) +
          sampleOffset(offsetsZ, r0 + 1, c0)     * (1 - tc) *      tr  +
          sampleOffset(offsetsZ, r0 + 1, c0 + 1) *      tc  *      tr;
      }
    }
  }

  return { cols: nCols, rows: nRows, heights: outH, offsetsX: outX, offsetsZ: outZ };
}

function _rotateVector(x, z, rotationDeg = 0) {
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - z * sin,
    z: x * sin + z * cos,
  };
}

function _gridPoints(centerX, centerZ, cols, rows, width, depth, rotationDeg = 0, offsetsX = null, offsetsZ = null) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const stepX = cols > 1 ? width / (cols - 1) : 0;
  const stepZ = rows > 1 ? depth / (rows - 1) : 0;
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const localX = -halfW + c * stepX + (offsetsX?.[idx] ?? 0);
      const localZ = -halfD + r * stepZ + (offsetsZ?.[idx] ?? 0);
      const rotated = _rotateVector(localX, localZ, rotationDeg);
      points.push({
        x: centerX + rotated.x,
        z: centerZ + rotated.z,
      });
    }
  }
  return points;
}

/**
 * Build VertexData for the top face only.
 * Winding is chosen so ComputeNormals produces upward-facing normals.
 */
function _buildTopFaceVD(centerX, centerZ, cols, rows, width, depth, heights, rotation = 0, overlap = 0, offsetsX = null, offsetsZ = null) {
  const safeOverlap = Math.max(0, overlap);
  const expandedWidth = width + safeOverlap * 2;
  const expandedDepth = depth + safeOverlap * 2;
  const grid = _gridPoints(centerX, centerZ, cols, rows, expandedWidth, expandedDepth, rotation, offsetsX, offsetsZ);

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = grid[r * cols + c];
      positions.push(p.x, heights[r * cols + c] ?? 0, p.z);
      uvs.push(c / Math.max(cols - 1, 1), r / Math.max(rows - 1, 1));
    }
  }

  // Winding chosen so the top face normal points upward.
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v0 = r * cols + c;
      const v1 = r * cols + c + 1;
      const v2 = (r + 1) * cols + c + 1;
      const v3 = (r + 1) * cols + c;
      indices.push(v0, v1, v2);
      indices.push(v0, v2, v3);
    }
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  return vd;
}

function _buildTerrainSeamVD({
  track,
  centerX,
  centerZ,
  cols,
  rows,
  width,
  depth,
  heights,
  offsetsX = null,
  offsetsZ = null,
  rotation = 0,
  side,
}) {
  const edgePoints = _getBridgeEdgePoints({
    centerX,
    centerZ,
    cols,
    rows,
    width,
    depth,
    heights,
    offsetsX,
    offsetsZ,
    rotation,
    side,
  });
  if (!edgePoints || edgePoints.length < 2) return null;

  const avgDelta = edgePoints.reduce((sum, point) => {
    const terrainY = track?.getHeightAt?.(point.x, point.z);
    return sum + Math.abs(point.y - (Number.isFinite(terrainY) ? terrainY : point.y));
  }, 0) / edgePoints.length;
  const seamLength = Math.max(
    TERRAIN_SEAM_MIN_LENGTH,
    Math.min(TERRAIN_SEAM_MAX_LENGTH, avgDelta * TERRAIN_SEAM_SLOPE_LENGTH_SCALE + DRIVE_COLLIDER_OVERLAP)
  );

  const outward = _getBridgeSideOutwardNormal(side, rotation);
  const outerPoints = edgePoints.map(point => {
    const x = point.x + outward.x * seamLength;
    const z = point.z + outward.z * seamLength;
    const terrainY = track?.getHeightAt?.(x, z);
    return {
      x,
      y: Number.isFinite(terrainY) ? terrainY : point.y,
      z,
    };
  });

  const positions = [];
  const uvs = [];
  const indices = [];
  const segmentCount = edgePoints.length - 1;
  if (segmentCount < 1) return null;

  for (let index = 0; index < edgePoints.length; index++) {
    const inner = edgePoints[index];
    const outer = outerPoints[index];
    const u = segmentCount > 0 ? index / segmentCount : 0;
    positions.push(inner.x, inner.y, inner.z);
    uvs.push(u, 0);
    positions.push(outer.x, outer.y, outer.z);
    uvs.push(u, 1);
  }

  for (let index = 0; index < segmentCount; index++) {
    const v0 = index * 2;
    const v1 = v0 + 1;
    const v2 = v0 + 3;
    const v3 = v0 + 2;
    indices.push(v0, v1, v2);
    indices.push(v0, v2, v3);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  return vd;
}

function _getBridgeEdgePoints({
  centerX,
  centerZ,
  cols,
  rows,
  width,
  depth,
  heights,
  offsetsX = null,
  offsetsZ = null,
  rotation,
  side,
}) {
  const grid = _gridPoints(centerX, centerZ, cols, rows, width, depth, rotation, offsetsX, offsetsZ);
  const points = [];

  if (side === 'north') {
    for (let c = 0; c < cols; c++) {
      const index = c;
      const point = grid[index];
      points.push({ x: point.x, y: heights[index] ?? 0, z: point.z });
    }
    return points;
  }

  if (side === 'south') {
    const rowStart = (rows - 1) * cols;
    for (let c = 0; c < cols; c++) {
      const index = rowStart + c;
      const point = grid[index];
      points.push({ x: point.x, y: heights[index] ?? 0, z: point.z });
    }
    return points;
  }

  if (side === 'west') {
    for (let r = 0; r < rows; r++) {
      const index = r * cols;
      const point = grid[index];
      points.push({ x: point.x, y: heights[index] ?? 0, z: point.z });
    }
    return points;
  }

  if (side === 'east') {
    for (let r = 0; r < rows; r++) {
      const index = r * cols + (cols - 1);
      const point = grid[index];
      points.push({ x: point.x, y: heights[index] ?? 0, z: point.z });
    }
    return points;
  }

  return null;
}

function _getBridgeSideOutwardNormal(side, rotation = 0) {
  switch (side) {
    case 'south':
      return _rotateVector(0, 1, rotation);
    case 'east':
      return _rotateVector(1, 0, rotation);
    case 'west':
      return _rotateVector(-1, 0, rotation);
    case 'north':
    default:
      return _rotateVector(0, -1, rotation);
  }
}

/**
 * Build VertexData for a solid slab: top face + bottom face + four sides.
 */
function _buildSolidVD(centerX, centerZ, cols, rows, width, depth, heights, thickness, rotation = 0, offsetsX = null, offsetsZ = null, track = null) {
  const grid = _gridPoints(centerX, centerZ, cols, rows, width, depth, rotation, offsetsX, offsetsZ);
  const n = cols * rows;

  const positions = [];
  const uvs = [];
  const indices = [];

  // Underside Y for a grid vertex: nominally `top - thickness`, but pulled up to
  // ~terrain level where the slab would otherwise dip below the (non-occluding)
  // ground and leak a phantom shadow. Never rises above `top - BRIDGE_MIN_SLAB`.
  const bottomAt = (idx) => {
    const top = heights[idx] ?? 0;
    const nominal = top - thickness;
    const terrainY = track?.getHeightAt?.(grid[idx].x, grid[idx].z);
    if (!Number.isFinite(terrainY)) return nominal;
    return Math.min(top - BRIDGE_MIN_SLAB, Math.max(nominal, terrainY - BRIDGE_UNDERGRADE_EMBED));
  };

  // Top vertices (indices 0 .. n-1)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = grid[r * cols + c];
      positions.push(p.x, heights[r * cols + c] ?? 0, p.z);
      uvs.push(c / Math.max(cols - 1, 1), r / Math.max(rows - 1, 1));
    }
  }

  // Bottom vertices (indices n .. 2n-1), shifted down by thickness
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = grid[r * cols + c];
      positions.push(p.x, bottomAt(r * cols + c), p.z);
      uvs.push(c / Math.max(cols - 1, 1), r / Math.max(rows - 1, 1));
    }
  }

  // Top face (normals up)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v0 = r * cols + c;
      const v1 = r * cols + c + 1;
      const v2 = (r + 1) * cols + c + 1;
      const v3 = (r + 1) * cols + c;
      indices.push(v0, v1, v2);
      indices.push(v0, v2, v3);
    }
  }

  // Bottom face (normals down — opposite winding)
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v0 = n + r * cols + c;
      const v1 = n + r * cols + c + 1;
      const v2 = n + (r + 1) * cols + c + 1;
      const v3 = n + (r + 1) * cols + c;
      indices.push(v0, v2, v1);
      indices.push(v0, v3, v2);
    }
  }

  // ── Sides ─────────────────────────────────────────────────────────────────
  // Each side gets its own vertices rather than borrowing the top and bottom
  // grid's. Two things come out of that: ComputeNormals no longer averages a
  // wall's normal with the deck it used to share vertices with (so the top face
  // gets a clean up-normal and the edges read crisp), and the wall can carry a
  // UV that runs *down* it — sharing the top vertex's UV left the texture with
  // no vertical variation at all, smearing it down the whole face.
  //
  // `u` is distance along the edge and `v` the drop, each normalized by (width,
  // depth) so the material's own uScale/vScale — width/tile and depth/tile —
  // turns them back into world-uniform tiles matching the top face.
  const sideV = depth > 0 ? thickness / depth : 0;
  const uAlongX = (c) => c / Math.max(cols - 1, 1);
  const uAlongZ = (r) => (width > 0 ? (r / Math.max(rows - 1, 1)) * depth / width : 0);

  // `edge` runs from one end of the side to the other; `flipWinding` picks which
  // way the quads face so every side ends up wound outward.
  const addSide = (edge, flipWinding) => {
    const base = positions.length / 3;
    for (const { r, c, u } of edge) {
      const p = grid[r * cols + c];
      const topY = heights[r * cols + c] ?? 0;
      const botYv = bottomAt(r * cols + c);
      positions.push(p.x, topY, p.z);
      uvs.push(u, 0);
      positions.push(p.x, botYv, p.z);
      uvs.push(u, sideV);
    }
    for (let i = 0; i < edge.length - 1; i++) {
      const t0 = base + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
      if (flipWinding) {
        indices.push(t0, t1, b1);
        indices.push(t0, b1, b0);
      } else {
        indices.push(t0, b0, b1);
        indices.push(t0, b1, t1);
      }
    }
  };

  const frontEdge = [], backEdge = [], leftEdge = [], rightEdge = [];
  for (let c = 0; c < cols; c++) {
    frontEdge.push({ r: 0, c, u: uAlongX(c) });
    backEdge.push({ r: rows - 1, c, u: uAlongX(c) });
  }
  for (let r = 0; r < rows; r++) {
    leftEdge.push({ r, c: 0, u: uAlongZ(r) });
    rightEdge.push({ r, c: cols - 1, u: uAlongZ(r) });
  }
  addSide(frontEdge, false);  // r=0, outward is -Z
  addSide(backEdge, true);    // r=rows-1, outward is +Z
  addSide(leftEdge, true);    // c=0, outward is -X
  addSide(rightEdge, false);  // c=cols-1, outward is +X

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  return vd;
}
