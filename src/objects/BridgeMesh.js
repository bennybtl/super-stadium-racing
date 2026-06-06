import { Mesh, VertexData, StandardMaterial, Color3 } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";

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
 *     thickness:    number,        // vertical thickness of the slab
 *     materialType: string,        // terrain type name (e.g. 'packed_dirt')
 *     level:        number,        // surface layer level (default 1)
 *   }
 *
 * The top face is registered as a drive surface so TerrainQuery raycasts land
 * directly on it at the correct height and slope — no separate proxy needed.
 */
export class BridgeMesh {
  constructor(feature, track, scene, shadows = null, driveSurfaceManager = null) {
    this.feature = feature;
    this._driveSurfaceManager = driveSurfaceManager;
    this._transitionMeshes = [];
    this._transitionVisualMeshes = [];

    const {
      centerX, centerZ,
      cols, rows,
      width, depth,
      heights,
      thickness = 0.4,
      materialType = 'packed_dirt',
      level = 1,
      transitionEnabled = true,
      transitionDepth = 8,
      transitionYOffset = 0,
    } = feature;

    const bridgeMeshKey = `${centerX}_${centerZ}`;

    const safeHeights = Array.isArray(heights) ? heights : new Array(cols * rows).fill(0);
    const terrainType = Object.values(TERRAIN_TYPES).find(t => t.name === materialType) || TERRAIN_TYPES.PACKED_DIRT;

    // ── Material ─────────────────────────────────────────────────────────────
    this._material = new StandardMaterial(`bmMat_${centerX}_${centerZ}`, scene);
    this._material.diffuseColor = terrainType.color ?? new Color3(0.52, 0.40, 0.22);
    this._material.specularColor = new Color3(
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13,
      terrainType.specular ?? 0.13
    );
    this._material.backFaceCulling = false;

    // ── Visual mesh (top + bottom + sides) ───────────────────────────────────
    this._mesh = new Mesh(`bridge_mesh_${centerX}_${centerZ}`, scene);
    const solidVD = _buildSolidVD(centerX, centerZ, cols, rows, width, depth, safeHeights, thickness);
    solidVD.applyToMesh(this._mesh);
    this._mesh.material = this._material;
    this._mesh.isPickable = false;
    this._mesh.receiveShadows = true;
    shadows?.addShadowCaster(this._mesh);

    // ── Drive surface mesh (top face only, invisible but pickable) ───────────
    // This is what TerrainQuery raycasts onto. Its vertex heights exactly match
    // the visual top surface so normal computation and floor-Y are correct.
    this._driveMesh = new Mesh(`bridge_mesh_drive_${centerX}_${centerZ}`, scene);
    const driveVD = _buildTopFaceVD(centerX, centerZ, cols, rows, width, depth, safeHeights);
    driveVD.applyToMesh(this._driveMesh);
    this._driveMesh.isVisible = true;
    this._driveMesh.visibility = 0;
    this._driveMesh.isPickable = true;
    this._driveMesh.receiveShadows = false;

    if (driveSurfaceManager) {
      driveSurfaceManager.register(this._driveMesh, {
        surfaceType: 'bridgeMesh',
        level,
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

    if (transitionEnabled && transitionDepth > 0 && track?.getHeightAt) {
      const strips = _createTransitionStrips({
        scene,
        track,
        centerX,
        centerZ,
        cols,
        rows,
        width,
        depth,
        heights: safeHeights,
        transitionDepth,
        transitionYOffset,
        bridgeMeshKey,
      });

      for (const strip of strips) {
        // Keep drive strips hidden; they exist only for TerrainQuery/physics sampling.
        strip.isVisible = true;
        strip.visibility = 0;
        strip.isPickable = true;
        strip.receiveShadows = false;
        this._transitionMeshes.push(strip);

        const visual = strip.clone(`bridge_mesh_transition_visual_${strip.name}`, null, false);
        if (visual) {
          visual.isVisible = true;
          visual.visibility = 1;
          visual.isPickable = false;
          visual.material = this._material;
          visual.receiveShadows = true;
          shadows?.addShadowCaster?.(visual);
          this._transitionVisualMeshes.push(visual);
        }

        if (driveSurfaceManager) {
          driveSurfaceManager.register(strip, {
            surfaceType: 'bridgeMeshTransition',
            level,
            tags: {
              surfaceKind: 'bridge-mesh-transition',
              surfaceFace: 'top',
              normalFilterMode: 'absoluteY',
              bridgeMeshKey,
              transitionSide: strip.metadata?.transitionSide ?? 'unknown',
            },
          });
        } else {
          strip.metadata = {
            ...(strip.metadata ?? {}),
            isTerrain: true,
            isDriveSurface: true,
            surfaceType: 'bridgeMeshTransition',
            level,
            surfaceKind: 'bridge-mesh-transition',
            surfaceFace: 'top',
            normalFilterMode: 'absoluteY',
          };
        }
      }
    }
  }

  dispose() {
    for (const mesh of this._transitionVisualMeshes ?? []) {
      mesh.dispose();
    }
    this._transitionVisualMeshes = [];

    for (const mesh of this._transitionMeshes ?? []) {
      this._driveSurfaceManager?.unregisterByMesh?.(mesh);
      mesh.dispose();
    }
    this._transitionMeshes = [];
    this._driveSurfaceManager?.unregisterByMesh?.(this._driveMesh);
    this._driveMesh?.dispose();
    this._driveMesh = null;
    this._mesh?.dispose();
    this._mesh = null;
    this._material?.dispose();
    this._material = null;
  }
}

function _createTransitionStrips({
  scene,
  track,
  centerX,
  centerZ,
  cols,
  rows,
  width,
  depth,
  heights,
  transitionDepth,
  transitionYOffset,
  bridgeMeshKey,
}) {
  const xs = _xs(centerX, cols, width);
  const zs = _zs(centerZ, rows, depth);
  const h = (r, c) => heights[r * cols + c] ?? 0;

  const mkStrip = (name, side, points) => {
    if (!Array.isArray(points) || points.length < 2) return null;
    const strip = new Mesh(name, scene);
    const vd = _buildEdgeStripVD(points);
    vd.applyToMesh(strip);
    strip.metadata = {
      ...(strip.metadata ?? {}),
      bridgeMeshKey,
      transitionSide: side,
    };
    return strip;
  };

  const strips = [];

  {
    const points = [];
    for (let c = 0; c < cols; c++) {
      const x = xs[c];
      const z = zs[0];
      const outX = x;
      const outZ = z - transitionDepth;
      points.push({
        x,
        z,
        topY: h(0, c),
        outX,
        outZ,
        outY: (track.getHeightAt(outX, outZ) ?? 0) + transitionYOffset,
      });
    }
    const strip = mkStrip(`bridge_mesh_transition_north_${centerX}_${centerZ}`, 'north', points);
    if (strip) strips.push(strip);
  }

  {
    const points = [];
    for (let c = 0; c < cols; c++) {
      const x = xs[c];
      const z = zs[rows - 1];
      const outX = x;
      const outZ = z + transitionDepth;
      points.push({
        x,
        z,
        topY: h(rows - 1, c),
        outX,
        outZ,
        outY: (track.getHeightAt(outX, outZ) ?? 0) + transitionYOffset,
      });
    }
    const strip = mkStrip(`bridge_mesh_transition_south_${centerX}_${centerZ}`, 'south', points);
    if (strip) strips.push(strip);
  }

  {
    const points = [];
    for (let r = 0; r < rows; r++) {
      const x = xs[0];
      const z = zs[r];
      const outX = x - transitionDepth;
      const outZ = z;
      points.push({
        x,
        z,
        topY: h(r, 0),
        outX,
        outZ,
        outY: (track.getHeightAt(outX, outZ) ?? 0) + transitionYOffset,
      });
    }
    const strip = mkStrip(`bridge_mesh_transition_west_${centerX}_${centerZ}`, 'west', points);
    if (strip) strips.push(strip);
  }

  {
    const points = [];
    for (let r = 0; r < rows; r++) {
      const x = xs[cols - 1];
      const z = zs[r];
      const outX = x + transitionDepth;
      const outZ = z;
      points.push({
        x,
        z,
        topY: h(r, cols - 1),
        outX,
        outZ,
        outY: (track.getHeightAt(outX, outZ) ?? 0) + transitionYOffset,
      });
    }
    const strip = mkStrip(`bridge_mesh_transition_east_${centerX}_${centerZ}`, 'east', points);
    if (strip) strips.push(strip);
  }

  return strips;
}

function _buildEdgeStripVD(points) {
  const n = points.length;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i < n; i++) {
    const p = points[i];
    positions.push(p.x, p.topY, p.z);
    uvs.push(i / Math.max(n - 1, 1), 0);
  }

  for (let i = 0; i < n; i++) {
    const p = points[i];
    positions.push(p.outX, p.outY, p.outZ);
    uvs.push(i / Math.max(n - 1, 1), 1);
  }

  for (let i = 0; i < n - 1; i++) {
    const t0 = i;
    const t1 = i + 1;
    const o0 = n + i;
    const o1 = n + i + 1;
    indices.push(t0, o1, o0);
    indices.push(t0, t1, o1);
  }

  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.uvs = uvs;
  VertexData.ComputeNormals(positions, indices, vd.normals = []);
  return vd;
}

// ── Private mesh-building helpers ─────────────────────────────────────────────

/**
 * Compute evenly-spaced world X positions for each column.
 */
function _xs(centerX, cols, width) {
  const halfW = width / 2;
  const step = cols > 1 ? width / (cols - 1) : 0;
  return Array.from({ length: cols }, (_, c) => centerX - halfW + c * step);
}

/**
 * Compute evenly-spaced world Z positions for each row.
 */
function _zs(centerZ, rows, depth) {
  const halfD = depth / 2;
  const step = rows > 1 ? depth / (rows - 1) : 0;
  return Array.from({ length: rows }, (_, r) => centerZ - halfD + r * step);
}

/**
 * Build VertexData for the top face only.
 * Winding is chosen so ComputeNormals produces upward-facing normals.
 */
function _buildTopFaceVD(centerX, centerZ, cols, rows, width, depth, heights) {
  const xs = _xs(centerX, cols, width);
  const zs = _zs(centerZ, rows, depth);

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push(xs[c], heights[r * cols + c] ?? 0, zs[r]);
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

/**
 * Build VertexData for a solid slab: top face + bottom face + four sides.
 */
function _buildSolidVD(centerX, centerZ, cols, rows, width, depth, heights, thickness) {
  const xs = _xs(centerX, cols, width);
  const zs = _zs(centerZ, rows, depth);
  const n = cols * rows;

  const positions = [];
  const uvs = [];
  const indices = [];

  // Top vertices (indices 0 .. n-1)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push(xs[c], heights[r * cols + c] ?? 0, zs[r]);
      uvs.push(c / Math.max(cols - 1, 1), r / Math.max(rows - 1, 1));
    }
  }

  // Bottom vertices (indices n .. 2n-1), shifted down by thickness
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.push(xs[c], (heights[r * cols + c] ?? 0) - thickness, zs[r]);
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
