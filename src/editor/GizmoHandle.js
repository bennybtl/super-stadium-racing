import { MeshBuilder } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

const DEFAULT_DIAMETER = 1.5;

/**
 * GizmoHandle — the shared pickable sphere that marks a feature in the editor.
 *
 * Features whose own mesh is the visual (signs, decorations, decals) or whose
 * gizmo is a flat/translucent volume (terrain shapes) get one of these floating
 * above them so every feature type has the same grab target and the same
 * selection cue: faint at rest, solid + lit when selected.
 *
 * Colour comes from EditorMaterials.handleMaterials(kind) — see HANDLE_COLORS.
 *
 *   this.handle = new GizmoHandle(scene, 'decoration');
 *   this.handle.setPosition(x, groundY + 3, z);
 *   this.handle.setSelected(true);
 */
export class GizmoHandle {
  /**
   * @param {import('@babylonjs/core').Scene} scene
   * @param {string} kind  key into HANDLE_COLORS ('terrain' | 'sign' | 'decoration' | 'decal' | 'grey')
   */
  constructor(scene, kind, { diameter = DEFAULT_DIAMETER } = {}) {
    this._mats = EditorMaterials.for(scene).handleMaterials(kind);
    this.mesh = MeshBuilder.CreateSphere(`edGizmoHandle_${kind}`, { diameter, segments: 10 }, scene);
    this.mesh.material   = this._mats.handle;
    this.mesh.isPickable = true;
    this.mesh.isVisible  = true;
  }

  setPosition(x, y, z) {
    this.mesh?.position.set(x, y, z);
  }

  setSelected(selected) {
    if (this.mesh) this.mesh.material = selected ? this._mats.selected : this._mats.handle;
  }

  /** Hide/show with the editor's global gizmo toggle. */
  setVisible(visible) {
    if (!this.mesh) return;
    this.mesh.isVisible  = visible;
    this.mesh.isPickable = visible;
  }

  dispose() {
    this.mesh?.dispose();
    this.mesh = null;
  }
}
