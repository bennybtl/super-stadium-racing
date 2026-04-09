import { Vector3 } from "@babylonjs/core";

/**
 * CameraController - Handles camera positioning and zoom
 *
 * Modes:
 *   'fixed'      - classic overhead camera, offset is world-space (default)
 *   'chase'      - camera sits behind and above the truck, rotating with its heading
 *   'chase-low'  - low third-person camera tight behind the truck
 */
export class CameraController {
  constructor(camera, baseOffset = new Vector3(0, 28, -20)) {
    this.camera = camera;
    this.baseOffset = baseOffset;

    // Zoom settings
    this.zoomLevel = 2.0;
    this.minZoom = 0.5;
    this.maxZoom = 2.5;
    this.zoomStep = 0.1;

    // Camera mode
    this.mode = 'fixed'; // 'fixed' | 'chase'

    // Smoothed heading for chase cam (avoids jarring snaps)
    this._smoothHeading = 0;
  }

  toggleMode() {
    const modes = ['fixed', 'chase', 'chase-low'];
    const next = (modes.indexOf(this.mode) + 1) % modes.length;
    this.mode = modes[next];
    // Snap smoothed heading to current on mode switch to avoid a sweep-in from stale value
    // (heading gets passed on the next update call, so we reset to 0 and let it catch up)
  }

  update(targetPosition, heading = 0, dt = 1/60) {
    if (this.mode === 'chase' || this.mode === 'chase-low') {
      // Lerp the smoothed heading toward the truck heading via the shortest arc
      let diff = heading - this._smoothHeading;
      // Wrap diff into [-π, π]
      diff = ((diff + Math.PI) % (2 * Math.PI)) - Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      this._smoothHeading += diff * Math.min(1, dt * 5);

      // Offset is relative to the smoothed heading:
      // sit behind (−Z in local space) and above
      let dist   = -this.baseOffset.z * this.zoomLevel; // baseOffset.z is negative, negate to get behind-truck distance
      let height = this.baseOffset.y * this.zoomLevel;
      if (this.mode === 'chase-low') {
        // Low and close — 8 units back, 3 units above ground
        dist   = 16 * this.zoomLevel;
        height = 6 * this.zoomLevel;
      }
      const camX = targetPosition.x - Math.sin(this._smoothHeading) * dist;
      const camZ = targetPosition.z - Math.cos(this._smoothHeading) * dist;
      this.camera.position.x = camX;
      this.camera.position.y = targetPosition.y + height;
      this.camera.position.z = camZ;
    } else {
      // Fixed: world-space offset
      const offset = this.baseOffset.scale(this.zoomLevel);
      const targetCamPos = targetPosition.add(offset);
      this.camera.position.x = targetCamPos.x;
      this.camera.position.y = targetCamPos.y;
      this.camera.position.z = targetCamPos.z;
    }

    this.camera.setTarget(targetPosition);
  }

  zoomIn() {
    this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
  }

  zoomOut() {
    this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
  }

  getCurrentZoom() {
    return this.zoomLevel;
  }

  setZoom(level) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
  }
}
