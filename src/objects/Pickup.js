import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
} from "@babylonjs/core";

/**
 * Pickup — a single collectable item floating above the ground.
 *
 * Visual: a spinning octahedron core inside a slowly-rotating torus ring.
 * Bobs gently up and down via per-frame update().
 *
 * Supported types:
 *   'boost' — awards +1 nitro boost to the collecting truck
 */
export class Pickup {
  /**
   * @param {number}              x
   * @param {number}              z
   * @param {number}              groundY  - terrain height at (x, z)
   * @param {string}              type     - pickup type identifier
   * @param {BABYLON.Scene}       scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(x, z, groundY, type, scene, shadows) {
    this.type   = type;
    this.scene  = scene;
    this._baseY = groundY + 1.2;
    this._time  = Math.random() * Math.PI * 2; // random phase so pickups don't all bob in sync

    // Root transform — position drives the bob animation
    this._root = new TransformNode(`pickup_${type}_${x}_${z}`, scene);
    this._root.position = new Vector3(x, this._baseY, z);

    // ── Core octahedron ──────────────────────────────────────────────────
    this._core = MeshBuilder.CreatePolyhedron(
      `pickup_core_${x}_${z}`,
      { type: 1, size: 0.52 },
      scene
    );
    this._core.parent = this._root;

    const coreMat = new StandardMaterial(`pickupCoreMat_${x}_${z}`, scene);
    coreMat.diffuseColor  = new Color3(1.0, 0.85, 0.0);
    coreMat.emissiveColor = new Color3(0.6, 0.35, 0.0);
    coreMat.specularColor = new Color3(1.0, 1.0, 0.5);
    coreMat.specularPower = 16;
    this._core.material = coreMat;
    shadows.addShadowCaster(this._core);

    // ── Outer ring ───────────────────────────────────────────────────────
    this._ring = MeshBuilder.CreateTorus(
      `pickup_ring_${x}_${z}`,
      { diameter: 1.6, thickness: 0.07, tessellation: 28 },
      scene
    );
    this._ring.parent = this._root;

    const ringMat = new StandardMaterial(`pickupRingMat_${x}_${z}`, scene);
    ringMat.diffuseColor  = new Color3(1.0, 0.95, 0.1);
    ringMat.emissiveColor = new Color3(0.5, 0.3, 0.0);
    ringMat.specularColor = new Color3(1.0, 1.0, 0.5);
    this._ring.material = ringMat;
    shadows.addShadowCaster(this._ring);
  }

  // ── Public ────────────────────────────────────────────────────────────────

  /** World position of the pickup (XZ centre matters for collision). */
  get position() { return this._root.position; }

  /** Whether this pickup is currently active and visible. */
  get isVisible() { return this._root.isEnabled(); }

  setVisible(v) { this._root.setEnabled(v); }

  /**
   * Animate the pickup — call once per frame regardless of visibility so
   * the phase counter stays continuous and the pickup looks right when
   * it reappears after a respawn delay.
   */
  update(dt) {
    this._time += dt;
    if (!this.isVisible) return;
    // Gentle vertical bob
    this._root.position.y = this._baseY + Math.sin(this._time * 2.5) * 0.18;
    // Spin core on two axes for a jewel-tumble effect
    this._core.rotation.y = this._time * 2.2;
    this._core.rotation.x = this._time * 0.9;
    // Counter-rotate ring slowly
    this._ring.rotation.z = this._time * 1.1;
  }

  dispose() {
    this._core.material?.dispose();
    this._ring.material?.dispose();
    this._core.dispose();
    this._ring.dispose();
    this._root.dispose();
  }
}
