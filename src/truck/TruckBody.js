import { MeshBuilder, StandardMaterial, Color3, Vector3, TransformNode } from "@babylonjs/core";

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
  constructor(parent, scene, shadows, colors = {}) {
    this.parent  = parent;
    this.scene   = scene;
    this.shadows = shadows;

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
    // ── Chassis / truck bed ──────────────────────────────────────────────
    // The physics box is 1.5 wide × 0.8 tall × 2.6 deep, centred at origin.
    // We position the puppet so the bottom of the chassis sits at y=0 (ground
    // of the physics box).

    const chassis = this._box("chassis",
      { width: 1.65, height: 0.8, depth: 4 },
      new Vector3(0, 0.9, 0),
      this.colors.body
    );

    // // Truck bed (rear open flat)
    // const bed = this._box("bed",
    //   { width: 1.35, height: 0.08, depth: 1.0 },
    //   new Vector3(0, 0.0, -0.65),
    //   this.colors.body
    // );

    // // Bed side rails
    // for (const side of [-1, 1]) {
    //   this._box("bedRail",
    //     { width: 0.06, height: 0.22, depth: 1.0 },
    //     new Vector3(side * 0.655, 0.1, -0.65),
    //     this.colors.body
    //   );
    // }
    // // Tailgate
    // this._box("tailgate",
    //   { width: 1.35, height: 0.22, depth: 0.06 },
    //   new Vector3(0, 0.1, -1.18),
    //   this.colors.body
    // );

    // ── Cabin ────────────────────────────────────────────────────────────
    const cabin = this._box("cabin",
      { width: 1.38, height: 1, depth: 1.2 },
      new Vector3(0, 1.38, 0.38),
      this.colors.cabin
    );



    // ── Headlights ───────────────────────────────────────────────────────
    // for (const side of [-1, 1]) {
    //   const light = this._box("headlight",
    //     { width: 0.22, height: 0.14, depth: 0.06 },
    //     new Vector3(side * 0.52, 0.06, 1.45),
    //     new Color3(0.95, 0.95, 0.75)
    //   );
    //   const lmat = light.material;
    //   lmat.emissiveColor = new Color3(0.5, 0.5, 0.3);
    // }

    // // ── Exhaust pipe ─────────────────────────────────────────────────────
    // const exhaust = MeshBuilder.CreateCylinder("exhaust",
    //   { diameter: 0.07, height: 0.35, tessellation: 8 }, this.scene);
    // exhaust.rotation.z   = Math.PI / 2;
    // exhaust.position     = new Vector3(-0.82, -0.12, -0.9);
    // exhaust.parent       = this.parent;
    // this._styleMesh(exhaust, new Color3(0.3, 0.3, 0.3));
    // this._parts.push(exhaust);

    // ── Wheels ───────────────────────────────────────────────────────────
    //  wheel local positions (relative to physics box centre)
    const wheelDefs = [
      { id: "FL", x:  1, z:  1.2, isFront: true  },
      { id: "FR", x: -1, z:  1.2, isFront: true  },
      { id: "RL", x:  1, z: -1.2, isFront: false },
      { id: "RR", x: -1, z: -1.2, isFront: false },
    ];

    for (const def of wheelDefs) {
      const baseY = 0.20; // tyre radius (0.36) - physics box half-height (0.4)
      const wheel = this._buildWheel(def.id, def.x, baseY, def.z);
      this._wheels.push({
        mesh: wheel,
        isFront: def.isFront,
        side: def.x > 0 ? "L" : "R",
        baseLocalY: baseY,
      });
    }
  }

  _buildWheel(id, x, y, z) {
    // Tyre (torus lying on its side)
    const tyre = MeshBuilder.CreateTorus(`wheel_${id}`, {
      diameter:     0.62,
      thickness:    0.68,
      tessellation: 18,
    }, this.scene);
    tyre.rotation.z = Math.PI / 2;   // stand the torus upright
    tyre.position   = new Vector3(x, y, z);
    tyre.parent     = this._wheelRoot;
    this._styleMesh(tyre, this.colors.wheel);
    this._parts.push(tyre);

    // Rim disc
    const rim = MeshBuilder.CreateCylinder(`rim_${id}`, {
      diameter: 0.44, height: 0.12, tessellation: 12,
    }, this.scene);
    rim.rotation.z = Math.PI / 2;
    rim.position   = new Vector3(x, y, z);
    rim.parent     = this._wheelRoot;
    this._styleMesh(rim, this.colors.detail);
    this._parts.push(rim);

    // Return the tyre as the primary wheel mesh for animation
    return tyre;
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
    // Wheel spin: one full rotation per ~2.26 units travelled (circumference ≈ π×0.72)
    // const spinDelta = (speed * dt) / (Math.PI * 0.72) * Math.PI * 2;

    // Forward speed sign determines spin direction
    // const forward = new Vector3(Math.sin(state.heading), 0, Math.cos(state.heading));
    // const fwdSpeed = state.velocity.dot(forward);
    // const spinSign = fwdSpeed >= 0 ? 1 : -1;

    // Front wheel steer: lerp toward target angle
    const maxSteer = 0.42; // radians
    let targetSteer = input.left ? -maxSteer : input.right ? maxSteer : 0;
    this._steerAngle += (targetSteer - this._steerAngle) * Math.min(1, dt * 8);

    for (const w of this._wheels) {
      // Suspension: bob each wheel down when compressed
      // suspensionCompression is 0 (full extend) to ~1 (full compress)
      const susTravel = state.suspensionCompression * 0.12;
      w.mesh.position.y = w.baseLocalY + susTravel;

      // Spin around local X (the torus is rotated so local X is the axle)
      // w.mesh.rotation.x = (w.mesh.rotation.x ?? 0) + spinSign * spinDelta;

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
    mesh.parent   = this._visualRoot;
    this._styleMesh(mesh, color);
    this._parts.push(mesh);
    return mesh;
  }

  _styleMesh(mesh, color) {
    const mat = new StandardMaterial(`${mesh.name}Mat`, this.scene);
    mat.diffuseColor  = color;
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mesh.material     = mat;
    mesh.receiveShadows = true;
    this.shadows.addShadowCaster(mesh);
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    for (const mesh of this._parts) mesh.dispose();
    this._parts  = [];
    this._wheels = [];
    if (this._visualRoot) {
      this._visualRoot.dispose();
      this._visualRoot = null;
    }
    if (this._wheelRoot) {
      this._wheelRoot.dispose();
      this._wheelRoot = null;
    }
  }
}
