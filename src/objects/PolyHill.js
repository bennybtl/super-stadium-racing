import { MeshBuilder, StandardMaterial, Color3, Vector3, VertexData } from "@babylonjs/core";

/**
 * Expand a polyline with optional rounded corners at each point.
 * Each point can have a `radius` property (0-10) that creates a circular arc.
 */
function expandPolyline(points, closed = false) {
  if (points.length < 2) return points;
  
  const out = [];
  const numSegments = closed ? points.length : points.length - 1;
  
  // Process each segment
  for (let i = 0; i < numSegments; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const p3 = closed ? points[(i + 2) % points.length] : (i + 2 < points.length ? points[i + 2] : null);
    
    const radius = p2.radius ?? 0;
        
    // Add the start point only for the first iteration (or it gets added via arc endpoints)
    if (i === 0 && !closed) {
      out.push({ x: p1.x, z: p1.z });
    }
    
    // Vector from p1 to p2
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    
    if (len < 0.01) continue;
    
    // If this point has a radius and there's a next segment, add rounded corner
    if (radius > 0.1 && p3) {
      // Vector from p2 to p3
      const dx2 = p3.x - p2.x;
      const dz2 = p3.z - p2.z;
      const len2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);
            
      if (len2 > 0.01) {
        // Clamp radius to not exceed segment lengths
        const maxRadius = Math.min(len * 0.49, len2 * 0.49);
        const clampedRadius = Math.min(radius, maxRadius);
                
        // Normalized direction vectors
        const dir1X = dx / len;
        const dir1Z = dz / len;
        const dir2X = dx2 / len2;
        const dir2Z = dz2 / len2;
        
        // Point before the arc starts (on the p1->p2 segment)
        const beforeX = p2.x - dir1X * clampedRadius;
        const beforeZ = p2.z - dir1Z * clampedRadius;
        out.push({ x: beforeX, z: beforeZ });
        
        // Point after the arc ends (on the p2->p3 segment)
        const afterX = p2.x + dir2X * clampedRadius;
        const afterZ = p2.z + dir2Z * clampedRadius;
        
        // Calculate the arc center
        const angle1 = Math.atan2(dir1Z, dir1X);
        const angle2 = Math.atan2(dir2Z, dir2X);
        
        let angleDiff = angle2 - angle1;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
        
        // For a circular arc, calculate the center point
        const halfAngle = angleDiff / 2;
        const centerDist = clampedRadius / Math.sin(Math.abs(halfAngle));
        const bisectorAngle = angle1 + halfAngle;
        
        // Center is perpendicular to the bisector (flipped to cut the corner, not bulge out)
        const perpAngle = bisectorAngle + (angleDiff > 0 ? Math.PI/2 : -Math.PI/2);
        const centerX = p2.x + Math.cos(perpAngle) * centerDist;
        const centerZ = p2.z + Math.sin(perpAngle) * centerDist;
        
        // Generate arc points
        const arcSteps = Math.max(4, Math.ceil(Math.abs(angleDiff) * clampedRadius / 1.5));
        const startAngle = Math.atan2(beforeZ - centerZ, beforeX - centerX);
        const endAngle = Math.atan2(afterZ - centerZ, afterX - centerX);
        
        let arcAngleDiff = endAngle - startAngle;
        while (arcAngleDiff > Math.PI) arcAngleDiff -= 2 * Math.PI;
        while (arcAngleDiff < -Math.PI) arcAngleDiff += 2 * Math.PI;
        
        const arcRadius = Math.sqrt((beforeX - centerX) ** 2 + (beforeZ - centerZ) ** 2);
        
        for (let step = 1; step <= arcSteps; step++) {
          const t = step / arcSteps;
          const angle = startAngle + arcAngleDiff * t;
          const arcX = centerX + Math.cos(angle) * arcRadius;
          const arcZ = centerZ + Math.sin(angle) * arcRadius;
          out.push({ x: arcX, z: arcZ });
        }
      } else {
        // Next segment too short, just add the point
        out.push({ x: p2.x, z: p2.z });
      }
    } else {
      // No radius or last point, just add it
      if (!closed || i < numSegments - 1) {
        out.push({ x: p2.x, z: p2.z });
      }
    }
  }
  
  return out;
}

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
