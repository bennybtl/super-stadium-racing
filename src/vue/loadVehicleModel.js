import { Color3, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/OBJ';
import truckTireUrl from '../assets/models/truck-tire-v2.obj?url';
import { basicColors } from '../constants';

// Shared vehicle-model loader for the Vue Babylon previews (TruckSelection's
// spinner and the race-results podium). Loads the body OBJ plus four wheels
// under one root node, tints the colourable meshes to the driver colour, and
// hands back the nodes + a dispose(). Camera framing and animation stay with
// the caller.

function splitUrl(url) {
  const idx = url.lastIndexOf('/');
  if (idx === -1) return { rootUrl: '', fileName: url };
  return { rootUrl: url.slice(0, idx + 1), fileName: url.slice(idx + 1) };
}

/**
 * Coerce a colour in any of the shapes the vehicle data uses (hex string,
 * [r,g,b] 0..1, { r,g,b }, { diffuse:{r,g,b} }, Color3) into a Color3.
 */
export function parseColor(value, fallback) {
  if (value instanceof Color3) return value.clone();

  if (Array.isArray(value) && value.length === 3) {
    return new Color3(value[0], value[1], value[2]);
  }

  if (typeof value === 'string') {
    const normalized = value.replace('#', '').trim();
    if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
      const packed = parseInt(normalized, 16);
      return new Color3(
        ((packed >> 16) & 0xff) / 255,
        ((packed >> 8) & 0xff) / 255,
        (packed & 0xff) / 255,
      );
    }
  }

  if (value && typeof value === 'object') {
    if (value.diffuse && value.diffuse.r != null) {
      return new Color3(value.diffuse.r, value.diffuse.g, value.diffuse.b);
    }
    if (value.r != null) return new Color3(value.r, value.g, value.b);
  }

  return fallback.clone();
}

function basePlayerColor(vehicle, colorValue) {
  const defaultColor = vehicle?.defaultColor;
  const fallback = Array.isArray(defaultColor) && defaultColor.length === 3
    ? new Color3(defaultColor[0], defaultColor[1], defaultColor[2])
    : new Color3(0.8, 0.2, 0.1);
  return parseColor(colorValue, fallback);
}

function colorForMesh(vehicle, mesh, baseColor) {
  const name = String(mesh.name ?? '');
  if (vehicle?.colorableMeshes?.includes(name)) return baseColor.clone();
  const baked = vehicle?.meshDefaultColors?.[name];
  if (baked != null) return parseColor(baked, baseColor);
  return baseColor.clone();
}

function applyColors(scene, vehicle, bodyMeshes, wheelMeshes, baseColor) {
  for (const mesh of bodyMeshes) {
    if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;

    let material = mesh.material;
    if (!(material instanceof StandardMaterial)) {
      material = new StandardMaterial(`vehMat_${mesh.uniqueId}`, scene);
      mesh.material = material;
    }
    material.diffuseColor = colorForMesh(vehicle, mesh, baseColor);
    material.specularColor = new Color3(0.25, 0.25, 0.25);
    material.specularPower = 32;
  }

  for (const mesh of wheelMeshes) {
    if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;

    let material = mesh.material;
    if (!material) {
      material = new StandardMaterial(`vehWheelMat_${mesh.uniqueId}`, scene);
      mesh.material = material;
    }
    if (mesh.name.toLowerCase().includes('rim')) {
      material.diffuseColor = basicColors.white.diffuse;
      material.specularColor = new Color3(0.25, 0.25, 0.25);
      material.specularPower = 24;
    } else {
      material.diffuseColor = basicColors.black.diffuse;
      material.specularColor = new Color3(0.02, 0.02, 0.02);
      material.specularPower = 8;
    }
  }
}

function wheelDefsForVehicle(vehicle) {
  const g = vehicle?.wheels ?? {};
  const frontHalfTrack = (g.frontTrackWidth ?? g.trackWidth ?? 2.4) / 2;
  const rearHalfTrack = (g.rearTrackWidth ?? g.trackWidth ?? 2.4) / 2;
  const frontAxle = g.frontAxle ?? 1.5;
  const rearAxle = g.rearAxle ?? -1.2;
  const frontScale = g.frontScale ?? [1.2, 1.2, 1.2];
  const rearScale = g.rearScale ?? [1.2, 1.2, 1.2];
  const baseY = g.baseYOffset ?? 0.2;

  return [
    { id: 'FL', x: frontHalfTrack, z: frontAxle, scale: frontScale },
    { id: 'FR', x: -frontHalfTrack, z: frontAxle, scale: frontScale },
    { id: 'RL', x: rearHalfTrack, z: rearAxle, scale: rearScale },
    { id: 'RR', x: -rearHalfTrack, z: rearAxle, scale: rearScale },
  ].map((wheel) => ({ ...wheel, y: baseY }));
}

async function attachWheels(scene, vehicle, root, wheelMeshes, isStale) {
  try {
    const { rootUrl, fileName } = splitUrl(truckTireUrl);
    const tireResult = await SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);

    if (isStale()) {
      tireResult.meshes.forEach((mesh) => mesh.dispose());
      return;
    }

    const tireVisualMeshes = tireResult.meshes.filter(
      (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
    );
    if (!tireVisualMeshes.length) return;

    tireVisualMeshes.forEach((mesh) => {
      mesh.setEnabled(false);
      mesh.parent = root;

      const material = new StandardMaterial(`sourceMat_${mesh.uniqueId}`, scene);
      if (mesh.name.toLowerCase().includes('rim')) {
        material.diffuseColor = new Color3(1.0, 0.85, 0.12);
        material.specularColor = new Color3(0.25, 0.25, 0.25);
        material.specularPower = 24;
      } else {
        material.diffuseColor = new Color3(0.12, 0.12, 0.12);
        material.specularColor = new Color3(0.02, 0.02, 0.02);
        material.specularPower = 8;
      }
      mesh.material = material;
    });

    const wheelDefs = wheelDefsForVehicle(vehicle);
    const rimSource = tireVisualMeshes[1] ?? null;
    const tireSource = tireVisualMeshes[0] ?? null;

    for (const wheel of wheelDefs) {
      const wheelRoot = new TransformNode(`wheelRoot_${wheel.id}`, scene);
      wheelRoot.parent = root;
      wheelRoot.position.set(wheel.x, wheel.y, wheel.z);
      wheelRoot.scaling.x = wheel.x > 0 ? -(wheel.scale[0] ?? 1.2) : (wheel.scale[0] ?? 1.2);
      wheelRoot.scaling.y = wheel.scale[1] ?? 1.2;
      wheelRoot.scaling.z = wheel.scale[2] ?? 1.2;

      if (tireSource) {
        const tireInstance = tireSource.createInstance(`tire_${wheel.id}`);
        tireInstance.parent = wheelRoot;
        tireInstance.isPickable = false;
        tireInstance.setEnabled(true);
        wheelMeshes.push(tireInstance);
      }
      if (rimSource) {
        const rimInstance = rimSource.createInstance(`rim_${wheel.id}`);
        rimInstance.parent = wheelRoot;
        rimInstance.isPickable = false;
        rimInstance.setEnabled(true);
        wheelMeshes.push(rimInstance);
      }
    }
  } catch (error) {
    console.warn('[loadVehicleModel] Failed to load tire model:', error);
  }
}

/**
 * Fit an ArcRotateCamera around a set of meshes (front-on, slightly raised).
 */
export function fitCameraToMeshes(camera, meshes) {
  if (!camera) return;
  const visible = meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
  if (!visible.length) return;

  let min = new Vector3(Infinity, Infinity, Infinity);
  let max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of visible) {
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo();
    min = Vector3.Minimize(min, info.boundingBox.minimumWorld);
    max = Vector3.Maximize(max, info.boundingBox.maximumWorld);
  }

  const center = min.add(max).scale(0.45);
  const extents = max.subtract(min);
  const diameter = Math.max(extents.x, extents.y, extents.z, 1);

  camera.target.copyFrom(center);
  camera.radius = diameter * 1.3;
  camera.alpha = -Math.PI / 2;
  camera.beta = Math.PI / 2.9;
}

/**
 * Load a vehicle body + wheels into `scene` under a fresh root node.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @param {object} vehicle  VehicleLoader definition (needs modelUrl; may carry
 *   bodyTransform, wheels, colorableMeshes, meshDefaultColors, defaultColor).
 * @param {object} [opts]
 * @param {*} [opts.colorValue]  driver colour in any parseColor shape; falls
 *   back to the vehicle's defaultColor.
 * @param {() => boolean} [opts.isStale]  polled after each await; when it turns
 *   true the partial load is disposed and the call resolves to null.
 * @returns {Promise<null | {
 *   root: TransformNode, bodyRoot: TransformNode,
 *   bodyMeshes: any[], wheelMeshes: any[],
 *   recolor: (colorValue: any) => void, dispose: () => void,
 * }>}
 */
export async function loadVehicleModel(scene, vehicle, opts = {}) {
  const { colorValue = null, isStale = () => false } = opts;
  if (!scene || !vehicle?.modelUrl) return null;

  const { rootUrl, fileName } = splitUrl(vehicle.modelUrl);
  const result = await SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);

  if (isStale()) {
    result.meshes.forEach((mesh) => mesh.dispose());
    return null;
  }

  const root = new TransformNode(`vehRoot_${vehicle.id ?? 'vehicle'}`, scene);
  const bodyRoot = new TransformNode(`vehBodyRoot_${vehicle.id ?? 'vehicle'}`, scene);
  bodyRoot.parent = root;

  const bt = vehicle.bodyTransform ?? {};
  const pos = bt.position ?? [0, 0, 0];
  const rot = bt.rotation ?? [0, 0, 0];
  const scl = bt.scaling ?? [1, 1, 1];
  bodyRoot.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
  bodyRoot.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
  bodyRoot.scaling.set(scl[0] ?? 1, scl[1] ?? 1, scl[2] ?? 1);

  const bodyMeshes = result.meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
  bodyMeshes.forEach((mesh) => {
    mesh.parent = bodyRoot;
    mesh.receiveShadows = false;
    mesh.isPickable = false;
  });

  const wheelMeshes = [];
  await attachWheels(scene, vehicle, root, wheelMeshes, isStale);
  if (isStale()) {
    root.dispose(false, true);
    return null;
  }

  const recolor = (value) => {
    applyColors(scene, vehicle, bodyMeshes, wheelMeshes, basePlayerColor(vehicle, value));
  };
  recolor(colorValue);

  return {
    root,
    bodyRoot,
    bodyMeshes,
    wheelMeshes,
    recolor,
    dispose: () => root.dispose(false, true),
  };
}
