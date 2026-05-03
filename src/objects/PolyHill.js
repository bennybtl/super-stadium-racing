import { MeshBuilder, StandardMaterial, Color3, Vector3, VertexData } from "@babylonjs/core";

import { expandPolyline } from "../polyline-utils.js";
/**
 * PolyHill — builds a terrain-modifying hill along a polyline of world-space points.
 * 
 * Creates a raised polygonal hill that follows the control points, with adjustable
 * height and slope. The hill modifies the terrain height map to create realistic
 * elevation changes.
 */
export class PolyHill {
  /**
   * @param {object} feature  - track feature of type "polyHill"
   * @param {Track}  track    - used to modify terrain height
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.mesh = null;
    this._feature = feature;
    const { height = 3, slope = 5, closed = false } = feature;
    const rawPoints = feature.points;
    
    if (!rawPoints || rawPoints.length < 2) return;

    const points = expandPolyline(rawPoints, closed);
    
    // Build the hill mesh
    this._buildHillMesh(points, height, slope, closed, track, scene, shadows);
  }

  /**
   * Build a visual mesh for the hill
   */
  _buildHillMesh(points, height, slope, closed, track, scene, shadows) {
    // Create a simple tube/ribbon mesh that follows the polyline
    // Build paths at different heights/offsets from the centerline
    const ribbonPaths = [];
    
    // Helper to calculate the miter offset vector at each point.
    // Returns { perpX, perpZ, scale } so the caller does:
    //   x = p.x + perpX * offsetDist * scale
    // This keeps the ribbon a consistent world-space width at corners.
    const getPerpendicular = (i) => {
      const p = points[i];

      if (i === 0 && !closed) {
        // First point — perpendicular to outgoing segment only
        const next = points[1];
        const dx = next.x - p.x, dz = next.z - p.z;
        const len = Math.sqrt(dx*dx + dz*dz);
        if (len < 0.001) return { perpX: 0, perpZ: 1, scale: 1 };
        return { perpX: -dz/len, perpZ: dx/len, scale: 1 };
      }

      if (i === points.length - 1 && !closed) {
        // Last point — perpendicular to incoming segment only
        const prev = points[i - 1];
        const dx = p.x - prev.x, dz = p.z - prev.z;
        const len = Math.sqrt(dx*dx + dz*dz);
        if (len < 0.001) return { perpX: 0, perpZ: 1, scale: 1 };
        return { perpX: -dz/len, perpZ: dx/len, scale: 1 };
      }

      // Interior point — miter join so width stays constant around corners
      const prevIdx = i === 0 ? points.length - 1 : i - 1;
      const prev = points[prevIdx];
      const next = points[(i + 1) % points.length];

      const dx1 = p.x - prev.x, dz1 = p.z - prev.z;
      const len1 = Math.sqrt(dx1*dx1 + dz1*dz1);
      const dx2 = next.x - p.x, dz2 = next.z - p.z;
      const len2 = Math.sqrt(dx2*dx2 + dz2*dz2);

      if (len1 < 0.001 || len2 < 0.001) return { perpX: 0, perpZ: 1, scale: 1 };

      // Unit normals of each adjacent segment (both pointing the same side)
      const n1x = -dz1/len1, n1z = dx1/len1;
      const n2x = -dz2/len2, n2z = dx2/len2;

      // Miter direction = average of the two normals, normalised
      const mx = n1x + n2x, mz = n1z + n2z;
      const mlen = Math.sqrt(mx*mx + mz*mz);
      if (mlen < 0.001) return { perpX: n1x, perpZ: n1z, scale: 1 };

      const miterX = mx/mlen, miterZ = mz/mlen;

      // Scale = 1 / cos(halfBendAngle) — restores the true offset distance.
      // Capped at 5× to avoid runaway spikes at very sharp corners.
      const dot = miterX * n1x + miterZ * n1z;
      const scale = Math.min(1 / Math.max(dot, 0.2), 5);

      return { perpX: miterX, perpZ: miterZ, scale };
    };
    
    // Create paths from one side to the other
    const numPaths = 7; // More paths for smoother mesh
    for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
      const t = pathIdx / (numPaths - 1); // 0 to 1
      const offsetDist = (t - 0.5) * 2 * slope; // -slope to +slope
      
      const path = [];
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const { perpX, perpZ, scale } = getPerpendicular(i);
        
        const x = p.x + perpX * offsetDist * scale;
        const z = p.z + perpZ * offsetDist * scale;
        const terrainH = track.getHeightAt(x, z);
        
        path.push(new Vector3(x, terrainH, z));
      }
      ribbonPaths.push(path);
    }
    
    // Create ribbon mesh
    this.mesh = MeshBuilder.CreateRibbon('polyHill', {
      pathArray: ribbonPaths,
      closePath: closed,
      closeArray: false,
      sideOrientation: 2, // DOUBLESIDE to prevent back-face culling issues
      updatable: true
    }, scene);
    
    // Compute normals for proper lighting
    const normals = [];
    const positions = this.mesh.getVerticesData('position');
    const indices = this.mesh.getIndices();
    VertexData.ComputeNormals(positions, indices, normals);
    this.mesh.setVerticesData('normal', normals);
    
    // Apply material - yellow and transparent like square hill
    const mat = new StandardMaterial('polyHillMat', scene);
    mat.diffuseColor = new Color3(1.0, 1.0, 0.3);
    mat.emissiveColor = new Color3(0.3, 0.3, 0.0);
    mat.alpha = 0.25;
    mat.zOffset = -4; // Bias depth so the overlay never z-fights the ground mesh
    mat.backFaceCulling = false; // Ensure both sides render
    this.mesh.material = mat;
    this.mesh.isVisible = false;  // hidden until selected in the editor
    this.mesh.receiveShadows = false; // Don't receive shadows when transparent
    
    if (shadows) {
      shadows.addShadowCaster(this.mesh);
    }
  }

  dispose() {
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
  }
}
