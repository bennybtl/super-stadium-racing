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
  constructor(x, z, groundY, type, scene, shadows) {
    this.type   = type;
    this.scene  = scene;
    this._baseY = groundY + 1.2;
    this._time  = Math.random() * Math.PI * 2; // random phase so pickups don't all bob in sync
    this._aura  = null;

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

    const loadObjModel = (url, { tiltX = 0 } = {}) => {
      const lastSlash = url.lastIndexOf("/");
      const rootUrl = url.substring(0, lastSlash + 1);
      const fileName = url.substring(lastSlash + 1);

      SceneLoader.ImportMeshAsync("", rootUrl, fileName, scene)
        .then((result) => {
          if (!result.meshes.length) return;

          // Dispose default primitives and replace with loaded.
          // Babylon will automatically drop disposed meshes from shadow caster lists.
          this._core.dispose();
          this._ring.dispose();

          this._core = new TransformNode(`pickup_obj_${type}_${x}_${z}`, scene);
          this._core.parent = this._root;
          this._core.rotation.x = tiltX;
          this._ring = null;

          for (const m of result.meshes) {
            m.parent = this._core;
            shadows.addShadowCaster(m);
            // Optionally apply the golden material if it didn't come with one.
            if (!m.material || m.material.name === "default material") {
              m.material = coreMat;
            }
          }
        })
        .catch(e => {
          console.warn(`Could not load ${fileName}, falling back to primitive geo.`, e);
        });
    };

    // Try loading custom OBJ models per pickup type.
    if (type === 'boost') {
      loadObjModel(nitroUrl, { tiltX: -Math.PI / 4 });
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
    if (this._core) {
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
