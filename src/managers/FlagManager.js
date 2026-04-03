import { Vector3 } from "@babylonjs/core";
import { Flag } from "../objects/Flag.js";
import { TRUCK_RADIUS } from "../constants.js";

/**
 * FlagManager — creates and manages flag objects on the track.
 * Flags are decorative elements that sway when hit by trucks.
 */
export class FlagManager {
  constructor(scene, track, shadows) {
    this.scene = scene;
    this.track = track;
    this.shadows = shadows;

    // Array of Flag instances
    this._flags = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────
  createFlag(feature) {
    const { x, z, color = 'red' } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const flag = new Flag(x, z, color, groundY, this.scene, this.shadows);
    this._flags.push(flag);
  }

  // ─── Per-frame interaction ────────────────────────────────────────────────

  /**
   * Call every frame after trucks have moved.
   * Flags are now static - no physics.
   */
  update(trucks) {
    // Flags are decorative static objects with no physics
    // Kept for future expansion if physics behavior is re-enabled
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this.dispose();
  }

  rebuild() {
    this.dispose();
    for (const feature of this.track.features) {
      if (feature.type === "flag") this.createFlag(feature);
    }
  }

  dispose() {
    for (const flag of this._flags) flag.dispose();
    this._flags = [];
  }
}
