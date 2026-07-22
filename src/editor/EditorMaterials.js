import { StandardMaterial, Color3 } from "@babylonjs/core";
import { basicColors } from "../constants";

export { Color3 };

// ─── Line / emissive Color3 constants ────────────────────────────────────────
// Used directly on CreateLineSystem .color and on material .emissiveColor.
// Centralised here so every colour in the editor lives in one file.

export const LINE_COLOR_MESH_GRID   = basicColors.teal.diffuse; // teal
export const LINE_COLOR_POLY_WALL   = basicColors.orange.diffuse;  // orange
export const LINE_COLOR_POLY_HILL   = basicColors.green.diffuse;  // green
export const LINE_COLOR_POLY_CURB   = basicColors.red.diffuse;  // red
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

function makeMat(name, scene, { diffuse, emissive, alpha, backFaceCulling, specular } = {}) {
  const mat = new StandardMaterial(name, scene);
  const diffuseColor = toColor3(diffuse);
  const emissiveColor = toColor3(emissive);
  const specularColor = toColor3(specular);
  if (diffuseColor) mat.diffuseColor = diffuseColor;
  if (emissiveColor) mat.emissiveColor = emissiveColor;
  if (specularColor) mat.specularColor = specularColor;
  if (alpha !== undefined) mat.alpha = alpha;
  if (backFaceCulling !== undefined) mat.backFaceCulling = backFaceCulling;
  return mat;
}

// The two shared gizmo alphas. Selection everywhere reads as RESTING → SELECTED
// with the hue unchanged. Exported so editors that build per-feature materials
// by hand (TerrainPathEditor) use the same numbers.
export const RESTING_ALPHA  = 0.50;
export const SELECTED_ALPHA = 0.90;

/**
 * Selected-state material derived from a gizmo's normal look. The convention
 * across all editors: a selected gizmo keeps its hue but becomes near-opaque
 * (SELECTED_ALPHA) and a touch brighter (emissive boosted), so selection reads
 * consistently as "solid + lit" — no colour change, no yellow. Pass the SAME
 * diffuse/emissive/backFaceCulling/specular as the normal material.
 */
function makeSelectedMat(name, scene, { diffuse, emissive, backFaceCulling, specular } = {}) {
  const e = toColor3(emissive) ?? new Color3(0, 0, 0);
  const lit = new Color3(
    Math.min(1, e.r + 0.25),
    Math.min(1, e.g + 0.25),
    Math.min(1, e.b + 0.25),
  );
  return makeMat(name, scene, { diffuse, emissive: lit, alpha: SELECTED_ALPHA, backFaceCulling, specular });
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

  /**
   * Handle-sphere material pair `{ handle, selected }` for a feature kind — the
   * shared click-target gizmo. Every kind is the same sphere differing only by
   * hue, so they're generated from HANDLE_COLORS (cached per kind).
   */
  handleMaterials(kind) {
    return this._get(`handle:${kind}`, s => {
      const c = HANDLE_COLORS[kind] ?? HANDLE_COLORS.grey;
      const hue = { diffuse: c.diffuse, emissive: c.emissive };
      return {
        handle:   makeMat(`edHandle_${kind}`, s, { ...hue, alpha: RESTING_ALPHA }),
        selected: makeSelectedMat(`edHandleSel_${kind}`, s, hue),
      };
    });
  }

  /** Neutral grey handle — hills, checkpoint, obstacle. Faint until selected. */
  get handleSphere()          { return this.handleMaterials('grey').handle; }
  get handleSphereHighlight() { return this.handleMaterials('grey').selected; }

  // NB: round/square hills have no volume gizmo — their `node` is a bare
  // TransformNode used for placement only, so the sole gizmo is the handle
  // sphere above. (Dead hillCone/squareHillBox materials were removed.)

  // ── AI Path ───────────────────────────────────────────────────────────────
  // Waypoints keep their hue in both states (main = yellow, branch = cyan) and
  // signal selection with the shared alpha jump — they used to swap yellow→orange.

  /** Yellow waypoint sphere (main path). */
  get aiWaypoint() {
    return this._get('aiWaypoint', s => makeMat('edAiWaypoint', s, {
      ...AI_WAYPOINT_MAIN, alpha: RESTING_ALPHA,
    }));
  }

  /** Solid yellow waypoint sphere (selected). */
  get aiWaypointSelected() {
    return this._get('aiWaypointSel', s => makeSelectedMat('edAiWaypointSel', s, AI_WAYPOINT_MAIN));
  }

  /** Cyan waypoint sphere (branch path). */
  get aiWaypointBranch() {
    return this._get('aiWaypointBranch', s => makeMat('edAiWaypointBranch', s, {
      ...AI_WAYPOINT_BRANCH, alpha: RESTING_ALPHA,
    }));
  }

  /** Solid cyan waypoint sphere (selected branch). */
  get aiWaypointBranchSelected() {
    return this._get('aiWaypointBranchSel', s => makeSelectedMat('edAiWaypointBranchSel', s, AI_WAYPOINT_BRANCH));
  }

  // ── Terrain Path ──────────────────────────────────────────────────────────

  /**
   * Clone template for terrain-path waypoints. Each waypoint clones this and
   * re-tints it with its feature's terrain colour, so the green here is only a
   * fallback — what matters is the shared alpha/specular baseline.
   */
  get terrainPathWaypoint() {
    return this._get('terrainPathWaypoint', s => makeMat('edTerrainPathWpt', s, {
      diffuse: [0.2, 0.8, 0.4], emissive: [0.1, 0.3, 0.15],
      specular: [0, 0, 0], alpha: RESTING_ALPHA,
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
      diffuse: basicColors.teal.diffuse, emissive: basicColors.teal.emissive, alpha: RESTING_ALPHA,
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
      diffuse: basicColors.green.diffuse, emissive: basicColors.green.emissive, alpha: RESTING_ALPHA,
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
      alpha: RESTING_ALPHA,
    }));
  }

  /** Bright orange node sphere (active wall). */
  get polyWallNodeActive() {
    return this._get('polyWallNodeActive', s => makeMat('edPolyWallNodeActive', s, {
      diffuse: basicColors.red.diffuse, emissive: basicColors.red.emissive,
      alpha: 0.90,
    }));
  }

  // ── Obstacle ──────────────────────────────────────────────────────────────

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

  // ── Action Zones ──────────────────────────────────────────────────────────

  /**
   * Material set for an action zone: `{ cyl, highlight, handle, handleHighlight }`.
   * All four zone types share the same translucent-cylinder + handle-sphere gizmo
   * and differ only by hue, so the set is generated from a colour table (cached
   * per zoneType) instead of four near-identical blocks of getters.
   */
  zoneMaterials(zoneType) {
    return this._get(`zone:${zoneType}`, s => {
      const c = ZONE_COLORS[zoneType] ?? ZONE_COLORS.pickupSpawn;
      const hue = { diffuse: c.diffuse, emissive: c.emissive };
      return {
        cyl:             makeMat(`edZoneCyl_${zoneType}`, s, { ...hue, alpha: 0.28, backFaceCulling: false }),
        highlight:       makeSelectedMat(`edZoneCylHL_${zoneType}`, s, { ...hue, backFaceCulling: false }),
        // Handles are faint until selected, matching the poly-node convention.
        handle:          makeMat(`edZoneHandle_${zoneType}`, s, { ...hue, alpha: RESTING_ALPHA }),
        handleHighlight: makeSelectedMat(`edZoneHandleHL_${zoneType}`, s, hue),
      };
    });
  }
}

/** Light brown — terrain-shape handles. basicColors.brown is far darker. */
const LIGHT_BROWN = {
  diffuse:  new Color3(0.76, 0.60, 0.42),
  emissive: new Color3(0.20, 0.15, 0.10),
};

/** Per-feature handle-sphere hue, used by EditorMaterials.handleMaterials(kind). */
const HANDLE_COLORS = {
  grey:       basicColors.gray,   // hills, checkpoint, obstacle
  terrain:    LIGHT_BROWN,        // terrain shape
  sign:       basicColors.black,  // track signs
  decoration: basicColors.green,  // flags / decorations / banners
  decal:      basicColors.white,  // surface decals
};

// AI-path waypoint hues. Specular is zeroed so the small spheres read flat.
const AI_WAYPOINT_MAIN   = { diffuse: [1, 0.85, 0],    emissive: [0.4, 0.3, 0],     specular: [0, 0, 0] };
const AI_WAYPOINT_BRANCH = { diffuse: [0.2, 0.85, 1],  emissive: [0.08, 0.32, 0.4], specular: [0, 0, 0] };

/** Per-zone-type gizmo hue. Line colours are tuned separately in ActionZoneEditor. */
const ZONE_COLORS = {
  pickupSpawn: basicColors.magenta,
  slowZone:    basicColors.orange,
  outOfBounds: basicColors.red,
  speedBoost:  basicColors.green,
};
