import { Vector3, Color3 } from "@babylonjs/core";
import { Flag, POLE_HEIGHT } from "../objects/Flag.js";
/**
 * FlagTool - Editor tool for placing and managing flags on the track
 */
export class FlagTool {
  constructor(scene, track, editorController) {
    this.scene = scene;
    this.track = track;
    this.editorController = editorController;

    // Flag instances
    this.flags = [];
    this.selectedFlag = null;
  }

  /**
   * Add a new flag at the specified position
   */
  addFlag(x, z) {
    const color = this.editorController._editorStore?.flag?.color || 'red';
    const feature = { 
      type: "flag", 
      x, 
      z, 
      color 
    };
    this.track.features.push(feature);
    this._createFlagMesh(feature);
    this.editorController.saveSnapshot();
  }

  /**
   * Remove the selected flag
   */
  removeSelectedFlag() {
    if (!this.selectedFlag) return;

    const index = this.track.features.indexOf(this.selectedFlag.feature);
    if (index > -1) {
      this.track.features.splice(index, 1);
    }

    this.selectedFlag.dispose();
    const flagIndex = this.flags.indexOf(this.selectedFlag);
    if (flagIndex > -1) {
      this.flags.splice(flagIndex, 1);
    }

    this.selectedFlag = null;
    this.editorController.hideFlagProperties();
    this.editorController.saveSnapshot();
  }

  /**
   * Update the color of the selected flag
   */
  updateSelectedFlagColor(color) {
    if (!this.selectedFlag) return;

    this.selectedFlag.feature.color = color;
    this.selectedFlag.setColor(color);
    
    this.editorController.saveSnapshot();
  }

  /**
   * Move the selected flag to a new position
   */
  moveSelectedFlag(x, z) {
    if (!this.selectedFlag) return;

    this.selectedFlag.feature.x = x;
    this.selectedFlag.feature.z = z;

    const groundY = this.track.getHeightAt(x, z);
    this.selectedFlag.pole.position = new Vector3(x, groundY + POLE_HEIGHT / 2, z);
  }

  /**
   * Create a visual indicator mesh for a flag feature
   */
  _createFlagMesh(feature) {
    const { x, z, color } = feature;
    const groundY = this.track.getHeightAt(x, z);

    // Create a Flag instance (without physics for editor mode)
    const flag = new Flag(x, z, color, groundY, this.scene, null);
    flag.feature = feature; // Attach feature reference
    this.flags.push(flag);
  }

  /**
   * Rebuild all flag meshes from track features
   */
  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "flag") {
        this._createFlagMesh(feature);
      }
    }
  }

  /**
   * Handle click on a flag mesh
   */
  selectFlag(mesh) {
    const flagData = this.flags.find(f => f.pole === mesh || f.flag === mesh);
    if (!flagData) return;

    // Deselect previous
    if (this.selectedFlag && this.selectedFlag !== flagData) {
      const oldColor = this.selectedFlag.feature.color === 'red'
        ? new Color3(0.9, 0.1, 0.1)
        : new Color3(0.1, 0.3, 0.9);
      this.selectedFlag.flag.material.emissiveColor = new Color3(0, 0, 0);
    }

    this.selectedFlag = flagData;
    // Highlight by adding emissive color
    this.selectedFlag.flag.material.emissiveColor = new Color3(0.5, 0.5, 0.5);

    // Update EditorController UI state
    this.editorController.showFlagProperties(flagData);
  }

  /**
   * Deselect the current flag
   */
  deselectFlag() {
    if (this.selectedFlag) {
      this.selectedFlag.flag.material.emissiveColor = new Color3(0, 0, 0);
      this.selectedFlag = null;
    }
    this.editorController.hideFlagProperties();
  }

  /**
   * Get the currently selected flag
   */
  getSelectedFlag() {
    return this.selectedFlag;
  }

  /**
   * Clean up all flag meshes
   */
  dispose() {
    for (const flag of this.flags) {
      flag.dispose();
    }
    this.flags = [];
    this.selectedFlag = null;
  }
}
