import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
} from "@babylonjs/core";

/**
 * CheckpointArrow - A floating yellow arrow above the player's truck that
 * points toward the next checkpoint.
 */
export class CheckpointArrow {
  constructor(scene) {
    this.scene = scene;
    this._time = 0;

    // ── Materials ──────────────────────────────────────────────────────────
    this._mat = new StandardMaterial("cpArrowMat", scene);
    this._mat.diffuseColor  = new Color3(1.0, 0.85, 0.0);
    this._mat.emissiveColor = new Color3(0.6, 0.45, 0.0);
    this._mat.specularColor = new Color3(0.2, 0.2, 0.0);

    // ── Root node (position follows truck + bob) ───────────────────────────
    this._root = new TransformNode("cpArrowRoot", scene);

    // ── Arrow shaft ───────────────────────────────────────────────────────
    // Cylinder height is along local Y by default. rotation.x = PI/2 tips it
    // so it lies along +Z — matching BJS's rotation.y = 0 → facing +Z convention.
    this._shaft = MeshBuilder.CreateCylinder("cpArrowShaft", {
      height: 1.8,
      diameter: 0.22,
      tessellation: 10,
    }, scene);
    this._shaft.material = this._mat;
    this._shaft.parent = this._root;
    // rotation.x = PI/2 tips the cylinder from +Y to +Z (BJS convention)
    this._shaft.rotation.x = Math.PI / 2;
    this._shaft.position.z = 0.9; // centre of shaft along +Z

    // ── Arrowhead ─────────────────────────────────────────────────────────
    this._head = MeshBuilder.CreateCylinder("cpArrowHead", {
      height: 0.7,
      diameterBottom: 0.55,
      diameterTop: 0,
      tessellation: 10,
    }, scene);
    this._head.material = this._mat;
    this._head.parent = this._root;
    // Same rotation: cone tip (+Y) → +Z
    this._head.rotation.x = Math.PI / 2;
    this._head.position.z = 1.8 + 0.35;  // shaft end + half head

    // ── Shadow ring on ground (optional, helps visibility) ────────────────
    this._ring = MeshBuilder.CreateTorus("cpArrowRing", {
      diameter: 0.5,
      thickness: 0.06,
      tessellation: 18,
    }, scene);
    const ringMat = new StandardMaterial("cpArrowRingMat", scene);
    ringMat.diffuseColor  = new Color3(1.0, 0.85, 0.0);
    ringMat.emissiveColor = new Color3(0.4, 0.35, 0.0);
    ringMat.alpha = 0.5;
    this._ring.material = ringMat;
    this._ring.parent = this._root;
    this._ring.position.y = -3.5; // sit just above ground relative to root
    this._ring.rotation.x = Math.PI / 2; // lay flat

    this.setVisible(false);
  }

  /**
   * Call once per frame in the game loop.
   * @param {Vector3}  truckPosition     - World position of the player truck.
   * @param {Object}   checkpointManager - The CheckpointManager instance.
   * @param {number}   lastCheckpointPassed - Number of the last checkpoint passed (0 = none yet).
   */
  update(truckPosition, checkpointManager, lastCheckpointPassed) {
    this._time += this.scene.getEngine().getDeltaTime() / 1000;

    // Find the next checkpoint feature
    const nextNumber = lastCheckpointPassed + 1;
    let target = null;

    for (const cp of checkpointManager.checkpointMeshes) {
      if (cp.feature.checkpointNumber === nextNumber) {
        target = cp.feature;
        break;
      }
    }

    if (!target) {
      // No next checkpoint (race finished or no checkpoints)
      this.setVisible(false);
      return;
    }

    this.setVisible(true);

    // ── Position: hover 4.5 units above the truck with a gentle bob ───────
    const bobY = Math.sin(this._time * 2.5) * 0.3;
    this._root.position.x = truckPosition.x;
    this._root.position.y = truckPosition.y + 4.5 + bobY;
    this._root.position.z = truckPosition.z;

    // ── Rotation: spin around Y to face the next checkpoint ───────────────
    const dx = target.centerX - truckPosition.x;
    const dz = target.centerZ - truckPosition.z;
    const angle = Math.atan2(dx, dz); // atan2(x,z) → Y-axis angle in BJS convention
    this._root.rotation.y = angle;
  }

  setVisible(visible) {
    this._shaft.setEnabled(visible);
    this._head.setEnabled(visible);
    this._ring.setEnabled(visible);
  }

  dispose() {
    this._shaft.dispose();
    this._head.dispose();
    this._ring.dispose();
    this._root.dispose();
    this._mat.dispose();
  }
}
