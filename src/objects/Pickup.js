import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  SceneLoader,
} from "@babylonjs/core";
import "@babylonjs/loaders/OBJ/index.js";
import nitroUrl from "../assets/models/nitro.obj?url";
import coinUrl from "../assets/models/coin.obj?url";
import { basicColors } from "../constants.js";

// Keep visual sizing constants exported so PickupManager can match collect radius.
const AURA_DIAMETER = 2.15;
const AURA_THICKNESS = 0.24;
const AURA_MAX_PULSE = 1.08;
export const PICKUP_MAX_TORUS_DIAMETER = (AURA_DIAMETER + AURA_THICKNESS) * AURA_MAX_PULSE;

function getPickupColor(type) {
  switch (type) {
    case 'boost':
      return basicColors.blue
    case 'coin':
      return basicColors.yellow
    default:
      return basicColors.red
  };
}

/**
 * Pickup — a single collectable item floating above the ground.
 *
 * Visual: a spinning octahedron core inside a slowly-rotating torus ring.
 * Bobs gently up and down via per-frame update().
 *
 * Supported types:
 *   'boost' — awards +1 nitro boost to the collecting truck
 *   'coin'  — awards random season budget credits on collect
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
  constructor(x, z, groundY, type, scene, shadows, value = 1) {
    this.type   = type;
    this.value  = value; // nitro count granted on collect (1x / 2x / 3x)
    this.scene  = scene;
    this._baseY = groundY + 1.2;
    this._time  = Math.random() * Math.PI * 2; // random phase so pickups don't all bob in sync
    this._aura  = null;
    this._bottles = null; // loaded-model groups (one per value: 1x/2x/3x nitro)

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
    const { diffuse, emissive } = getPickupColor(type);

    coreMat.diffuseColor  = diffuse;
    coreMat.emissiveColor = emissive;
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
    ringMat.diffuseColor  = diffuse;
    ringMat.emissiveColor = emissive;
    this._ring.material = ringMat;
    shadows.addShadowCaster(this._ring);

    // Persistent visibility ring that stays even when custom pickup meshes load.
    this._aura = MeshBuilder.CreateTorus(
      `pickup_aura_${x}_${z}`,
      { diameter: AURA_DIAMETER, thickness: AURA_THICKNESS, tessellation: 48 },
      scene
    );
    this._aura.parent = this._root;

    const auraMat = new StandardMaterial(`pickupAuraMat_${x}_${z}`, scene);
    auraMat.diffuseColor = new Color3(0, 0, 0);
    auraMat.emissiveColor = emissive;
    auraMat.specularColor = new Color3(0, 0, 0);
    auraMat.disableLighting = true;
    auraMat.alpha = 0.95;
    this._aura.material = auraMat;

    const loadObjModel = (url, { tiltX = 0, count = 1, spacing = 0.8 } = {}) => {
      const lastSlash = url.lastIndexOf("/");
      const rootUrl = url.substring(0, lastSlash + 1);
      const fileName = url.substring(lastSlash + 1);

      SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene)
        .then((result) => {
          if (!result.meshes.length) return;

          // Dispose default primitives and replace with loaded.
          // Babylon will automatically drop disposed meshes from shadow caster lists.
          this._core.dispose();
          this._ring?.dispose();

          this._core = new TransformNode(`pickup_obj_${type}_${x}_${z}`, scene);
          this._core.parent = this._root;
          this._ring = null;

          // First "bottle" groups the imported meshes; higher-value pickups clone
          // it into a centered row (2x = two bottles, 3x = three).
          const bottle0 = new TransformNode(`pickup_bottle0_${x}_${z}`, scene);
          bottle0.parent = this._core;
          for (const m of result.meshes) {
            m.parent = bottle0;
            shadows.addShadowCaster(m);
            if (!m.material || m.material.name === "default material") {
              m.material = coreMat;
            }
          }

          this._bottles = [bottle0];
          for (let i = 1; i < count; i++) {
            const clone = bottle0.clone(`pickup_bottle${i}_${x}_${z}`, this._core);
            if (!clone) continue;
            this._bottles.push(clone);
            for (const cm of clone.getChildMeshes()) shadows.addShadowCaster(cm);
          }
          // Tilt each bottle here (not on the parent) so update()'s rotation.y
          // spins it around the world-vertical axis — tilting the parent instead
          // would tilt the spin axis too.
          this._bottles.forEach((b, i) => {
            b.position.x = (i - (count - 1) / 2) * spacing;
            b.rotation.x = tiltX;
          });
        })
        .catch(e => {
          console.warn(`Could not load ${fileName}, falling back to primitive geo.`, e);
        });
    };

    // Try loading custom OBJ models per pickup type. Boost pickups render one
    // nitro bottle per value point (1x/2x/3x).
    if (type === 'boost') {
      loadObjModel(nitroUrl, { tiltX: -Math.PI / 4, count: Math.max(1, value) });
    } else if (type === 'coin') {
      loadObjModel(coinUrl, { tiltX: Math.PI / 2 });
    }
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
    
    // Animate rotation based on whether we use the default geometry or the custom .obj
    if (this._bottles) {
      // Each nitro bottle spins in place so a 2x/3x row stays readable as a row.
      for (const b of this._bottles) b.rotation.y = this._time * 2.2;
    } else if (this._core) {
      if (this._ring) {
        // Spin default core on two axes for a jewel-tumble effect
        this._core.rotation.y = this._time * 2.2;
        this._core.rotation.x = this._time * 0.9;
      } else {
        // Loaded OBJ models spin cleanly around Y.
        this._core.rotation.y = this._time * 2.2;
      }
    }
    
    // Counter-rotate default ring slowly
    if (this._ring) {
      this._ring.rotation.z = this._time * 1.1;
    }

    // Slow spin + subtle pulse to improve pickup readability at distance.
    if (this._aura) {
      const pulse = 1 + Math.sin(this._time * 3.8) * 0.08;
      this._aura.scaling.set(pulse, pulse, pulse);
    }
  }

  dispose() {
    this._core?.material?.dispose();
    this._ring?.material?.dispose();
    this._aura?.material?.dispose();
    this._core?.dispose();
    this._ring?.dispose();
    this._aura?.dispose();
    this._root?.dispose();
  }
}
