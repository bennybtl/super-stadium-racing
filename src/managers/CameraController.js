import { Vector3 } from "@babylonjs/core";

/**
 * CameraController - Handles camera positioning and zoom
 *
 * Modes:
 *   'fixed'      - classic overhead camera, offset is world-space (default)
 *   'chase'      - camera sits behind and above the truck, rotating with its heading
 *   'chase-low'  - low third-person camera tight behind the truck
 *   'screenshot' - fixed camera position for screenshots
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
    this.mode = 'fixed'; // 'fixed' | 'chase' | 'chase-low' | 'free'
    this._savedMode = this.mode;

    // Free camera state
    this.freeCameraPosition = null;
    this.freeCameraTarget = null;
    this.freeCameraSpeed = 16;
    this.freeCameraMinDistance = 4;
    this.freeCameraMaxDistance = 200;

    // Screenshot camera fixed position
    this.screenshotCameraPosition = new Vector3(7.5, 124, -105);
    this.screenshotCameraTarget = new Vector3(7.5, 0.5, -17);

    // Smoothed heading for chase cam (avoids jarring snaps)
  }

  toggleMode() {
    const modes = ['fixed', 'chase', 'chase-low', 'screenshot'];
    if (this.mode === 'free') {
      const next = (modes.indexOf(this._savedMode) + 1) % modes.length;
      this._savedMode = modes[next];
      return;
    }
    const next = (modes.indexOf(this.mode) + 1) % modes.length;
    this.mode = modes[next];
    // Snap smoothed heading to current on mode switch to avoid a sweep-in from stale value
    this._smoothHeading = 0;
  }

  update(targetPosition, heading = 0, dt = 1/60) {
    if (this.mode === 'free') {
      if (!this.freeCameraPosition) {
        this.freeCameraPosition = this.camera.position.clone();
      }
      if (!this.freeCameraTarget) {
        this.freeCameraTarget = (this.camera.getTarget ? this.camera.getTarget() : this.camera.target).clone();
      }
      this.camera.position.copyFrom(this.freeCameraPosition);
      this.camera.setTarget(this.freeCameraTarget);
      return;
    }

    if (this.mode === 'screenshot') {
      this.camera.position.copyFrom(this.screenshotCameraPosition);
      this.camera.setTarget(this.screenshotCameraTarget);
      return;
    }

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
    if (this.mode === 'free' && this.freeCameraPosition && this.freeCameraTarget) {
      const direction = this.freeCameraTarget.subtract(this.freeCameraPosition);
      const distance = Math.max(this.freeCameraMinDistance, direction.length() - 2);
      direction.normalize();
      this.freeCameraPosition.addInPlace(direction.scale(2));
      if (distance <= this.freeCameraMinDistance) {
        this.freeCameraPosition = this.freeCameraTarget.subtract(direction.scale(this.freeCameraMinDistance));
      }
      console.debug(`Zooming in: distance=${distance.toFixed(2)}`);
      return;
    }
    this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
  }

  zoomOut() {
    if (this.mode === 'free' && this.freeCameraPosition && this.freeCameraTarget) {
      const direction = this.freeCameraTarget.subtract(this.freeCameraPosition).normalize();
      const currentDistance = this.freeCameraTarget.subtract(this.freeCameraPosition).length();
      const nextDistance = Math.min(this.freeCameraMaxDistance, currentDistance + 2);
      this.freeCameraPosition.subtractInPlace(direction.scale(2));
      if (nextDistance >= this.freeCameraMaxDistance) {
        this.freeCameraPosition = this.freeCameraTarget.subtract(direction.scale(this.freeCameraMaxDistance));
      }
      console.debug(`Zooming out: currentDistance=${nextDistance.toFixed(2)}`);
      return;
    }
    this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
  }

  getCurrentZoom() {
    return this.zoomLevel;
  }

  toggleFreeMode() {
    const entering = this.mode !== 'free';
    if (entering) {
      this._savedMode = this.mode;
      this.mode = 'free';
      this.freeCameraPosition = this.camera.position.clone();
      this.freeCameraTarget = (this.camera.getTarget ? this.camera.getTarget() : this.camera.target).clone();
    } else {
      this.mode = this._savedMode || 'fixed';
      this.freeCameraPosition = null;
      this.freeCameraTarget = null;
    }
  }

  moveFreeCamera(input, dt) {
    if (this.mode !== 'free' || !this.freeCameraPosition || !this.freeCameraTarget) return;

    const moveDelta = new Vector3(0, 0, 0);
    const forward = new Vector3(0, 0, 1);
    const right = new Vector3(1, 0, 0);

    if (input.forward) moveDelta.addInPlace(forward);
    if (input.back) moveDelta.subtractInPlace(forward);
    if (input.left) moveDelta.subtractInPlace(right);
    if (input.right) moveDelta.addInPlace(right);

    if (moveDelta.lengthSquared() > 0) {
      moveDelta.normalize().scaleInPlace(this.freeCameraSpeed * dt);
      this.freeCameraPosition.addInPlace(moveDelta);
      this.freeCameraTarget.addInPlace(moveDelta);
      console.debug(`Free camera move: position=${this.freeCameraPosition.toString()}, target=${this.freeCameraTarget.toString()}`);
    }
  }

  setZoom(level) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
  }
}

