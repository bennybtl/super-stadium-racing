import { Mesh, VertexData, StandardMaterial, Color3, PhysicsAggregate, PhysicsShapeType, Texture } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { _lerp, _clamp } from "../terrain-utils.js";

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

function _lerpColor(colorA, colorB, t) {
  return new Color3(
    _lerp(colorA.r, colorB.r, t),
    _lerp(colorA.g, colorB.g, t),
    _lerp(colorA.b, colorB.b, t)
  );
}

const DRIVE_COLLIDER_OVERLAP = 0.35;
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
    this._terrainSeamSides = [];

    const {
      centerX, centerZ,
      cols, rows,
      width, depth,
      heights,
      rotation = 0,
      thickness = 0.4,
      level = 1,
      layerId = level,
    } = feature;
    const resolvedLayerId = Number.isFinite(layerId) ? layerId : 1;
    const safeHeights = Array.isArray(heights) ? heights : new Array(cols * rows).fill(0);
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
      !!terrainBlendConfig?.terrainDiffuseOverlayTexture &&
      Number.isFinite(terrainBlendConfig?.terrainTypeCount) &&
      Number.isFinite(terrainBlendConfig?.terrainCellCount) &&
      Number.isFinite(terrainBlendConfig?.terrainWorldHalfWidth) &&
      Number.isFinite(terrainBlendConfig?.terrainWorldHalfDepth);

    // ── Material ─────────────────────────────────────────────────────────────
    this._material = new StandardMaterial(`bmMat_${centerX}_${centerZ}`, scene);
    this._material.diffuseColor = terrainColor;
    this._material.specularColor = new Color3(
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13
    );
    const textureWorldTile = Math.max(1, terrainType.diffuseTextureWorldUnitsPerTile ?? 24);
    const diffuseTilesU = Math.max(0.01, width / textureWorldTile);
    const diffuseTilesV = Math.max(0.01, depth / textureWorldTile);
    if (hasTerrainBlendResources) {
      new terrainBlendConfig.pluginClass(
        this._material,
        terrainBlendConfig.terrainIdTexture,
        terrainBlendConfig.terrainPropertyTexture,
        terrainBlendConfig.terrainWaterOverlayTexture,
        terrainBlendConfig.terrainWearOverlayTexture,
        terrainBlendConfig.terrainDiffuseOverlayTexture,
        terrainBlendConfig.terrainTypeCount,
        terrainBlendConfig.terrainCellCount,
        terrainBlendConfig.terrainWorldHalfWidth,
        terrainBlendConfig.terrainWorldHalfDepth,
        { forcedTerrainTypeIndex: -1 }
      );
      this._material.diffuseColor = Color3.White();
      this._material.specularColor = Color3.White();
      this._material.specularPower = 48;
    } else {
      const diffuseUrl = _resolveBridgeAssetUrl(terrainType.diffuseTexture, _bridgeTextureUrls);
      if (diffuseUrl) {
        const diffuseTexture = new Texture(diffuseUrl, scene, true, false);
        diffuseTexture.uScale = diffuseTilesU;
        diffuseTexture.vScale = diffuseTilesV;
        this._material.diffuseTexture = diffuseTexture;
        // StandardMaterial multiplies texture by diffuseColor. Approximate
        // texture-opacity blending by tinting toward white as texture influence
        // increases, without darkening the whole surface.
        const textureInfluence = _clamp(terrainType.diffuseTextureOpacity ?? 1, 0, 1);
        this._material.diffuseColor = _lerpColor(terrainColor, Color3.White(), textureInfluence);
      }
    }

    const normalUrl = _resolveBridgeAssetUrl(terrainType.normalMap, _bridgeNormalUrls);
    if (normalUrl) {
      const bumpTexture = new Texture(normalUrl, scene, true, false);
      bumpTexture.uScale = diffuseTilesU;
      bumpTexture.vScale = diffuseTilesV;
      this._material.bumpTexture = bumpTexture;
      this._material.bumpTexture.level = (terrainType.normalMapIntensity ?? 1) * 0.6;
    }
    this._material.backFaceCulling = false;

    // ── Visual mesh (top + bottom + sides) ───────────────────────────────────
    this._mesh = new Mesh(`bridge_mesh_${centerX}_${centerZ}`, scene);
    const solidVD = _buildSolidVD(centerX, centerZ, cols, rows, width, depth, safeHeights, thickness, rotation);
    solidVD.applyToMesh(this._mesh);
    this._mesh.material = this._material;
    this._mesh.isPickable = false;
    this._mesh.receiveShadows = true;
    shadows?.addShadowCaster(this._mesh);

    // ── Drive surface mesh (top face only, invisible but pickable) ───────────
    // This is what TerrainQuery raycasts onto. Its vertex heights exactly match
    // the visual top surface so normal computation and floor-Y are correct.
    this._driveMesh = new Mesh(`bridge_mesh_drive_${centerX}_${centerZ}`, scene);
    const driveVD = _buildTopFaceVD(
      centerX,
      centerZ,
      cols,
      rows,
      width,
      depth,
      safeHeights,
      rotation,
      DRIVE_COLLIDER_OVERLAP
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
    } else {
      this._driveMesh.metadata = {
        isTerrain: true,
        isDriveSurface: true,
        surfaceType: 'bridgeMesh',
        level,
        surfaceKind: 'bridge-mesh',
        surfaceFace: 'top',
        normalFilterMode: 'absoluteY',
      };
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
    this._terrainSeamSides = uniqueSides;
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
      } else {
        seamMesh.metadata = {
          ...(seamMesh.metadata ?? {}),
          isTerrain: true,
          isDriveSurface: true,
          surfaceType: 'bridgeMeshSeam',
          level: this._resolvedLayerId,
          surfaceKind: 'bridge-mesh-seam',
          surfaceFace: 'top',
          normalFilterMode: 'absoluteY',
          bridgeMeshKey: this._bridgeMeshKey,
          seamSide: side,
        };
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
    this._material?.dispose();
    this._material = null;
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

function _rotateVector(x, z, rotationDeg = 0) {
  const rad = rotationDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: x * cos - z * sin,
    z: x * sin + z * cos,
  };
}

function _gridPoints(centerX, centerZ, cols, rows, width, depth, rotationDeg = 0) {
  const halfW = width / 2;
  const halfD = depth / 2;
  const stepX = cols > 1 ? width / (cols - 1) : 0;
  const stepZ = rows > 1 ? depth / (rows - 1) : 0;
  const points = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const localX = -halfW + c * stepX;
      const localZ = -halfD + r * stepZ;
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
function _buildTopFaceVD(centerX, centerZ, cols, rows, width, depth, heights, rotation = 0, overlap = 0) {
  const safeOverlap = Math.max(0, overlap);
  const expandedWidth = width + safeOverlap * 2;
  const expandedDepth = depth + safeOverlap * 2;
  const grid = _gridPoints(centerX, centerZ, cols, rows, expandedWidth, expandedDepth, rotation);

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
  rotation,
  side,
}) {
  const grid = _gridPoints(centerX, centerZ, cols, rows, width, depth, rotation);
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
function _buildSolidVD(centerX, centerZ, cols, rows, width, depth, heights, thickness, rotation = 0) {
  const grid = _gridPoints(centerX, centerZ, cols, rows, width, depth, rotation);
  const n = cols * rows;

  const positions = [];
  const uvs = [];
  const indices = [];

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
      positions.push(p.x, (heights[r * cols + c] ?? 0) - thickness, p.z);
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

  // Side: front (r=0), c left→right, winding outward (-Z normal)
  for (let c = 0; c < cols - 1; c++) {
    const t0 = c,         t1 = c + 1;
    const b0 = n + c,     b1 = n + c + 1;
    indices.push(t0, b0, b1);
    indices.push(t0, b1, t1);
  }

  // Side: back (r=rows-1), c left→right, winding outward (+Z normal)
  const rLast = rows - 1;
  for (let c = 0; c < cols - 1; c++) {
    const t0 = rLast * cols + c,         t1 = rLast * cols + c + 1;
    const b0 = n + rLast * cols + c,     b1 = n + rLast * cols + c + 1;
    indices.push(t0, t1, b1);
    indices.push(t0, b1, b0);
  }

  // Side: left (c=0), r top→bottom, winding outward (-X normal)
  for (let r = 0; r < rows - 1; r++) {
    const t0 = r * cols,       t1 = (r + 1) * cols;
    const b0 = n + r * cols,   b1 = n + (r + 1) * cols;
    indices.push(t0, t1, b1);
    indices.push(t0, b1, b0);
  }

  // Side: right (c=cols-1), r top→bottom, winding outward (+X normal)
  const cLast = cols - 1;
  for (let r = 0; r < rows - 1; r++) {
    const t0 = r * cols + cLast,       t1 = (r + 1) * cols + cLast;
    const b0 = n + r * cols + cLast,   b1 = n + (r + 1) * cols + cLast;
    indices.push(t0, b0, b1);
    indices.push(t0, b1, t1);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  return vd;
}
