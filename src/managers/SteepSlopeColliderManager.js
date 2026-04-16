import { MeshBuilder, Vector3 } from "@babylonjs/core";

const DEFAULTS = {
  enabled: true,
  sampleStep: 3,
  maxSlopeDeg: 60,
  wallAbove: 4,
  wallBelow: 1,
  padding: 0.15,
};

/**
 * Builds invisible static collider volumes over terrain regions whose local
 * slope exceeds a configured threshold.
 *
 * These colliders are consumed by StaticBodyCollisionManager via metadata:
 *   mesh.metadata.truckCollider = true
 */
export class SteepSlopeColliderManager {
  constructor(scene, track, options = {}) {
    this.scene = scene;
    this.track = track;
    this.options = { ...DEFAULTS, ...options };
    this._meshes = [];
  }

  dispose() {
    for (const mesh of this._meshes) mesh.dispose();
    this._meshes = [];
  }

  rebuild() {
    this.dispose();
    if (!this.options.enabled || !this.track) return;

    const width = this.track.width ?? 160;
    const depth = this.track.depth ?? 160;
    const step = Math.max(1, this.options.sampleStep);

    const cols = Math.max(1, Math.floor(width / step));
    const rows = Math.max(1, Math.floor(depth / step));
    const originX = -width / 2 + step / 2;
    const originZ = -depth / 2 + step / 2;

    const steep = Array.from({ length: rows }, () => Array(cols).fill(false));
    const heights = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = originX + c * step;
        const z = originZ + r * step;
        heights[r][c] = this.track.getHeightAt(x, z);
        steep[r][c] = this._slopeDegAt(x, z, step * 0.5) > this.options.maxSlopeDeg;
      }
    }

    this._buildMergedBlockers(steep, heights, originX, originZ, step);
  }

  _slopeDegAt(x, z, d) {
    const hL = this.track.getHeightAt(x - d, z);
    const hR = this.track.getHeightAt(x + d, z);
    const hB = this.track.getHeightAt(x, z - d);
    const hF = this.track.getHeightAt(x, z + d);

    const ddx = (hR - hL) / (2 * d);
    const ddz = (hF - hB) / (2 * d);
    const gradMag = Math.sqrt(ddx * ddx + ddz * ddz);
    return Math.atan(gradMag) * 180 / Math.PI;
  }

  _buildMergedBlockers(steep, heights, originX, originZ, step) {
    const rows = steep.length;
    const cols = steep[0]?.length ?? 0;
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!steep[r][c] || visited[r][c]) continue;

        let w = 0;
        while (c + w < cols && steep[r][c + w] && !visited[r][c + w]) w++;

        let h = 1;
        let canGrow = true;
        while (canGrow && r + h < rows) {
          for (let x = c; x < c + w; x++) {
            if (!steep[r + h][x] || visited[r + h][x]) {
              canGrow = false;
              break;
            }
          }
          if (canGrow) h++;
        }

        for (let rr = r; rr < r + h; rr++) {
          for (let cc = c; cc < c + w; cc++) {
            visited[rr][cc] = true;
          }
        }

        this._createBlocker(c, r, w, h, heights, originX, originZ, step);
      }
    }
  }

  _createBlocker(c, r, w, h, heights, originX, originZ, step) {
    const minX = originX + c * step - step / 2;
    const maxX = originX + (c + w - 1) * step + step / 2;
    const minZ = originZ + r * step - step / 2;
    const maxZ = originZ + (r + h - 1) * step + step / 2;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let rr = r; rr < r + h; rr++) {
      for (let cc = c; cc < c + w; cc++) {
        const y = heights[rr][cc];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const bottom = minY - this.options.wallBelow;
    const top = maxY + this.options.wallAbove;
    const width = (maxX - minX) + this.options.padding * 2;
    const depth = (maxZ - minZ) + this.options.padding * 2;
    const height = Math.max(1, top - bottom);

    const mesh = MeshBuilder.CreateBox(
      `steepSlopeCollider_${this._meshes.length}`,
      { width, depth, height },
      this.scene
    );
    mesh.position = new Vector3(
      (minX + maxX) * 0.5,
      (bottom + top) * 0.5,
      (minZ + maxZ) * 0.5
    );
    mesh.isVisible = false;
    mesh.isPickable = false;
    mesh.metadata = {
      ...(mesh.metadata ?? {}),
      truckCollider: true,
      truckColliderApplyFriction: false,
      internalSteepSlopeCollider: true,
    };

    this._meshes.push(mesh);
  }
}
