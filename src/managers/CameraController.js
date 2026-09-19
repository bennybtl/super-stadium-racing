import { Vector3 } from "@babylonjs/core";

/**
 * CameraController - Handles camera positioning and zoom
 *
 * Modes:
 *   'fixed'      - classic overhead camera, offset is world-space (default)
 *   'isometric'  - same as 'fixed', but the horizontal offset is rotated 45°
 *                  for a diamond-style isometric view
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
    this.mode = 'fixed'; // 'fixed' | 'isometric' | 'chase' | 'chase-low' | 'free'
    this._savedMode = this.mode;

    // Free camera state
    this.freeCameraPosition = null;
    this.freeCameraTarget = null;
    this.freeCameraSpeed = 16;
    this.freeCameraMinDistance = 4;
    this.freeCameraMaxDistance = 200;

    // Screenshot camera fixed position
    this.screenshotCameraPosition = new Vector3(0, 124, -110);
    this.screenshotCameraTarget = new Vector3(0, 0.5, -13);

    // Blend from the pre-switch camera pose to the new mode's over this many
    // seconds, instead of snapping. Re-triggering mid-blend just restarts it
    // from wherever the camera currently is, so rapid cycling stays smooth.
    this.transitionDuration = 0.5;
    this._transition = null; // { t, fromPos: Vector3, fromTarget: Vector3 }
  }

  toggleMode() {
    const modes = ['fixed', 'isometric', 'chase', 'chase-low', 'screenshot'];
    if (this.mode === 'free') {
      const next = (modes.indexOf(this._savedMode) + 1) % modes.length;
      this._savedMode = modes[next];
      return;
    }
    const next = (modes.indexOf(this.mode) + 1) % modes.length;
    this.mode = modes[next];
    // Snap smoothed heading to current on mode switch to avoid a sweep-in from stale value
    this._smoothHeading = 0;
    this._transition = {
      t: 0,
      fromPos: this.camera.position.clone(),
      fromTarget: (this.camera.getTarget ? this.camera.getTarget() : this.camera.target).clone(),
    };
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

    let desiredPos;
    let desiredTarget = targetPosition;

    if (this.mode === 'screenshot') {
      desiredPos = this.screenshotCameraPosition;
      desiredTarget = this.screenshotCameraTarget;
    } else if (this.mode === 'chase' || this.mode === 'chase-low') {
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
      desiredPos = new Vector3(camX, targetPosition.y + height, camZ);
    } else if (this.mode === 'isometric') {
      // Same as 'fixed', but the horizontal offset is rotated 45° around Y so
      // the view lines up diagonally with the world axes (diamond/isometric
      // look) instead of looking straight down the track's -Z axis.
      const rad = Math.PI / 4;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const ox = this.baseOffset.x * cos - this.baseOffset.z * sin;
      const oz = this.baseOffset.x * sin + this.baseOffset.z * cos;
      desiredPos = targetPosition.add(new Vector3(ox, this.baseOffset.y, oz).scale(this.zoomLevel));
    } else {
      // Fixed: world-space offset
      desiredPos = targetPosition.add(this.baseOffset.scale(this.zoomLevel));
    }

    if (this._transition) {
      this._transition.t += dt;
      const progress = Math.min(1, this._transition.t / this.transitionDuration);
      const ease = progress * progress * (3 - 2 * progress); // smoothstep
      this.camera.position.copyFrom(Vector3.Lerp(this._transition.fromPos, desiredPos, ease));
      this.camera.setTarget(Vector3.Lerp(this._transition.fromTarget, desiredTarget, ease));
      if (progress >= 1) this._transition = null;
    } else {
      this.camera.position.copyFrom(desiredPos);
      this.camera.setTarget(desiredTarget);
    }
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
}

