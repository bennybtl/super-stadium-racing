import { expandPolyline } from "../polyline-utils.js";
import { WallSegment } from "./WallSegment.js";
import { TerrainQuery } from "../managers/TerrainQuery.js";

/**
 * PolyCurb — builds terrain-following curb segments along a polyline.
 *
 * Each segment is a very flat box (default 0.22 m tall, 0.9 m wide) with
 * alternating red / white colouring, matching the kerb strips seen at the
 * edge of real race tracks.  Segments are deliberately excluded from
 * WallManager._segments so their velocity-cancellation logic never fires —
 * trucks can drive over curbs without being blocked.
 *
 * Feature shape:
 * {
 *   type:   'polyCurb',
 *   points: [{ x, z, radius? }, …],
 *   height: 0.22,   // bump height (m) — how tall the curb is
 *   width:  0.9,    // lateral strip width (m)
 *   closed: false,
 * }
 */
export class PolyCurb {
  /**
   * @param {object}          feature
   * @param {Track}           track
   * @param {BABYLON.Scene}   scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(feature, track, scene, shadows) {
    this.segments = [];
    this._feature = feature;
    this._terrainQuery = new TerrainQuery(scene);
    this._useBridgeSurfaceSampling = this._featureUsesBridgeSurface(feature);

    const { height = 0.22, width = 0.9, closed = false } = feature;
    const rawPoints = feature.points;
    if (!rawPoints || rawPoints.length < 2) return;

    const points    = expandPolyline(rawPoints, closed);
    const numPoints = points.length;
    const edgeCount = closed ? numPoints : numPoints - 1;

    for (let i = 0; i < edgeCount; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % numPoints];

      const dx     = p1.x - p0.x;
      const dz     = p1.z - p0.z;
      const length = Math.sqrt(dx * dx + dz * dz);
      if (length < 0.01) continue;

      // heading convention matches PolyWall / StraightWall
      const heading = Math.atan2(-dz, dx);

      // Sub-segment every ~2 units to get clear alternating stripe pattern
      const numSegs = Math.max(1, Math.round(length / 2));
      const segLen  = length / numSegs;
      const dirX    = dx / length;
      const dirZ    = dz / length;

      for (let s = 0; s < numSegs; s++) {
        const t  = (s + 0.5) * segLen;
        const px = p0.x + dirX * t;
        const pz = p0.z + dirZ * t;

        const half = segLen / 2;
        const yA   = this._sampleHeight(track, px - dirX * half, pz - dirZ * half);
        const yB   = this._sampleHeight(track, px + dirX * half, pz + dirZ * half);

        // Place the curb flat on the terrain surface (no underground skirt)
        const avgY    = (yA + yB) / 2;
        const centerY = avgY + height / 2;
        const yShiftA = (yA - yB) / 2;
        const yShiftB = (yB - yA) / 2;

        const segW = segLen * 1.02; // tiny overlap to prevent stripe gaps

        this.segments.push(
          new WallSegment(
            px, pz, centerY,
            segW, height, width,
            heading, 0, this.segments.length, feature.style ?? 'red_white', 'curb_poly',
            scene, shadows,
            yShiftA, yShiftB,
            false,
          )
        );
      }
    }
  }

  dispose() {
    for (const seg of this.segments) seg.dispose();
    this.segments = [];
  }

  _featureUsesBridgeSurface(feature) {
    const points = feature?.points;
    if (!Array.isArray(points) || points.length === 0) return false;
    return points.some(pt => {
      this._terrainQuery.heightAt(pt.x, pt.z);
      return this._terrainQuery.getLastResolvedSurface?.()?.surfaceType === 'bridgeMesh';
    });
  }

  _sampleHeight(track, x, z) {
    if (this._useBridgeSurfaceSampling) {
      return this._terrainQuery.heightAt(x, z);
    }
    return track.getHeightAt(x, z);
  }
}
