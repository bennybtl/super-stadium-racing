import { StandardMaterial, Color3 } from "@babylonjs/core";

/**
 * EditorMaterials — a lazily-populated registry of all editor gizmo materials.
 *
 * Materials are created on first access and cached for the lifetime of the
 * Babylon scene they belong to.  Editor classes call `EditorMaterials.for(scene)`
 * to obtain the singleton for their scene, then read named properties:
 *
 *   const m = EditorMaterials.for(scene);
 *   this.normalMat    = m.polyWallNode;
 *   this.highlightMat = m.nodeHighlight;
 *
 * Keeping all colour/material definitions here means colour changes or new
 * zone types only require edits in this one file.
 */

function makeMat(name, scene, { diffuse, emissive, alpha, backFaceCulling } = {}) {
  const mat = new StandardMaterial(name, scene);
  if (diffuse)  mat.diffuseColor  = new Color3(...diffuse);
  if (emissive) mat.emissiveColor = new Color3(...emissive);
  if (alpha !== undefined) mat.alpha = alpha;
  if (backFaceCulling !== undefined) mat.backFaceCulling = backFaceCulling;
  return mat;
}

export class EditorMaterials {
  /** @type {WeakMap<import('@babylonjs/core').Scene, EditorMaterials>} */
  static _cache = new WeakMap();

  /**
   * Returns the EditorMaterials instance for the given scene, creating it on
   * first call.  The instance is keyed weakly so it is automatically eligible
   * for GC when the scene is disposed.
   * @param {import('@babylonjs/core').Scene} scene
   * @returns {EditorMaterials}
   */
  static for(scene) {
    if (!EditorMaterials._cache.has(scene)) {
      EditorMaterials._cache.set(scene, new EditorMaterials(scene));
    }
    return EditorMaterials._cache.get(scene);
  }

  constructor(scene) {
    this._scene = scene;
    this._m = {};
  }

  /** @private Lazily get-or-create a named material. */
  _get(key, factory) {
    if (!this._m[key]) this._m[key] = factory(this._scene);
    return this._m[key];
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * Bright yellow — the "selected node" highlight shared by all polyline
   * editors: PolyWall, PolyCurb, PolyHill, BezierWall.
   */
  get nodeHighlight() {
    return this._get('nodeHighlight', s => makeMat('edNodeHighlight', s, {
      diffuse: [1.0, 1.0, 0.2], emissive: [0.6, 0.6, 0.0],
    }));
  }

  /** Neutral dark-grey sphere — the click-target handle for round/square hills. */
  get handleSphere() {
    return this._get('handleSphere', s => makeMat('edHandleSphere', s, {
      diffuse: [0.45, 0.45, 0.45], emissive: [0.1, 0.1, 0.1],
    }));
  }

  // ── Checkpoint ────────────────────────────────────────────────────────────

  get checkpointHighlight() {
    return this._get('checkpointHighlight', s => makeMat('edCheckpointHL', s, {
      diffuse: [0.0, 1.0, 1.0], emissive: [0.0, 0.5, 0.5],
    }));
  }

  // ── Round Hill ────────────────────────────────────────────────────────────

  /** Translucent green cone gizmo. */
  get hillCone() {
    return this._get('hillCone', s => makeMat('edHillCone', s, {
      diffuse: [0.25, 0.75, 0.3], emissive: [0.04, 0.12, 0.05],
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  /** Translucent teal cone gizmo (selected). */
  get hillConeHighlight() {
    return this._get('hillConeHighlight', s => makeMat('edHillConeHL', s, {
      diffuse: [0.0, 0.9, 0.8], emissive: [0.0, 0.35, 0.3],
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  // ── Square Hill ───────────────────────────────────────────────────────────

  /** Translucent gold/tan box gizmo. */
  get squareHillBox() {
    return this._get('squareHillBox', s => makeMat('edSquareHillBox', s, {
      diffuse: [0.75, 0.55, 0.1], emissive: [0.12, 0.08, 0.01],
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  /** Translucent gold box gizmo (selected). */
  get squareHillBoxHighlight() {
    return this._get('squareHillBoxHighlight', s => makeMat('edSquareHillBoxHL', s, {
      diffuse: [1.0, 0.8, 0.0], emissive: [0.35, 0.25, 0.0],
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  // ── Bezier Wall ───────────────────────────────────────────────────────────

  /** Blue anchor-point sphere. */
  get bezierAnchor() {
    return this._get('bezierAnchor', s => makeMat('edBezierAnchor', s, {
      diffuse: [0.2, 0.6, 0.9], emissive: [0.05, 0.15, 0.3], alpha: 0.90,
    }));
  }

  /** Bright blue anchor-point sphere (active wall). */
  get bezierAnchorActive() {
    return this._get('bezierAnchorActive', s => makeMat('edBezierAnchorActive', s, {
      diffuse: [0.3, 0.7, 1.0], emissive: [0.1, 0.25, 0.4], alpha: 0.90,
    }));
  }

  /** Orange control-handle sphere. */
  get bezierHandle() {
    return this._get('bezierHandle', s => makeMat('edBezierHandle', s, {
      diffuse: [0.9, 0.5, 0.2], emissive: [0.3, 0.15, 0.05], alpha: 0.85,
    }));
  }

  /** Bright orange-yellow control-handle sphere (selected). */
  get bezierHandleHighlight() {
    return this._get('bezierHandleHighlight', s => makeMat('edBezierHandleHL', s, {
      diffuse: [1.0, 0.8, 0.2], emissive: [0.5, 0.3, 0.0],
    }));
  }

  // ── Mesh Grid ─────────────────────────────────────────────────────────────

  /** Teal grid-node sphere. */
  get meshGridNode() {
    return this._get('meshGridNode', s => makeMat('edMeshGridNode', s, {
      diffuse: [0.15, 0.75, 0.75], emissive: [0.03, 0.25, 0.25], alpha: 0.90,
    }));
  }

  /** Amber grid-node sphere (selected). */
  get meshGridHighlight() {
    return this._get('meshGridHighlight', s => makeMat('edMeshGridHL', s, {
      diffuse: [1.0, 0.85, 0.0], emissive: [0.55, 0.42, 0.0],
    }));
  }

  // ── Normal Map Decal ──────────────────────────────────────────────────────

  /** Translucent purple disc. */
  get normalMapDecal() {
    return this._get('normalMapDecal', s => makeMat('edNormalMapDecal', s, {
      diffuse: [0.8, 0.4, 0.9], emissive: [0.15, 0.08, 0.18],
      alpha: 0.30, backFaceCulling: false,
    }));
  }

  /** Translucent magenta disc (selected). */
  get normalMapDecalHighlight() {
    return this._get('normalMapDecalHL', s => makeMat('edNormalMapDecalHL', s, {
      diffuse: [1.0, 0.5, 1.0], emissive: [0.4, 0.2, 0.4],
      alpha: 0.40, backFaceCulling: false,
    }));
  }

  // ── Poly Curb ─────────────────────────────────────────────────────────────

  /** Teal node sphere (inactive wall). */
  get polyCurbNode() {
    return this._get('polyCurbNode', s => makeMat('edPolyCurbNode', s, {
      diffuse: [0.15, 0.75, 0.75], emissive: [0.04, 0.22, 0.22], alpha: 0.90,
    }));
  }

  /** Bright teal node sphere (active wall). */
  get polyCurbNodeActive() {
    return this._get('polyCurbNodeActive', s => makeMat('edPolyCurbNodeActive', s, {
      diffuse: [0.2, 1.0, 0.9], emissive: [0.05, 0.40, 0.35], alpha: 0.90,
    }));
  }

  // ── Poly Hill ─────────────────────────────────────────────────────────────

  /** Olive-green node sphere (inactive hill). */
  get polyHillNode() {
    return this._get('polyHillNode', s => makeMat('edPolyHillNode', s, {
      diffuse: [0.4, 0.6, 0.2], emissive: [0.1, 0.2, 0.05], alpha: 0.90,
    }));
  }

  /** Bright green node sphere (active hill). */
  get polyHillNodeActive() {
    return this._get('polyHillNodeActive', s => makeMat('edPolyHillNodeActive', s, {
      diffuse: [0.6, 0.8, 0.3], emissive: [0.2, 0.3, 0.1], alpha: 0.90,
    }));
  }

  // ── Poly Wall ─────────────────────────────────────────────────────────────

  /** Orange node sphere (inactive wall). */
  get polyWallNode() {
    return this._get('polyWallNode', s => makeMat('edPolyWallNode', s, {
      diffuse: [0.9, 0.55, 0.05], emissive: [0.3, 0.15, 0.0], alpha: 0.90,
    }));
  }

  /** Bright orange node sphere (active wall). */
  get polyWallNodeActive() {
    return this._get('polyWallNodeActive', s => makeMat('edPolyWallNodeActive', s, {
      diffuse: [1.0, 0.7, 0.2], emissive: [0.4, 0.22, 0.0], alpha: 0.90,
    }));
  }

  // ── Terrain Shape ─────────────────────────────────────────────────────────

  /** Translucent blue shape gizmo. */
  get terrainShape() {
    return this._get('terrainShape', s => makeMat('edTerrainShape', s, {
      diffuse: [0.2, 0.5, 0.9], emissive: [0.04, 0.1, 0.2],
      alpha: 0.25, backFaceCulling: false,
    }));
  }

  /** Translucent cyan shape gizmo (selected). */
  get terrainShapeHighlight() {
    return this._get('terrainShapeHL', s => makeMat('edTerrainShapeHL', s, {
      diffuse: [0.0, 0.9, 1.0], emissive: [0.0, 0.3, 0.4],
      alpha: 0.35, backFaceCulling: false,
    }));
  }

  // ── Tire Stack ────────────────────────────────────────────────────────────

  /** Grey handle sphere. */
  get tireStackHandle() {
    return this._get('tireStackHandle', s => makeMat('edTireStackHandle', s, {
      diffuse: [0.6, 0.6, 0.6], emissive: [0.1, 0.1, 0.1],
    }));
  }

  /** Orange-yellow handle sphere (selected). */
  get tireStackHandleHighlight() {
    return this._get('tireStackHandleHL', s => makeMat('edTireStackHandleHL', s, {
      diffuse: [1.0, 0.7, 0.1], emissive: [0.5, 0.3, 0.0],
    }));
  }

  /** Rubber tyre material — uses specular for a slight sheen. */
  get tireStackTire() {
    return this._get('tireStackTire', s => {
      const mat = new StandardMaterial('edTireStackTire', s);
      mat.diffuseColor  = new Color3(0.8, 0.5, 0.1);
      mat.specularColor = new Color3(0.3, 0.2, 0.05);
      mat.specularPower = 32;
      return mat;
    });
  }

  // ── Action Zone — Pickup Spawn ────────────────────────────────────────────

  /** Translucent hot-pink cylinder. */
  get zoneCyl() {
    return this._get('zoneCyl', s => makeMat('edZoneCyl', s, {
      diffuse: [1.0, 0.20, 0.60], emissive: [0.25, 0.04, 0.15],
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Translucent bright-pink cylinder (selected). */
  get zoneCylHighlight() {
    return this._get('zoneCylHL', s => makeMat('edZoneCylHL', s, {
      diffuse: [1.0, 0.50, 0.80], emissive: [0.45, 0.15, 0.30],
      alpha: 0.50, backFaceCulling: false,
    }));
  }

  /** Hot-pink handle sphere. */
  get zoneHandle() {
    return this._get('zoneHandle', s => makeMat('edZoneHandle', s, {
      diffuse: [1.0, 0.20, 0.60], emissive: [0.40, 0.05, 0.20],
    }));
  }

  // ── Action Zone — Slow Zone ───────────────────────────────────────────────

  /** Translucent amber cylinder. */
  get slowZoneCyl() {
    return this._get('slowZoneCyl', s => makeMat('edSlowZoneCyl', s, {
      diffuse: [1.0, 0.55, 0.0], emissive: [0.30, 0.12, 0.0],
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Translucent bright-amber cylinder (selected). */
  get slowZoneCylHighlight() {
    return this._get('slowZoneCylHL', s => makeMat('edSlowZoneCylHL', s, {
      diffuse: [1.0, 0.75, 0.2], emissive: [0.50, 0.25, 0.05],
      alpha: 0.50, backFaceCulling: false,
    }));
  }

  /** Amber handle sphere. */
  get slowZoneHandle() {
    return this._get('slowZoneHandle', s => makeMat('edSlowZoneHandle', s, {
      diffuse: [1.0, 0.55, 0.0], emissive: [0.40, 0.18, 0.0],
    }));
  }
}
