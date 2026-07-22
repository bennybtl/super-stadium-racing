import { StandardMaterial, Color3 } from "@babylonjs/core";
import { basicColors } from "../constants";
import { diffusionProfile } from "@babylonjs/core/Shaders/ShadersInclude/diffusionProfile";

export { Color3 };

// ─── Line / emissive Color3 constants ────────────────────────────────────────
// Used directly on CreateLineSystem .color and on material .emissiveColor.
// Centralised here so every colour in the editor lives in one file.

export const LINE_COLOR_MESH_GRID   = basicColors.teal.diffuse; // teal
export const LINE_COLOR_POLY_WALL   = basicColors.orange.diffuse;  // orange
export const LINE_COLOR_POLY_HILL   = basicColors.green.diffuse;  // green
export const LINE_COLOR_POLY_CURB   = basicColors.red.diffuse;  // red
export const LINE_COLOR_BEZIER_WALL = basicColors.blue.diffuse;  // blue
export const EMISSIVE_BLACK         = basicColors.black.emissive; // very dark grey (not pure black, so it shows up in the dark)
export const EMISSIVE_GREY          = basicColors.gray.emissive;
export const FALLBACK_GREY          = basicColors.gray.diffuse;

/**
 * EditorMaterials — a lazily-populated registry of all editor gizmo materials.
 *
 * Materials are created on first access and cached for the lifetime of the
 * Babylon scene they belong to.  Editor classes call `EditorMaterials.for(scene)`
 * to obtain the singleton for their scene, then read named properties:
 *
 *   const m = EditorMaterials.for(scene);
 *   this.normalMat    = m.polyWallNode;
 *   this.highlightMat = m.polyWallNodeSelected;
 *
 * Keeping all colour/material definitions here means colour changes or new
 * zone types only require edits in this one file.
 */

function toColor3(value) {
  if (!value) return null;
  if (value instanceof Color3) return value;
  if (Array.isArray(value) && value.length >= 3) return new Color3(value[0], value[1], value[2]);
  return null;
}

function makeMat(name, scene, { diffuse, emissive, alpha, backFaceCulling } = {}) {
  const mat = new StandardMaterial(name, scene);
  const diffuseColor = toColor3(diffuse);
  const emissiveColor = toColor3(emissive);
  if (diffuseColor) mat.diffuseColor = diffuseColor;
  if (emissiveColor) mat.emissiveColor = emissiveColor;
  if (alpha !== undefined) mat.alpha = alpha;
  if (backFaceCulling !== undefined) mat.backFaceCulling = backFaceCulling;
  return mat;
}

// Alpha every gizmo jumps to when selected — the shared "solid" look.
const SELECTED_ALPHA = 0.9;

/**
 * Selected-state material derived from a gizmo's normal look. The convention
 * across all editors: a selected gizmo keeps its hue but becomes near-opaque
 * (SELECTED_ALPHA) and a touch brighter (emissive boosted), so selection reads
 * consistently as "solid + lit" — no colour change, no yellow. Pass the SAME
 * diffuse/emissive/backFaceCulling as the normal material.
 */
function makeSelectedMat(name, scene, { diffuse, emissive, backFaceCulling } = {}) {
  const e = toColor3(emissive) ?? new Color3(0, 0, 0);
  const lit = new Color3(
    Math.min(1, e.r + 0.25),
    Math.min(1, e.g + 0.25),
    Math.min(1, e.b + 0.25),
  );
  return makeMat(name, scene, { diffuse, emissive: lit, alpha: SELECTED_ALPHA, backFaceCulling });
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

  // Selected-node highlights for the polyline editors. Each keeps its editor's
  // hue (wall = red, hill = green, curb = teal) and goes solid + lit, matching
  // the shared "selected = same colour, solid" convention (previously all yellow).
  get polyWallNodeSelected() {
    return this._get('polyWallNodeSelected', s => makeSelectedMat('edPolyWallNodeSel', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
    }));
  }

  get polyHillNodeSelected() {
    return this._get('polyHillNodeSelected', s => makeSelectedMat('edPolyHillNodeSel', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive,
    }));
  }

  get polyCurbNodeSelected() {
    return this._get('polyCurbNodeSelected', s => makeSelectedMat('edPolyCurbNodeSel', s, {
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive,
    }));
  }

  /** Neutral dark-grey sphere — the click-target handle for round/square hills. */
  get handleSphere() {
    return this._get('handleSphere', s => makeMat('edHandleSphere', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
    }));
  }

  // ── Checkpoint ────────────────────────────────────────────────────────────

  get checkpointHighlight() {
    // Selected = same grey as the normal handle, but solid + lit (not yellow).
    return this._get('checkpointHighlight', s => makeSelectedMat('edCheckpointHL', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
    }));
  }

  // ── Round Hill ────────────────────────────────────────────────────────────

  /** Translucent gray cone gizmo. */
  get hillCone() {
    return this._get('hillCone', s => makeMat('edHillCone', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  /** Solid gray cone gizmo (selected). */
  get hillConeHighlight() {
    return this._get('hillConeHighlight', s => makeSelectedMat('edHillConeHL', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
      backFaceCulling: false,
    }));
  }

  // ── Square Hill ───────────────────────────────────────────────────────────

  /** Translucent gray box gizmo. */
  get squareHillBox() {
    return this._get('squareHillBox', s => makeMat('edSquareHillBox', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
      alpha: 0.20, backFaceCulling: false,
    }));
  }

  /** Solid gray box gizmo (selected). */
  get squareHillBoxHighlight() {
    return this._get('squareHillBoxHighlight', s => makeSelectedMat('edSquareHillBoxHL', s, {
      diffuse: basicColors.gray.diffuse, emissive: basicColors.gray.emissive,
      backFaceCulling: false,
    }));
  }

  // ── Bridge ────────────────────────────────────────────────────────────────

  /** Translucent brown/tan box gizmo. */
  get bridgeBox() {
    return this._get('bridgeBox', s => makeMat('edBridgeBox', s, {
      diffuse: basicColors.brown.diffuse, emissive: basicColors.brown.emissive,
      alpha: 0.25, backFaceCulling: false,
    }));
  }

  /** Solid brown/tan box gizmo (selected). */
  get bridgeBoxHighlight() {
    return this._get('bridgeBoxHighlight', s => makeSelectedMat('edBridgeBoxHL', s, {
      diffuse: basicColors.brown.diffuse, emissive: basicColors.brown.emissive,
      backFaceCulling: false,
    }));
  }

  // ── Bezier Wall ───────────────────────────────────────────────────────────

  /** Blue anchor-point sphere. */
  get bezierAnchor() {
    return this._get('bezierAnchor', s => makeMat('edBezierAnchor', s, {
      diffuse: basicColors.blue.diffuse, emissive: basicColors.blue.emissive, alpha: 0.50,
    }));
  }

  /** Bright blue anchor-point sphere (active wall). */
  get bezierAnchorActive() {
    return this._get('bezierAnchorActive', s => makeMat('edBezierAnchorActive', s, {
      diffuse: basicColors.blue.diffuse, emissive: basicColors.blue.emissive, alpha: 0.90,
    }));
  }

  /** Orange control-handle sphere. */
  get bezierHandle() {
    return this._get('bezierHandle', s => makeMat('edBezierHandle', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive, alpha: 0.50,
    }));
  }

  /** Bright orange-yellow control-handle sphere (selected). */
  get bezierHandleHighlight() {
    return this._get('bezierHandleHighlight', s => makeMat('edBezierHandleHL', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive, alpha: 0.90,
    }));
  }

  // ── Mesh Grid ─────────────────────────────────────────────────────────────

  /** Teal grid-node sphere. */
  get meshGridNode() {
    return this._get('meshGridNode', s => makeMat('edMeshGridNode', s, {
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive,
      alpha: 0.90,
    }));
  }

  /** Solid teal grid-node sphere (selected). */
  get meshGridHighlight() {
    return this._get('meshGridHighlight', s => makeSelectedMat('edMeshGridHL', s, {
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive,
    }));
  }

  // ── Poly Curb ─────────────────────────────────────────────────────────────

  /** Teal node sphere (inactive wall). */
  get polyCurbNode() {
    return this._get('polyCurbNode', s => makeMat('edPolyCurbNode', s, {
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive, alpha: 0.50,
    }));
  }

  /** Bright teal node sphere (active wall). */
  get polyCurbNodeActive() {
    return this._get('polyCurbNodeActive', s => makeMat('edPolyCurbNodeActive', s, {
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive, alpha: 0.90,
    }));
  }

  // ── Poly Hill ─────────────────────────────────────────────────────────────

  /** Olive-green node sphere (inactive hill). */
  get polyHillNode() {
    return this._get('polyHillNode', s => makeMat('edPolyHillNode', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive, alpha: 0.50,
    }));
  }

  /** Bright green node sphere (active hill). */
  get polyHillNodeActive() {
    return this._get('polyHillNodeActive', s => makeMat('edPolyHillNodeActive', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive, alpha: 0.90,
    }));
  }

  // ── Poly Wall ─────────────────────────────────────────────────────────────

  /** Orange node sphere (inactive wall). */
  get polyWallNode() {
    return this._get('polyWallNode', s => makeMat('edPolyWallNode', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
      alpha: 0.50,
    }));
  }

  /** Bright orange node sphere (active wall). */
  get polyWallNodeActive() {
    return this._get('polyWallNodeActive', s => makeMat('edPolyWallNodeActive', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
      alpha: 0.90,
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

  /** Solid blue shape gizmo (selected). */
  get terrainShapeHighlight() {
    return this._get('terrainShapeHL', s => makeSelectedMat('edTerrainShapeHL', s, {
      diffuse: [0.2, 0.5, 0.9], emissive: [0.04, 0.1, 0.2],
      backFaceCulling: false,
    }));
  }

  // ── Obstacle ──────────────────────────────────────────────────────────────

  /** Grey handle sphere. */
  get obstacleHandle() {
    return this._get('obstacleHandle', s => makeMat('edObstacleHandle', s, {
      diffuse: [0.6, 0.6, 0.6], emissive: [0.1, 0.1, 0.1],
    }));
  }

  /** Solid grey handle sphere (selected). */
  get obstacleHandleHighlight() {
    return this._get('obstacleHandleHL', s => makeSelectedMat('edObstacleHandleHL', s, {
      diffuse: [0.6, 0.6, 0.6], emissive: [0.1, 0.1, 0.1],
    }));
  }

  /** Color-tinted obstacle material. */
  obstaclePaint(color = 'yellow') {
    const key = `obstaclePaint:${color}`;
    return this._get(key, s => {
      const colorMap = {
        white:  basicColors.white,
        red:    basicColors.red,
        blue:   basicColors.blue,
        yellow: basicColors.yellow,
        black:  basicColors.black,
      };
      const swatch = colorMap[color] ?? basicColors.yellow;
      const mat = new StandardMaterial(`edObstaclePaint_${color}`, s);
      mat.diffuseColor  = swatch.diffuse;
      mat.emissiveColor = new Color3(0.0, 0.0, 0.0);
      mat.specularColor = new Color3(0.12, 0.12, 0.12);
      mat.specularPower = 16;
      return mat;
    });
  }

  // ── Action Zone — Pickup Spawn ────────────────────────────────────────────

  /** Translucent hot-pink cylinder. */
  get zoneCyl() {
    return this._get('zoneCyl', s => makeMat('edZoneCyl', s, {
      diffuse: basicColors.magenta.diffuse, emissive: basicColors.magenta.emissive,
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Solid pink cylinder (selected). */
  get zoneCylHighlight() {
    return this._get('zoneCylHL', s => makeSelectedMat('edZoneCylHL', s, {
      diffuse: basicColors.magenta.diffuse, emissive: basicColors.magenta.emissive,
      backFaceCulling: false,
    }));
  }

  /** Hot-pink handle sphere. */
  get zoneHandle() {
    return this._get('zoneHandle', s => makeMat('edZoneHandle', s, {
      diffuse: basicColors.magenta.diffuse, emissive: basicColors.magenta.emissive,
    }));
  }

  /** Hot-pink handle sphere (selected point). */
  get zoneHandleHighlight() {
    return this._get('zoneHandleHL', s => makeSelectedMat('edZoneHandleHL', s, {
      diffuse: basicColors.magenta.diffuse, emissive: basicColors.magenta.emissive,
    }));
  }

  // ── Action Zone — Slow Zone ───────────────────────────────────────────────

  /** Translucent amber cylinder. */
  get slowZoneCyl() {
    return this._get('slowZoneCyl', s => makeMat('edSlowZoneCyl', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive,
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Solid amber cylinder (selected). */
  get slowZoneCylHighlight() {
    return this._get('slowZoneCylHL', s => makeSelectedMat('edSlowZoneCylHL', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive,
      backFaceCulling: false,
    }));
  }

  /** Amber handle sphere. */
  get slowZoneHandle() {
    return this._get('slowZoneHandle', s => makeMat('edSlowZoneHandle', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive,
    }));
  }

  /** Amber handle sphere (selected point). */
  get slowZoneHandleHighlight() {
    return this._get('slowZoneHandleHL', s => makeSelectedMat('edSlowZoneHandleHL', s, {
      diffuse: basicColors.orange.diffuse, emissive: basicColors.orange.emissive,
    }));
  }

  // ── Action Zone — Out of Bounds ─────────────────────────────────────────

  /** Translucent red cylinder. */
  get outOfBoundsZoneCyl() {
    return this._get('outOfBoundsZoneCyl', s => makeMat('edOutOfBoundsZoneCyl', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Solid red cylinder (selected). */
  get outOfBoundsZoneCylHighlight() {
    return this._get('outOfBoundsZoneCylHL', s => makeSelectedMat('edOutOfBoundsZoneCylHL', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
      backFaceCulling: false,
    }));
  }

  /** Red handle sphere. */
  get outOfBoundsZoneHandle() {
    return this._get('outOfBoundsZoneHandle', s => makeMat('edOutOfBoundsZoneHandle', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
    }));
  }

  /** Red handle sphere (selected point). */
  get outOfBoundsZoneHandleHighlight() {
    return this._get('outOfBoundsZoneHandleHL', s => makeSelectedMat('edOutOfBoundsZoneHandleHL', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
    }));
  }

  // ── Action Zone — Speed Boost ───────────────────────────────────────────

  /** Translucent green cylinder. */
  get speedBoostZoneCyl() {
    return this._get('speedBoostZoneCyl', s => makeMat('edSpeedBoostZoneCyl', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive,
      alpha: 0.28, backFaceCulling: false,
    }));
  }

  /** Solid green cylinder (selected). */
  get speedBoostZoneCylHighlight() {
    return this._get('speedBoostZoneCylHL', s => makeSelectedMat('edSpeedBoostZoneCylHL', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive,
      backFaceCulling: false,
    }));
  }

  /** Green handle sphere. */
  get speedBoostZoneHandle() {
    return this._get('speedBoostZoneHandle', s => makeMat('edSpeedBoostZoneHandle', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive,
    }));
  }

  /** Green handle sphere (selected point). */
  get speedBoostZoneHandleHighlight() {
    return this._get('speedBoostZoneHandleHL', s => makeSelectedMat('edSpeedBoostZoneHandleHL', s, {
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive,
    }));
  }
}
