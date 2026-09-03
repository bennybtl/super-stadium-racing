import { MeshBuilder, Vector3 } from "@babylonjs/core";
import { TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH, basicColors } from "../constants.js";
import { TruckBody } from "../truck/TruckBody.js";

// Shortest signed angular difference from `a` to `b` (handles wraparound).
function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** How fast the puppet chases its latest network snapshot (s⁻¹). Higher =
 *  snappier but jitterier; this is smoothing, not full dead-reckoning, since
 *  state arrives every ~65ms (~15Hz) which the smoothing comfortably covers. */
const CHASE_RATE = 10;

/**
 * Visual-only stand-in for another player's truck, driven by state snapshots
 * relayed over the network (see MultiplayerClient). Same puppet-on-a-box
 * approach as GhostPlayer, but solid (not translucent) and chases a live
 * target instead of replaying a fixed recording.
 */
export class RemotePuppet {
  constructor(scene, shadows, { dims = null, vehicleDef = null, colorKey = null } = {}) {
    this.scene = scene;

    this._root = MeshBuilder.CreateBox("mpRoot", {
      width:  dims?.width  ?? TRUCK_WIDTH,
      height: dims?.height ?? TRUCK_HEIGHT,
      depth:  dims?.depth  ?? TRUCK_DEPTH,
    }, scene);
    this._root.isVisible = false;
    this._root.isPickable = false;
    this._root.rotationQuaternion = null;

    const color = colorKey ? basicColors[colorKey]?.diffuse : null;
    this._body = new TruckBody(this._root, scene, shadows, { body: color }, vehicleDef, {});
    this._state = { heading: 0, velocity: new Vector3(), suspensionCompression: 0 };
    this._noInput = { left: false, right: false, forward: false, back: false };

    this._target = new Vector3();
    this._targetHeading = 0;
    this._hasTarget = false;
  }

  /** Latest known world position/heading for this player. */
  setTarget(x, y, z, heading) {
    if (!this._hasTarget) {
      // First sample: snap immediately rather than sliding in from the origin.
      this._root.position.set(x, y, z);
      this._root.rotation.y = heading;
    }
    this._target.set(x, y, z);
    this._targetHeading = heading;
    this._hasTarget = true;
  }

  update(dt) {
    if (!this._hasTarget || !(dt > 0)) return;

    const alpha = 1 - Math.exp(-CHASE_RATE * dt);
    const prevX = this._root.position.x;
    const prevY = this._root.position.y;
    const prevZ = this._root.position.z;

    this._root.position.x += (this._target.x - prevX) * alpha;
    this._root.position.y += (this._target.y - prevY) * alpha;
    this._root.position.z += (this._target.z - prevZ) * alpha;
    const heading = this._root.rotation.y + angleDelta(this._root.rotation.y, this._targetHeading) * alpha;
    this._root.rotation.y = heading;

    // Synthesize motion state from the interpolated movement so wheels spin
    // and the sprung-mass body dynamics have something to react to.
    this._state.velocity.set(
      (this._root.position.x - prevX) / dt,
      (this._root.position.y - prevY) / dt,
      (this._root.position.z - prevZ) / dt,
    );
    this._state.heading = heading;
    const speed = Math.hypot(this._state.velocity.x, this._state.velocity.z);
    this._body.update(this._state, this._noInput, speed, dt, null, 0, null);
  }

  setVisible(v) {
    this._root.setEnabled(v);
  }

  dispose() {
    this._body?.dispose();
    this._root?.dispose();
    this._body = null;
    this._root = null;
  }
}
