import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from "@babylonjs/core";

export const POLE_HEIGHT = 8.5;
export const POLE_RADIUS = 0.1;
export const FLAG_WIDTH = 1.5;
export const FLAG_HEIGHT = 1.6;
export const POLE_MASS = 0.5;
/**
 * Flag — a decorative static flag on a pole.
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



    // Create pole (cylinder) with physics
    const poleCenterY = groundY + POLE_HEIGHT / 2;
    this.pole = MeshBuilder.CreateCylinder(`flagPole_${x}_${z}`, {
      height: POLE_HEIGHT,
      diameter: POLE_RADIUS * 2,
      tessellation: 8,
    }, scene);
    this.pole.position = new Vector3(x, poleCenterY, z);
    this.pole.isPickable = true;

    // Apply white material to pole
    const poleMaterial = new StandardMaterial(`flagPoleMat_${x}_${z}`, scene);
    poleMaterial.diffuseColor = new Color3(1, 1, 1);
    poleMaterial.specularColor = new Color3(0.2, 0.2, 0.2);
    this.pole.material = poleMaterial;



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

  /**
   * Create a triangular flag mesh
   */
  _createTriangularFlag(x, z, color, scene) {
    const positions = [
      0, 0, 0,                    // vertex 0: base of triangle (at pole)
      FLAG_WIDTH, FLAG_HEIGHT/2, 0,  // vertex 1: tip of triangle
      0, FLAG_HEIGHT, 0,          // vertex 2: top of triangle (at pole)
      // Back face (same positions, reverse order for backface culling)
      0, 0, 0,                    
      0, FLAG_HEIGHT, 0,
      FLAG_WIDTH, FLAG_HEIGHT/2, 0,
    ];

    const indices = [
      0, 1, 2,  // front face
      3, 4, 5,  // back face
    ];

    const normals = [];
    // Calculate normals
    for (let i = 0; i < positions.length; i += 9) {
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }

    const customMesh = MeshBuilder.CreateRibbon(`flag_${x}_${z}`, {
      pathArray: [[
        new Vector3(0, POLE_HEIGHT / 2, 0),
        new Vector3(FLAG_WIDTH, POLE_HEIGHT / 2 - FLAG_HEIGHT / 2, 0),
        new Vector3(0, POLE_HEIGHT / 2 - FLAG_HEIGHT, 0),
      ]],
      closeArray: false,
      closePath: true,
      updatable: false,
    }, scene);

    // Ensure mesh is pickable for editor selection
    customMesh.isPickable = true;

    // Apply colored material
    const flagMaterial = new StandardMaterial(`flagMat_${x}_${z}`, scene);
    const flagColor = color === 'red' 
      ? new Color3(0.9, 0.1, 0.1) 
      : new Color3(0.1, 0.3, 0.9);
    flagMaterial.diffuseColor = flagColor;
    flagMaterial.specularColor = new Color3(0.1, 0.1, 0.1);
    flagMaterial.backFaceCulling = false; // show both sides
    customMesh.material = flagMaterial;

    return customMesh;
  }

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
