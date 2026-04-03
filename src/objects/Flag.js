import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  VertexData,
} from "@babylonjs/core";

export const POLE_HEIGHT = 8.5;
export const POLE_RADIUS = 0.1;
export const FLAG_WIDTH = 1.5;
export const FLAG_HEIGHT = 1.6;
export const POLE_MASS = 0.5;

/** Collision cylinder radius — wider than the pole for easier truck hits */
export const COLLISION_RADIUS = POLE_RADIUS * 10;

/** Spring stiffness — higher = snaps back faster */
const SPRING_K = 26;
/** Damping — higher = less oscillation */
const DAMPING = 1.5;
/** Maximum bend angle in radians (~50°) */
const MAX_BEND = 0.47;

/**
 * Flag — a decorative flag on a flexible pole that bends when hit by trucks.
 *
 * The pole pivots around its base so when it bends, the top sweeps in an arc.
 * A simple spring-damper on two axes (X, Z) drives the return to vertical.
 */
export class Flag {
  /**
   * @param {number} x
   * @param {number} z
   * @param {string} color - 'red' or 'blue'
   * @param {number} groundY - terrain height at (x, z)
   * @param {BABYLON.Scene} scene
   * @param {BABYLON.ShadowGenerator} shadows
   */
  constructor(x, z, color, groundY, scene, shadows) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.color = color;
    this.groundY = groundY;

    // ── Bend state (spring-damper) ──────────────────────────────────────
    this.bendAngleX = 0;   // current rotation around X axis (tilts in Z)
    this.bendAngleZ = 0;   // current rotation around Z axis (tilts in X)
    this.bendVelX = 0;     // angular velocity X
    this.bendVelZ = 0;     // angular velocity Z

    // ── Pole ────────────────────────────────────────────────────────────
    const poleCenterY = groundY + POLE_HEIGHT / 2;
    this.pole = MeshBuilder.CreateCylinder(`flagPole_${x}_${z}`, {
      height: POLE_HEIGHT,
      diameter: POLE_RADIUS * 2,
      tessellation: 8,
    }, scene);
    this.pole.position = new Vector3(x, poleCenterY, z);
    this.pole.isPickable = true;

    // Set pivot to the base of the pole so rotations bend from the ground
    this.pole.setPivotPoint(new Vector3(0, -POLE_HEIGHT / 2, 0));

    // Apply white material to pole
    const poleMaterial = new StandardMaterial(`flagPoleMat_${x}_${z}`, scene);
    poleMaterial.diffuseColor = new Color3(1, 1, 1);
    poleMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
    this.pole.material = poleMaterial;

    // ── Triangular flag (parented to pole) ──────────────────────────────
    // Create triangular flag mesh at top of pole
    this.flag = this._createTriangularFlag(x, z, color, scene);
    this.flag.parent = this.pole;
    this.flag.position = new Vector3(0, 0, 0);
    
    if (shadows) {
      shadows.addShadowCaster(this.pole);
      shadows.addShadowCaster(this.flag);
      this.pole.receiveShadows = true;
      this.flag.receiveShadows = true;
    }
  }

  // ─── Spring-damper update ──────────────────────────────────────────────

  /**
   * Advance the bend simulation by dt seconds.
   * Called every frame by FlagManager.
   */
  update(dt) {
    // Spring-damper: F = -k*angle - d*vel
    const ax = -SPRING_K * this.bendAngleX - DAMPING * this.bendVelX;
    const az = -SPRING_K * this.bendAngleZ - DAMPING * this.bendVelZ;

    this.bendVelX += ax * dt;
    this.bendVelZ += az * dt;

    this.bendAngleX += this.bendVelX * dt;
    this.bendAngleZ += this.bendVelZ * dt;

    // Clamp to max bend
    this.bendAngleX = Math.max(-MAX_BEND, Math.min(MAX_BEND, this.bendAngleX));
    this.bendAngleZ = Math.max(-MAX_BEND, Math.min(MAX_BEND, this.bendAngleZ));

    // Apply to mesh rotation
    this.pole.rotation.x = this.bendAngleX;
    this.pole.rotation.z = this.bendAngleZ;
  }

  /**
   * Apply an angular impulse (from a truck hit).
   * @param {number} impulseX - angular impulse around X axis
   * @param {number} impulseZ - angular impulse around Z axis
   */
  applyBendImpulse(impulseX, impulseZ) {
    this.bendVelX += impulseX;
    this.bendVelZ += impulseZ;
  }

  // ─── Flag mesh creation ───────────────────────────────────────────────

  /**
   * Create a triangular flag mesh
   */
  _createTriangularFlag(x, z, color, scene) {
    // Build a triangular flag as a custom mesh with explicit vertices and normals
    const customMesh = new Mesh(`flag_${x}_${z}`, scene);
    const vertexData = new VertexData();

    // Two triangles (front and back) forming the flag pennant
    // Positions: 3 vertices of the triangle
    const p0 = [0, POLE_HEIGHT / 2, 0];                          // top-left (pole)
    const p1 = [FLAG_WIDTH, POLE_HEIGHT / 2 - FLAG_HEIGHT / 2, 0]; // tip
    const p2 = [0, POLE_HEIGHT / 2 - FLAG_HEIGHT, 0];            // bottom-left (pole)

    vertexData.positions = [
      // Front face
      ...p0, ...p1, ...p2,
      // Back face (same verts, reversed winding)
      ...p0, ...p2, ...p1,
    ];

    vertexData.indices = [0, 1, 2, 3, 4, 5];

    // Front faces normal +Z, back faces normal -Z
    vertexData.normals = [
      0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1,
    ];

    vertexData.applyToMesh(customMesh);

    // Ensure mesh is pickable for editor selection
    customMesh.isPickable = true;

    // Apply colored material
    const flagMaterial = new StandardMaterial(`flagMat_${x}_${z}`, scene);
    const flagColor = color === 'red'
      ? new Color3(0.9, 0.1, 0.1)
      : new Color3(0.1, 0.3, 0.9);
    flagMaterial.diffuseColor = flagColor;
    flagMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    flagMaterial.backFaceCulling = false;
    customMesh.material = flagMaterial;

    return customMesh;
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  get position() {
    return this.pole.position.clone();
  }

  /**
   * Change the flag color
   */
  setColor(color) {
    this.color = color;
    const flagColor = color === 'red' 
      ? new Color3(0.9, 0.1, 0.1) 
      : new Color3(0.1, 0.3, 0.9);
    this.flag.material.diffuseColor = flagColor;
  }

  /**
   * Clean up all meshes
   */
  dispose() {
    if (this.flag) {
      this.flag.dispose();
    }

    if (this.pole) {
      this.pole.dispose();
    }
  }
}
