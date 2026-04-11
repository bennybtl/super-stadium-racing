import { MeshBuilder, StandardMaterial, Color3, Vector3, SceneLoader, TransformNode } from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import truckTireUrl  from "../assets/truck-tire.obj?url";

// Skip MTL lookup — materials are applied programmatically
OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

/**
 * TruckBody — builds a purely visual puppet parented to the physics box mesh.
 *
 * All parts are children of `parent` (the invisible physics box), so they
 * automatically follow its position, heading and roll for free.
 *
 * Per-frame call update(state, input, speed, dt) to animate:
 *   - wheel spin  (all four wheels, driven by speed)
 *   - front-wheel steer (turn angle driven by input + heading rate)
 *   - suspension travel (each corner samples state.suspensionCompression)
 */
export class TruckBody {
  /**
   * @param {Mesh}    parent  - the invisible physics box mesh
   * @param {Scene}   scene
   * @param {Object}  shadows - ShadowGenerator
   * @param {Object}  colors  - { body, cabin, wheel, detail }
   */
  constructor(parent, scene, shadows, colors = {}, vehicleDef = null) {
    this.parent  = parent;
    this.scene   = scene;
    this.shadows = shadows;

    // Wheel geometry — from vehicle def, falling back to defaults matching the OBJ model
    const g = vehicleDef?.wheels ?? {};
    const halfTrack  = (g.trackWidth  ?? 2.4) / 2;
    const frontAxle  =  g.frontAxle   ?? 1.5;
    const rearAxle   =  g.rearAxle    ?? -1.2;

    // Body OBJ URL — resolved by VehicleLoader and stored on the def
    this._modelUrl = vehicleDef?.modelUrl ?? null;
    this._wheelDefs = [
      { id: "FL", x:  halfTrack, z: frontAxle, isFront: true  },
      { id: "FR", x: -halfTrack, z: frontAxle, isFront: true  },
      { id: "RL", x:  halfTrack, z: rearAxle,  isFront: false },
      { id: "RR", x: -halfTrack, z: rearAxle,  isFront: false },
    ];


    // Visual root for the body (chassis, cabin). Follows the physics box
    // closely but gets a partial terrain correction — allows suspension
    // bounce while never sinking fully underground.
    this._visualRoot = new TransformNode("truckBodyRoot", scene);
    this._visualRoot.parent = parent;

    // Wheel root gets the FULL terrain correction so wheels always
    // stay above the ground surface.
    this._wheelRoot = new TransformNode("truckWheelRoot", scene);
    this._wheelRoot.parent = parent;

    this.colors = {
      body:   colors.body   ?? new Color3(0.8, 0.15, 0.05),
      cabin:  colors.cabin  ?? new Color3(0.25, 0.25, 0.3),
      wheel:  colors.wheel  ?? new Color3(0.12, 0.12, 0.12),
      detail: colors.detail ?? new Color3(0.7, 0.7, 0.7),
    };

    this._parts = [];   // all meshes — for disposal
    this._wheels = [];  // { mesh, isFront, side: 'L'|'R', baseLocalY }

    this._steerAngle = 0;  // current front-wheel steer angle (radians)

    this._build();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  _build() {
    // Body loaded asynchronously from OBJ (falls back to boxes on failure)
    this._loadBody();

    // ── Wheels ───────────────────────────────────────────────────────────
    for (const def of this._wheelDefs) {
      const baseY = 0.20; // tyre radius (0.36) - physics box half-height (0.4)
      const entry = { mesh: null, isFront: def.isFront, side: def.x > 0 ? "L" : "R", baseLocalY: baseY };
      this._wheels.push(entry);
      this._loadTireMesh({ name: `wheel_${def.id}`, position: new Vector3(def.x, baseY, def.z), entry });
    }

    // Spare tyre on the truck bed, leaning ~32° toward the cab
    this._loadTireMesh({
      name: 'spare_tyre',
      position: new Vector3(0, 1.5, -0.9),
      rotation: { x: 0, y: -Math.PI/2, z: -0.9 },
      root: this._visualRoot,
    });
  }

  async _loadBody() {
    if (!this._modelUrl) {
      console.warn('[TruckBody] No modelUrl on vehicleDef — using box fallback');
      this._buildBoxBody();
      return;
    }
    try {
      // Split the Vite-resolved URL into directory + filename for Babylon's loader
      const lastSlash = this._modelUrl.lastIndexOf('/');
      const rootUrl   = this._modelUrl.substring(0, lastSlash + 1);
      const fileName  = this._modelUrl.substring(lastSlash + 1);

      const result = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, this.scene);
      if (!result.meshes.length) throw new Error('OBJ loaded no meshes');

      const mesh  = result.meshes[0];
      mesh.parent = this._visualRoot;

      // ── Transform — adjust these to dial in the fit ───────────────────
      // OBJ axes: X = truck length, Y = height, Z = width.
      // rotation.y = -π/2 maps local-X → world-Z (forward) and local-Z → world-X (side).
      // scaling:  .x controls length (world Z),  .z controls width (world X),  .y controls height.
      // position: .x centers the body (OBJ is offset in Z),  .y lifts it so OBJ-bottom lands at ~0.5.
      mesh.rotation = new Vector3(-Math.PI / 2, 0, 0);
      mesh.scaling  = new Vector3(1, 1, 1); // length, height, width
      mesh.position = new Vector3(0, 0.66, 0.0);  // center-X, bottom-Y, center-Z

      this._styleMesh(mesh, this.colors.body);
      mesh.receiveShadows = false; // prevents self-shadowing artifacts
      this._parts.push(mesh);
    } catch (err) {
      console.warn('[TruckBody] body mesh load failed — using box fallback:', err);
      this._buildBoxBody();
    }
  }

  _buildBoxBody() {
    this._box("chassis",
      { width: 1.65, height: 0.8, depth: 4 },
      new Vector3(0, 0.9, 0),
      this.colors.body
    );
    this._box("cabin",
      { width: 1.38, height: 1, depth: 1.2 },
      new Vector3(0, 1.38, 0.38),
      this.colors.cabin
    );
  }

  /**
   * Loads a tyre OBJ and attaches it to the wheel root.
   * @param {string}          name      - mesh name (used for the cylinder fallback too)
   * @param {Vector3}         position  - local position on the parent root
   * @param {Vector3|null}    rotation  - optional rotation (null = upright wheel orientation)
   * @param {TransformNode}   root      - parent node (defaults to _wheelRoot)
   * @param {Object|null}     entry     - wheels array entry; entry.mesh is set when loaded
   */
  async _loadTireMesh({ name, position, rotation = null, root = this._wheelRoot, entry = null }) {
    try {
      const lastSlash = truckTireUrl.lastIndexOf('/');
      const rootUrl   = truckTireUrl.substring(0, lastSlash + 1);
      const fileName  = truckTireUrl.substring(lastSlash + 1);

      const result = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, this.scene);
      if (!result.meshes.length) throw new Error('OBJ loaded no meshes');

      const mesh = result.meshes[0];
      mesh.parent   = root;
      mesh.position = position;
      if (rotation) {
        mesh.rotation.x = rotation.x;
        mesh.rotation.y = rotation.y;
        mesh.rotation.z = rotation.z;
      }

      if (position.x > 0) {
        mesh.scaling.x = -1.2; // mirror left-side wheels (OBJ model is right-side)
      } else {
        mesh.scaling.x = 1.2;
      }        
      mesh.scaling.y = 1.2;
      mesh.scaling.z = 1.2;

      this._styleMesh(mesh, this.colors.wheel);
      mesh.receiveShadows = false;
      this._parts.push(mesh);
      if (entry) entry.mesh = mesh;
    } catch (err) {
      console.warn(`[TruckBody] tire mesh load failed for ${name} — using cylinder fallback:`, err);
      const tyre = MeshBuilder.CreateCylinder(name, {
        diameter: 1.1, height: 0.4, tessellation: 20,
      }, this.scene);
      if (rotation) {
        tyre.rotation = rotation.clone();
      } else {
        tyre.rotation.z = Math.PI / 2;
      }
      tyre.position = position.clone();
      tyre.parent   = root;
      this._styleMesh(tyre, this.colors.wheel);
      tyre.receiveShadows = false;
      this._parts.push(tyre);
      if (entry) entry.mesh = tyre;
    }
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  /**
   * @param {Object}  state   - truck.state
   * @param {Object}  input   - { forward, back, left, right }
   * @param {number}  speed   - current speed (units/s)
   * @param {number}  dt      - delta time (s)
   */
  update(state, input, speed, dt, terrainY = null) {
    // When the physics box dips below the terrain surface, push the
    // wheel root fully above ground, and the body root partially —
    // this lets the body bounce with the physics while the wheels
    // stay planted on the surface.
    if (terrainY !== null) {
      const physY = this.parent.position.y;
      const minY = terrainY + 0.4; // 0.4 = TRUCK_HALF_HEIGHT
      const deficit = minY - physY;

      // Wheels: full correction — always above terrain
      this._wheelRoot.position.y = deficit > 0 ? deficit : 0;

      // Body: allow up to 0.25 units of dip below ground for suspension feel,
      // but never more than that
      const bodyAllowance = 0.25;
      const bodyDeficit = deficit - bodyAllowance;
      this._visualRoot.position.y = bodyDeficit > 0 ? bodyDeficit : 0;
    }

    this._animateWheels(state, speed, dt, input);
  }

  _animateWheels(state, speed, dt, input) {
    // Front wheel steer: lerp toward target angle
    const maxSteer = 0.42; // radians
    let targetSteer = input.left ? -maxSteer : input.right ? maxSteer : 0;
    this._steerAngle += (targetSteer - this._steerAngle) * Math.min(1, dt * 8);

    for (const w of this._wheels) {
      if (!w.mesh) continue;
      // Suspension: bob each wheel down when compressed
      // suspensionCompression is 0 (full extend) to ~1 (full compress)
      const susTravel = state.suspensionCompression * 0.12;
      w.mesh.position.y = w.baseLocalY + susTravel;

      // Steer front wheels around local Y
      if (w.isFront) {
        w.mesh.rotation.y = this._steerAngle;
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _box(name, size, position, color) {
    const mesh = MeshBuilder.CreateBox(name, size, this.scene);
    mesh.position = position;
    mesh.parent   = this.parent;
    this._styleMesh(mesh, color);
    this._parts.push(mesh);
    return mesh;
  }

  _styleMesh(mesh, color) {
    const mat = new StandardMaterial(`${mesh.name}Mat`, this.scene);
    mat.diffuseColor  = color;
    mat.specularColor = new Color3(0.9, 0.9, 0.9);
    mat.specularPower = 32;
    mesh.material     = mat;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    for (const mesh of this._parts) mesh.dispose();
    this._visualRoot.dispose();
    this._wheelRoot.dispose();
    this._parts  = [];
    this._wheels = [];
  }
}
