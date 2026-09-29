import { Vector3 } from "@babylonjs/core";
import { loadGameplaySettings } from "../settingsStorage.js";

// Gameplay setting "Camera Shake". Module-level (one listener, not one per
// CameraController) since controllers are made per mode with no dispose hook.
let shakeEnabled = loadGameplaySettings().cameraShake !== false;
if (typeof window !== "undefined") {
  window.addEventListener("offroad:gameplay-settings-changed", (event) => {
    shakeEnabled = (event?.detail ?? loadGameplaySettings()).cameraShake !== false;
  });
}

// ── Motion feel (driving cameras) ─────────────────────────────────────────
// All three are fed by the truck velocity passed to update(); set a constant
// to 0 to switch its effect off.
// Look-ahead (overhead modes only): aim ahead of the truck along its travel,
// so upcoming corners come on screen sooner.
const LOOK_AHEAD_S = 0.35;      // aim this many seconds of travel ahead…
const LOOK_AHEAD_MAX = 7;       // …capped, metres
const LOOK_AHEAD_RATE = 2.5;    // 1/s — how quickly the aim point settles
// Speed pull-back: widen the view a little at speed.
const SPEED_ZOOM = 0.08;        // extra distance fraction at SPEED_ZOOM_REF
const SPEED_ZOOM_REF = 30;      // m/s — base top speed
const SPEED_ZOOM_RATE = 1.5;    // 1/s
// Impact shake: a sudden velocity change (wall hit, truck-truck hit, hard
// landing) adds "trauma"; the shake is trauma², so small knocks barely move
// the view while big hits rattle it. Translation only — no roll.
const SHAKE_MIN_DV = 4;         // m/s change in one frame that counts as a hit
const SHAKE_FULL_DV = 16;       // m/s change that maxes the shake
const SHAKE_DECAY = 1.8;        // trauma lost per second
const SHAKE_MAX_OFFSET = 0.3;   // metres at zoom 1 (scales with zoom)
const TELEPORT_JUMP = 5;        // m in one frame = respawn, not a hit

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

    // Motion-feel state (see constants at the top).
    this._lookAhead = new Vector3();
    this._speedZoom = 0;
    this._trauma = 0;
    this._shakeTime = 0;
    this._prevVel = null;
    this._prevPos = null;
  }

  /** Add impact shake, 0..1 (accumulates, capped at 1). No-op when the setting is off. */
  addShake(amount) {
    if (!shakeEnabled) return;
    this._trauma = Math.min(1, this._trauma + amount);
  }

  _updateMotion(targetPosition, velocity, dt) {
    const k = (rate) => Math.min(1, dt * rate);
    if (!velocity) {
      this._prevVel = this._prevPos = null;
    } else {
      // Impact detection from the frame-to-frame velocity change.
      if (this._prevVel && Vector3.Distance(targetPosition, this._prevPos) < TELEPORT_JUMP) {
        const dv = Math.hypot(
          velocity.x - this._prevVel.x, velocity.y - this._prevVel.y, velocity.z - this._prevVel.z,
        );
        if (dv > SHAKE_MIN_DV) this.addShake(Math.min(1, (dv - SHAKE_MIN_DV) / (SHAKE_FULL_DV - SHAKE_MIN_DV)));
      }
      (this._prevVel ??= new Vector3()).copyFrom(velocity);
      (this._prevPos ??= new Vector3()).copyFrom(targetPosition);

      const hx = velocity.x, hz = velocity.z;
      const speed = Math.hypot(hx, hz);
      const ahead = Math.min(LOOK_AHEAD_MAX, speed * LOOK_AHEAD_S);
      const s = speed > 0.5 ? ahead / speed : 0;
      this._lookAhead.x += (hx * s - this._lookAhead.x) * k(LOOK_AHEAD_RATE);
      this._lookAhead.z += (hz * s - this._lookAhead.z) * k(LOOK_AHEAD_RATE);
      const zoomTarget = SPEED_ZOOM * Math.min(1.5, speed / SPEED_ZOOM_REF);
      this._speedZoom += (zoomTarget - this._speedZoom) * k(SPEED_ZOOM_RATE);
    }
    this._trauma = Math.max(0, this._trauma - SHAKE_DECAY * dt);
    this._shakeTime += dt;
  }

  /** Smooth pseudo-random offset for the current trauma, world metres. */
  _shakeOffset() {
    const amp = this._trauma * this._trauma * SHAKE_MAX_OFFSET * this.zoomLevel;
    if (amp <= 0) return null;
    const t = this._shakeTime;
    const n = (a, b, c) => (Math.sin(t * a + c) + 0.5 * Math.sin(t * b + c * 1.7)) / 1.5;
    return new Vector3(n(31, 57, 0.3), n(27, 49, 1.9), n(35, 61, 4.1)).scaleInPlace(amp);
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

  /**
   * @param {Vector3} targetPosition  truck (rendered) position
   * @param {number}  heading
   * @param {number}  dt              frame seconds
   * @param {Vector3} [velocity]      truck velocity — enables look-ahead,
   *   speed pull-back and impact shake; omit for a plain follow camera
   */
  update(targetPosition, heading = 0, dt = 1/60, velocity = null) {
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

    this._updateMotion(targetPosition, velocity, dt);
    const zoom = this.zoomLevel * (1 + this._speedZoom);

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
      let dist   = -this.baseOffset.z * zoom; // baseOffset.z is negative, negate to get behind-truck distance
      let height = this.baseOffset.y * zoom;
      if (this.mode === 'chase-low') {
        // Low and close — 8 units back, 3 units above ground
        dist   = 16 * zoom;
        height = 6 * zoom;
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
      desiredTarget = targetPosition.add(this._lookAhead);
      desiredPos = desiredTarget.add(new Vector3(ox, this.baseOffset.y, oz).scale(zoom));
    } else {
      // Fixed: world-space offset
      desiredTarget = targetPosition.add(this._lookAhead);
      desiredPos = desiredTarget.add(this.baseOffset.scale(zoom));
    }

    if (this.mode !== 'screenshot') {
      const shake = this._shakeOffset();
      if (shake) {
        desiredPos = desiredPos.add(shake);
        desiredTarget = desiredTarget.add(shake);
      }
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

