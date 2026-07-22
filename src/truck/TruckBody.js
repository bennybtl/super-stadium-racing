import { MeshBuilder, StandardMaterial, Color3, Vector3, Matrix, SceneLoader, TransformNode, DynamicTexture } from "@babylonjs/core";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ/objFileLoader";
import truckTireUrl  from "../assets/models/truck-tire-v2.obj?url";
import { basicColors } from "../constants";

// Skip MTL lookup — materials are applied programmatically
OBJFileLoader.MATERIAL_LOADING_FAILS_SILENTLY = true;
OBJFileLoader.SKIP_MATERIALS = true;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Sprung-mass body dynamics — one coherent model for all visual body motion.
 *
 * The cab is a mass on soft suspension sitting on the wheels. Its three visual
 * degrees of freedom are each an underdamped spring whose *target* is set by the
 * chassis's acceleration in truck-local space — the same weight transfer a real
 * occupant feels:
 *   - heave (vertical bob) ← vertical accel   (landings, bumps)
 *   - pitch (dive / squat)  ← longitudinal accel (brake / throttle)
 *   - roll  (body lean)     ← lateral accel     (cornering)
 * The spring gives each its inertia, overshoot and settle. All three share one
 * frequency/damping family, so dive, lean and bob move together — which reads as
 * real suspension rather than a set of independent scripted tilts.
 *
 * Per DOF: freq = bounce speed (Hz); damping < 1 = underdamped (overshoot);
 *          gain = target deflection per m/s² of accel; max = clamp on deflection.
 */
const BODY_DYN = {
  heave: { freq: 1.8, damping: 0.35, gain: 0.0080, max: 0.25 }, // units
  pitch: { freq: 2.0, damping: 0.45, gain: 0.0130, max: 0.28 }, // radians
  roll:  { freq: 2.2, damping: 0.45, gain: 0.0190, max: 0.34 }, // radians
  maxDt: 1 / 30, // clamp per-substep dt so a frame spike can't destabilise a spring
};

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
  constructor(parent, scene, shadows, colors = {}, vehicleDef = null, options = null) {
    this.parent  = parent;
    this.scene   = scene;
    this.shadows = shadows;
    this._disableDynamicShadows = options?.disableDynamicShadows === true;
    // Ghost mode: render the whole puppet as a translucent, unlit blue replay
    // truck (used by HotLapMode). Implies no dynamic shadows and no contact blob.
    this._ghost = options?.ghost === true;
    this._ghostAlpha = options?.ghostAlpha ?? 0.6;
    if (this._ghost) this._disableDynamicShadows = true;
    this.vehicleDef = vehicleDef;
    this._parentHalfHeight = parent.getBoundingInfo()?.boundingBox?.extendSize?.y ?? 0.4;

    // Wheel geometry — from vehicle def, falling back to defaults matching the OBJ model
    const g = vehicleDef?.wheels ?? {};
    const frontHalfTrack = (g.frontTrackWidth ?? g.trackWidth ?? 2.4) / 2;
    const rearHalfTrack  = (g.rearTrackWidth  ?? g.trackWidth ?? 2.4) / 2;
    const frontAxle      =  g.frontAxle  ?? 1.5;
    const rearAxle       =  g.rearAxle   ?? -1.2;
    const frontScale     =  g.frontScale ?? [1.2, 1.2, 1.2];
    const rearScale      =  g.rearScale  ?? [1.2, 1.2, 1.2];
    this._wheelRadius    =  g.radius ?? 0.36;
    this._wheelBaseY     = (g.baseYOffset ?? 0.20);
    this._wheelMaxDrop   = (g.maxDrop ?? 0.32);
    this._wheelMaxRise   = (g.maxRise ?? 0.15);
    this._wheelFollowMinGroundedness = (g.followMinGroundedness ?? 0.2);

    // Body OBJ URL — resolved by VehicleLoader and stored on the def
    this._modelUrl = vehicleDef?.modelUrl ?? null;

    // Per-vehicle body mesh transform overrides (position, rotation, scaling)
    const bt = vehicleDef?.bodyTransform ?? {};
    this._bodyPosition = bt.position ?? [0, 0.66, 0.0];
    this._bodyYOffset = this._bodyPosition[1] ?? 0;
    this._bodyRotation = bt.rotation ?? [-Math.PI / 2, 0, 0];
    this._bodyScaling  = bt.scaling  ?? [1, 1, 1];
    this._wheelDefs = [
      { id: "FL", x:  frontHalfTrack, z: frontAxle, isFront: true,  scale: frontScale },
      { id: "FR", x: -frontHalfTrack, z: frontAxle, isFront: true,  scale: frontScale },
      { id: "RL", x:  rearHalfTrack,  z: rearAxle,  isFront: false, scale: rearScale  },
      { id: "RR", x: -rearHalfTrack,  z: rearAxle,  isFront: false, scale: rearScale  },
    ];


    // Sprung-mass node: carries the body's heave/pitch/roll relative to the
    // chassis (driven by BODY_DYN). Sits between the physics box and the static
    // body transform so cab dynamics never touch collision or the model's own
    // orientation.
    this._bodyDynNode = new TransformNode("truckBodyDyn", scene);
    this._bodyDynNode.parent = parent;

    // Visual root for the body (chassis, cabin). Holds the static body transform
    // (ride height, model orientation, scale); parented to the dynamics node so
    // it inherits the sprung motion.
    this._visualRoot = new TransformNode("truckBodyRoot", scene);
    this._visualRoot.parent = this._bodyDynNode;

    // Wheel root gets the FULL terrain correction so wheels always
    // stay above the ground surface.
    this._wheelRoot = new TransformNode("truckWheelRoot", scene);
    this._wheelRoot.parent = parent;

    this.colors = {
      body:   colors.body   ?? basicColors.red.diffuse,
      cabin:  colors.cabin  ?? basicColors.black.diffuse,
      wheel:  colors.wheel  ?? basicColors.black.diffuse,
      rim:    colors.rim    ?? basicColors.white.diffuse,
      detail: colors.detail ?? basicColors.gray.diffuse,
    };

    this._parts = [];   // all meshes — for disposal
    this._wheels = [];  // { mesh, isFront, side: 'L'|'R', baseLocalY }
    this._sampledWheelBaseY = [];
    this._hasWheelSamples = false;

    // Reused temporaries for wheel anchor world transform (avoid per-frame allocs)
    this._tmpAnchorLocal = new Vector3();
    this._tmpAnchorWorld = new Vector3();
    this._tmpDesiredWorld = new Vector3();
    this._tmpDesiredLocal = new Vector3();
    this._tmpInvMatrix    = new Matrix();

    this._steerAngle = 0;  // current front-wheel steer angle (radians)
    this._wheelSpin  = 0;  // accumulated wheel-roll angle (radians)
    // Sprung-mass body dynamics state. See BODY_DYN / _updateBodyDynamics.
    this._dyn = {
      heave: { x: 0, v: 0 },  // vertical offset (units) + velocity
      pitch: { x: 0, v: 0 },  // nose dive/squat (rad) + velocity
      roll:  { x: 0, v: 0 },  // body lean (rad) + velocity
    };
    this._lastVx = 0; this._lastVy = 0; this._lastVz = 0; // prev chassis velocity
    this._dynInit = false;   // seed velocity on first frame before deriving accel
    this._contactShadow = null;
    this._contactShadowMat = null;
    this._contactShadowTex = null;

    this._build();
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  _build() {
    // Body loaded asynchronously from OBJ (falls back to boxes on failure)
    this._loadBody();

    // ── Wheels ───────────────────────────────────────────────────────────
    for (const def of this._wheelDefs) {
      const baseY = this._wheelBaseY;
      const entry = {
        mesh: null,
        isFront: def.isFront,
        side: def.x > 0 ? "L" : "R",
        baseLocalY: baseY,
        anchorX: def.x,
        anchorZ: def.z,
      };
      this._wheels.push(entry);
      this._loadTireMesh({ name: `wheel_${def.id}`, position: new Vector3(def.x, baseY, def.z), entry, scale: def.scale });
    }

    // Default to fully extended visual drop until first terrain sample.
    this._sampledWheelBaseY = this._wheels.map(w => w.baseLocalY - this._wheelMaxDrop);

    // Add a simple blob shadow so the truck always reads as grounded.
    // (Ghost replays skip it — a dark blob under a translucent truck looks off.)
    if (!this._ghost) this._createContactShadow();
  }

  _createContactShadow() {
    const shadow = MeshBuilder.CreateGround("truckContactShadow", {
      width: 3,
      height: 5,
      subdivisions: 1,
    }, this.scene);
    shadow.isPickable = false;
    shadow.receiveShadows = false;
    shadow.alwaysSelectAsActiveMesh = true;

    const tex = new DynamicTexture("truckContactShadowTex", { width: 128, height: 128 }, this.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0.0, "rgba(0,0,0,0.9)");
    g.addColorStop(0.45, "rgba(0,0,0,0.55)");
    g.addColorStop(0.8, "rgba(0,0,0,0.18)");
    g.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    tex.hasAlpha = true;
    tex.update();

    const mat = new StandardMaterial("truckContactShadowMat", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0, 0, 0);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.opacityTexture = tex;
    mat.alpha = 0.48;
    mat.backFaceCulling = false;
    shadow.material = mat;

    this._contactShadow = shadow;
    this._contactShadowMat = mat;
    this._contactShadowTex = tex;
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

      const visibleMeshes = result.meshes.filter(m => typeof m.getTotalVertices === 'function' && m.getTotalVertices() > 0);
      if (!visibleMeshes.length) throw new Error('OBJ loaded no visual meshes');

      // Apply the overall body transform on the visual root so imported meshes
      // inherit the same orientation, scaling, and position.
      this._visualRoot.rotation = new Vector3(...this._bodyRotation);
      this._visualRoot.scaling  = new Vector3(...this._bodyScaling);
      this._visualRoot.position = new Vector3(...this._bodyPosition);

      for (const mesh of result.meshes) {
        mesh.parent = this._visualRoot;
      }

      for (const mesh of visibleMeshes) {
        const color = this._meshColorFor(mesh);
        this._styleMesh(mesh, color);
        mesh.receiveShadows = false; // prevents self-shadowing artifacts
        this._parts.push(mesh);
      }
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
  async _loadTireMesh({ name, position, rotation = null, root = this._wheelRoot, entry = null, scale = [1.2, 1.2, 1.2] }) {
    const wheelNode = new TransformNode(`${name}_root`, this.scene);
    wheelNode.parent = root;
    wheelNode.position.copyFrom(position);
    if (rotation) {
      wheelNode.rotation.x = rotation.x;
      wheelNode.rotation.y = rotation.y;
      wheelNode.rotation.z = rotation.z;
    }
    wheelNode.scaling.x = position.x > 0 ? -scale[0] : scale[0]; // mirror left-side wheels
    wheelNode.scaling.y = scale[1];
    wheelNode.scaling.z = scale[2];

    try {
      const lastSlash = truckTireUrl.lastIndexOf('/');
      const rootUrl   = truckTireUrl.substring(0, lastSlash + 1);
      const fileName  = truckTireUrl.substring(lastSlash + 1);

      const result = await SceneLoader.ImportMeshAsync("", rootUrl, fileName, this.scene);
      if (!result.meshes.length) throw new Error('OBJ loaded no meshes');

      const visualMeshes = result.meshes.filter(m => m.getTotalVertices?.() > 0);
      if (!visualMeshes.length) throw new Error('OBJ loaded no visual meshes');

      visualMeshes[0].parent = wheelNode; // attach the first mesh to the node, others will be re-parented below
      visualMeshes[1].parent = wheelNode; // attach the second mesh to the node, others will be re-parented below
      this._styleMesh(visualMeshes[0], this.colors.wheel, {
        specularColor: new Color3(0.02, 0.02, 0.02),
        specularPower: 8,
      });
      this._styleMesh(visualMeshes[1], this.colors.rim);
      visualMeshes[0].receiveShadows = false;
      visualMeshes[1].receiveShadows = false;
      this._parts.push(...visualMeshes);

      if (entry) entry.mesh = wheelNode;
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
      tyre.position.setAll(0);
      tyre.parent   = wheelNode;
      this._styleMesh(tyre, this.colors.wheel, {
        specularColor: new Color3(0.02, 0.02, 0.02),
        specularPower: 8,
      });
      tyre.receiveShadows = false;
      this._parts.push(tyre);
      if (entry) entry.mesh = wheelNode;
    }
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  /**
   * @param {Object}  state   - truck.state
   * @param {Object}  input   - { forward, back, left, right }
   * @param {number}  speed   - current speed (units/s)
   * @param {number}  dt      - delta time (s)
   */
  update(state, input, speed, dt, terrainY = null, groundedness = 0, sampleSurfaceY = null) {
    // When the physics box dips below the terrain surface, push the wheel root
    // fully above ground so the wheels stay planted. The body's own vertical
    // motion is handled by the sprung-mass dynamics below, not this correction.
    if (terrainY !== null) {
      const physY = this.parent.position.y;
      const minY = terrainY + 0.4; // 0.4 = TRUCK_HALF_HEIGHT
      const deficit = minY - physY;

      // Wheels: full correction — always above terrain
      this._wheelRoot.position.y = deficit > 0 ? deficit : 0;

      // Keep a dark, stable contact shadow under the truck.
      if (this._contactShadow) {
        const hover = Math.max(0, physY - (terrainY + this._parentHalfHeight));
        this._contactShadow.position.set(this.parent.position.x, terrainY + 0.035, this.parent.position.z);
        this._contactShadow.rotation.y = this.parent.rotation.y;
        const radius = 1.45 + Math.min(0.55, hover * 0.8);
        this._contactShadow.scaling.set(radius * 1.35, 1, radius * 0.92);
        if (this._contactShadowMat) {
          this._contactShadowMat.alpha = Math.max(0.14, Math.min(0.56, 0.5 - hover * 0.42));
        }
        this._contactShadow.isVisible = true;
      }
    } else if (this._contactShadow) {
      this._contactShadow.isVisible = false;
    }

    // Body sprung-mass dynamics — heave/pitch/roll relative to the chassis.
    // (Wheels stay on _wheelRoot, which only follows the terrain, so the body
    // leans and bobs over planted wheels like real suspension.)
    this._updateBodyDynamics(state, groundedness, dt);

    let sampledWheelBaseY = this._hasWheelSamples ? this._sampledWheelBaseY : null;
    if (sampleSurfaceY && groundedness >= this._wheelFollowMinGroundedness) {
      const parentY = this.parent.position.y;
      const fromY = parentY + 2;
      const world = this.parent.getWorldMatrix();

      // Invert the wheel root's world matrix once so we can convert a desired
      // world-space wheel position back to wheel-root local space.  This
      // correctly accounts for parent pitch, roll, and yaw — a plain
      // (floorY - parentY) arithmetic only works when the truck is flat.
      this._wheelRoot.getWorldMatrix().invertToRef(this._tmpInvMatrix);

      for (let i = 0; i < this._wheels.length; i++) {
        const w = this._wheels[i];
        this._tmpAnchorLocal.set(w.anchorX, 0, w.anchorZ);
        Vector3.TransformCoordinatesToRef(this._tmpAnchorLocal, world, this._tmpAnchorWorld);
        const floorY = sampleSurfaceY(this._tmpAnchorWorld.x, this._tmpAnchorWorld.z, fromY, terrainY ?? 0);

        // Desired wheel-centre world position → wheel-root local space.
        this._tmpDesiredWorld.set(this._tmpAnchorWorld.x, floorY + this._wheelRadius, this._tmpAnchorWorld.z);
        Vector3.TransformCoordinatesToRef(this._tmpDesiredWorld, this._tmpInvMatrix, this._tmpDesiredLocal);

        const minBaseY = w.baseLocalY - this._wheelMaxDrop;
        const maxBaseY = w.baseLocalY + this._wheelMaxRise;
        this._sampledWheelBaseY[i] = Math.max(minBaseY, Math.min(maxBaseY, this._tmpDesiredLocal.y));
      }

      sampledWheelBaseY = this._sampledWheelBaseY;
      this._hasWheelSamples = true;
    } else {
      this._hasWheelSamples = false;
    }

    this._animateWheels(state, speed, dt, input, sampledWheelBaseY);
  }

  /**
   * Underdamped spring toward targetY. The body lags then overshoots the rest
   * position and settles with a rebound, giving offroad "bounce". Purely visual
   * — only the body's local Y moves; wheels and collision are untouched.
   * @returns {number} the sprung Y to apply to the visual root
   */
  /**
   * Drive the body's heave/pitch/roll springs from the chassis's acceleration.
   * Acceleration is derived from the change in chassis velocity, decomposed into
   * truck-local forward/right/up, and faded by groundedness (weight transfer
   * only acts through the contact patch — no dive/lean/bob while airborne).
   */
  _updateBodyDynamics(state, groundedness, dt) {
    const v = state.velocity;
    if (!v || !(dt > 0)) return;

    // Seed velocity on the first frame so the first derived accel isn't a spike.
    if (!this._dynInit) {
      this._lastVx = v.x; this._lastVy = v.y; this._lastVz = v.z;
      this._dynInit = true;
      return;
    }

    // Chassis acceleration since the last body update (world space).
    const ax = (v.x - this._lastVx) / dt;
    const ay = (v.y - this._lastVy) / dt;
    const az = (v.z - this._lastVz) / dt;
    this._lastVx = v.x; this._lastVy = v.y; this._lastVz = v.z;

    // Decompose into truck-local forward/right (heading yaw). Forward = (sinH,
    // cosH); right = (cosH, -sinH) — matches the conventions used elsewhere.
    const h = state.heading ?? 0;
    const sinH = Math.sin(h), cosH = Math.cos(h);
    const fwdAccel   = ax * sinH + az * cosH;
    const rightAccel = ax * cosH - az * sinH;

    const g = clamp(groundedness, 0, 1);
    const H = BODY_DYN.heave, P = BODY_DYN.pitch, R = BODY_DYN.roll;
    // Sign: chassis thrown up (landing) → body squats down; braking (fwd accel
    // negative) → nose dives (+x); cornering → body leans out of the turn
    // (roll follows +rightAccel; the others follow -accel).
    const heaveTarget = g * clamp(-H.gain * ay,        -H.max, H.max);
    const pitchTarget = g * clamp(-P.gain * fwdAccel,  -P.max, P.max);
    const rollTarget  = g * clamp(R.gain * rightAccel, -R.max, R.max);

    this._integrateDof(this._dyn.heave, heaveTarget, H, dt);
    this._integrateDof(this._dyn.pitch, pitchTarget, P, dt);
    this._integrateDof(this._dyn.roll,  rollTarget,  R, dt);

    this._bodyDynNode.position.y = this._dyn.heave.x;
    this._bodyDynNode.rotation.x = this._dyn.pitch.x;
    this._bodyDynNode.rotation.z = this._dyn.roll.x;
  }

  /**
   * Advance one underdamped spring DOF toward `target`. Substeps so a large dt
   * spike (LOD throttling, tab refocus) can't blow up the integrator.
   */
  _integrateDof(s, target, cfg, dt) {
    const omega = 2 * Math.PI * cfg.freq;
    const k = omega * omega;                 // stiffness
    const c = 2 * cfg.damping * omega;        // damping
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, BODY_DYN.maxDt);
      const a = k * (target - s.x) - c * s.v;
      s.v += a * step;
      s.x += s.v * step;
      remaining -= step;
    }
  }

  _animateWheels(state, speed, dt, input, sampledWheelBaseY = null) {
    // Front wheel steer: lerp toward target angle
    const maxSteer = 0.52; // radians
    let targetSteer = input.left ? -maxSteer : input.right ? maxSteer : 0;
    this._steerAngle += (targetSteer - this._steerAngle) * Math.min(1, dt * 8);

    // Wheel roll: angular velocity = forward ground speed / radius (rolling
    // without slip), so the spin stays synced with the truck's engine-driven
    // speed and reverses when reversing. The forward velocity *component* is
    // used so a sideways slide doesn't spin the wheels.
    const h = state.heading ?? 0;
    const fwdSpeed = state.velocity.x * Math.sin(h) + state.velocity.z * Math.cos(h);
    const radius = this._wheelRadius || 0.36;
    this._wheelSpin = (this._wheelSpin + (fwdSpeed / radius) * dt) % (Math.PI * 2);

    for (let i = 0; i < this._wheels.length; i++) {
      const w = this._wheels[i];
      if (!w.mesh) continue;
      // Suspension: bob each wheel down when compressed
      // suspensionCompression is 0 (full extend) to ~1 (full compress)
      const susTravel = state.suspensionCompression * 0.14;
      const baseY = sampledWheelBaseY?.[i] ?? (w.baseLocalY - this._wheelMaxDrop);
      w.mesh.position.y = baseY + susTravel;

      // Roll all wheels around their axle (local X).
      w.mesh.rotation.x = this._wheelSpin;

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

  _meshColorFor(mesh) {
    const rawColorMap = this.vehicleDef?.meshColors ?? this.vehicleDef?.meshColorMap ?? {};
    const value = rawColorMap?.[mesh.name];
    if (value != null) return this._parseColor(value);
    return this.colors.body;
  }

  _parseColor(value) {
    if (Array.isArray(value) && value.length === 3) {
      return new Color3(value[0], value[1], value[2]);
    }
    if (typeof value === 'string') {
      const hex = value.trim().replace(/^#/, '');
      if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
        const intValue = parseInt(hex, 16);
        return new Color3(
          ((intValue >> 16) & 0xff) / 255,
          ((intValue >> 8) & 0xff) / 255,
          (intValue & 0xff) / 255
        );
      }
    }
    return this.colors.body;
  }

  _styleMesh(mesh, color, options = {}) {
    const mat = new StandardMaterial(`${mesh.name}Mat`, this.scene);
    mat.diffuseColor  = color;
    mat.specularColor = options.specularColor ?? new Color3(0.9, 0.9, 0.9);
    mat.specularPower = options.specularPower ?? 32;
    if (this._ghost) {
      // Uniform translucent blue, unlit so it reads clearly as a ghost.
      mat.diffuseColor  = new Color3(0.45, 0.8, 1);
      mat.emissiveColor = new Color3(0.12, 0.28, 0.45);
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = this._ghostAlpha;
      mat.disableLighting = true;
    }
    mesh.material     = mat;
    mesh.receiveShadows = !this._disableDynamicShadows && !this._ghost;
    if (this._ghost) mesh.isPickable = false;
    if (!this._disableDynamicShadows) {
      this.shadows?.addShadowCaster(mesh);
    }
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    for (const mesh of this._parts) mesh.dispose();
    this._contactShadow?.dispose();
    this._contactShadowMat?.dispose();
    this._contactShadowTex?.dispose();
    this._visualRoot.dispose();
    this._bodyDynNode.dispose();
    this._wheelRoot.dispose();
    this._parts  = [];
    this._wheels = [];
  }
}
