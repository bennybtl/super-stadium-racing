import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  PhysicsAggregate,
  PhysicsShapeType,
} from "@babylonjs/core";

const TIRE_OUTER_RADIUS  = 0.42;  // outer radius of the torus
const TIRE_TUBE_RADIUS   = 0.14;  // thickness of the torus tube
const TIRE_HEIGHT        = TIRE_TUBE_RADIUS * 2; // how tall one tire sits
const TIRES_PER_STACK    = 4;
const STACK_MASS         = 40;    // total mass of the whole rigid stack

/**
 * TireStackManager — creates and manages movable tire stacks on the track.
 *
 * Each stack is a single rigid unit: one invisible BOX physics body with
 * three torus meshes parented to it as pure visuals. The whole group tumbles
 * together when hit by a truck.
 */
export class TireStackManager {
  constructor(scene, track, shadows) {
    this.scene   = scene;
    this.track   = track;
    this.shadows = shadows;

    // Array of { body: Mesh, tires: Mesh[], aggregate: PhysicsAggregate }
    this._stacks = [];
  }

  // ─── Creation ────────────────────────────────────────────────────────────

  createTireStacks() {
    for (const feature of this.track.features) {
      if (feature.type === "tireStack") {
        this._createStack(feature);
      }
    }
  }

  _createStack(feature) {
    const { x, z } = feature;
    const groundY  = this.track.getHeightAt(x, z);

    // Total height of the stacked tires
    const stackHeight = TIRES_PER_STACK * TIRE_HEIGHT * 2;
    const stackCentreY = groundY + stackHeight / 2;

    // Invisible physics body — a box that tightly wraps all 3 tires
    const body = MeshBuilder.CreateBox(`tireStack_${x}_${z}`, {
      width:  TIRE_OUTER_RADIUS * 2,
      height: stackHeight,
      depth:  TIRE_OUTER_RADIUS * 2,
    }, this.scene);
    body.position   = new Vector3(x, stackCentreY, z);
    body.isVisible  = false;
    body.isPickable = false;

    const aggregate = new PhysicsAggregate(body, PhysicsShapeType.BOX, {
      mass:        STACK_MASS,
      restitution: 0.2,
      friction:    0.8,
    }, this.scene);

    // Linear damping: 0 = slides forever, 1 = stops almost instantly.
    // Angular damping: controls how quickly it stops spinning/tumbling.
    aggregate.body.setLinearDamping(0.6);
    aggregate.body.setAngularDamping(0.4);

    // Visual torus meshes parented to the body — they move with it for free
    const tires = [];
    for (let i = 0; i < TIRES_PER_STACK; i++) {
      const tire = MeshBuilder.CreateTorus(`tire_${x}_${z}_${i}`, {
        diameter:     TIRE_OUTER_RADIUS * 2,
        thickness:    TIRE_TUBE_RADIUS * 2,
        tessellation: 16,
      }, this.scene);

      // Position relative to the body's centre
      const localY = -stackHeight / 2 + TIRE_TUBE_RADIUS + i * TIRE_HEIGHT;
      tire.position   = new Vector3(0, localY, 0);
      tire.rotation.y = Math.PI / 2; // lay flat
      tire.parent     = body;

      this._applyTireMaterial(tire);
      this.shadows.addShadowCaster(tire);
      tire.receiveShadows = true;
      tires.push(tire);
    }

    this._stacks.push({ body, tires, aggregate });
  }

  // ─── Per-frame interaction ────────────────────────────────────────────────

  /**
   * Call every frame after trucks have moved.
   * Detects truck ↔ stack proximity, launches the stack with a physics impulse,
   * and bleeds speed from the truck proportional to the impact.
   */
  update(trucks) {
    // Combined contact radius: truck (≈half-diagonal of 1.5×2.2 box) + stack
    const TRUCK_RADIUS   = 1.1;
    const CONTACT_DIST   = TRUCK_RADIUS + TIRE_OUTER_RADIUS;
    // Maximum fraction of truck speed lost per hit (capped so we don't reverse the truck)
    const MAX_SLOW       = 0.55;

    for (const stack of this._stacks) {
      const sp = stack.body.position;

      for (const truckData of trucks) {
        const truck = truckData.truck ?? truckData;
        if (!truck.mesh || !truck.state) continue;

        const tp  = truck.mesh.position;
        const dx  = sp.x - tp.x;
        const dz  = sp.z - tp.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > CONTACT_DIST || dist < 0.01) continue;

        // Unit vector from truck → stack
        const nx = dx / dist;
        const nz = dz / dist;

        // How hard the stack gets kicked per unit of approach speed × truck mass proxy
        const IMPULSE_SCALE  = STACK_MASS * 0.3;

        // How fast the truck is moving toward the stack
        // nx/nz points truck→stack, so a positive dot = truck approaching
        const vel = truck.state.velocity;
        const approach = vel.x * nx + vel.z * nz; // positive = approaching
        if (approach <= 0) continue; // already separating

        // ── Kick the stack ──────────────────────────────────────────────
        const impulseMag = approach * IMPULSE_SCALE;
        stack.aggregate.body.applyImpulse(
          new Vector3(nx * impulseMag, impulseMag * 0.25, nz * impulseMag),
          sp.clone()
        );

        // ── Slow the truck ──────────────────────────────────────────────
        const slowFactor = Math.min(MAX_SLOW, approach * 0.04);
        vel.x *= (1 - slowFactor);
        vel.z *= (1 - slowFactor);
      }
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  reset() {
    this._dispose();
    this.createTireStacks();
  }

  dispose() {
    this._dispose();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  _applyTireMaterial(mesh) {
    const mat = new StandardMaterial("tireMat", this.scene);
    mat.diffuseColor  = new Color3(0.08, 0.08, 0.08);
    mat.specularColor = new Color3(0.05, 0.05, 0.05);
    mesh.material = mat;
  }

  _dispose() {
    for (const stack of this._stacks) {
      stack.aggregate.dispose();
      for (const tire of stack.tires) tire.dispose();
      stack.body.dispose();
    }
    this._stacks = [];
  }
}
