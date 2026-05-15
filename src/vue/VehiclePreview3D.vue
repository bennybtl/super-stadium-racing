<template>
  <div class="relative h-full w-full">
    <canvas ref="canvasRef" class="h-full w-full" />

    <div
      v-if="isLoading"
      class="absolute inset-0 flex items-center justify-center p-3 text-center text-xs uppercase tracking-[0.08em] text-[#bbb]"
    >
      Loading 3D preview...
    </div>

    <div
      v-if="errorMessage"
      class="absolute inset-0 flex items-center justify-center p-3 text-center text-[0.85rem] uppercase tracking-[0.08em] text-[#ddd]"
    >
      {{ errorMessage }}
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/OBJ';
import truckTireUrl from '../assets/models/truck-tire.obj?url';

const props = defineProps({
  vehicle: {
    type: Object,
    default: null,
  },
  selectedColor: {
    type: String,
    default: null,
  },
  colorOptions: {
    type: Array,
    default: () => [],
  },
});

const canvasRef = ref(null);
const isLoading = ref(false);
const errorMessage = ref('');

let engine = null;
let scene = null;
let camera = null;
let previewRoot = null;
let previewBodyRoot = null;
let previewMeshes = [];
let previewWheelMeshes = [];
let resizeObserver = null;
let spinObserver = null;
let activeLoadToken = 0;

const selectedColorValue = computed(() => {
  return props.colorOptions.find((option) => option.key === props.selectedColor)?.value ?? null;
});

function splitUrl(url) {
  const idx = url.lastIndexOf('/');
  if (idx === -1) return { rootUrl: '', fileName: url };
  return {
    rootUrl: url.slice(0, idx + 1),
    fileName: url.slice(idx + 1),
  };
}

function parseColor(value, fallback) {
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
    if (value.r != null) {
      return new Color3(value.r, value.g, value.b);
    }
  }

  return fallback.clone();
}

function getBasePlayerColor() {
  const defaultColor = props.vehicle?.defaultColor;
  const fallback = Array.isArray(defaultColor) && defaultColor.length === 3
    ? new Color3(defaultColor[0], defaultColor[1], defaultColor[2])
    : new Color3(0.8, 0.2, 0.1);

  return parseColor(selectedColorValue.value, fallback);
}

function colorForMesh(mesh, baseColor) {
  const rawColorMap = props.vehicle?.meshColors ?? {};
  const meshName = String(mesh.name ?? '');
  const meshNameLower = meshName.toLowerCase();
  const meshNameNormalized = meshNameLower.replace(/[^a-z0-9]/g, '');

  if (rawColorMap[meshName] != null) {
    return parseColor(rawColorMap[meshName], baseColor);
  }

  for (const key of Object.keys(rawColorMap)) {
    const keyLower = key.toLowerCase();
    const keyNormalized = keyLower.replace(/[^a-z0-9]/g, '');

    if (
      meshNameLower.includes(keyLower)
      || keyLower.includes(meshNameLower)
      || (keyNormalized.length > 0 && meshNameNormalized.includes(keyNormalized))
      || (meshNameNormalized.length > 0 && keyNormalized.includes(meshNameNormalized))
    ) {
      return parseColor(rawColorMap[key], baseColor);
    }
  }

  return baseColor.clone();
}

function applyVehicleColors() {
  if (!previewMeshes.length && !previewWheelMeshes.length) return;

  const baseColor = getBasePlayerColor();

  for (const mesh of previewMeshes) {
    if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;

    let material = mesh.material;
    if (!(material instanceof StandardMaterial)) {
      material = new StandardMaterial(`previewMat_${mesh.uniqueId}`, scene);
      mesh.material = material;
    }

    material.diffuseColor = colorForMesh(mesh, baseColor);
    material.specularColor = new Color3(0.25, 0.25, 0.25);
    material.specularPower = 32;
  }

  for (const mesh of previewWheelMeshes) {
    if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) continue;

    let material = mesh.material;
    if (!material) {
      material = new StandardMaterial(`previewWheelMat_${mesh.uniqueId}`, scene);
      mesh.material = material;
    }

    if (mesh.name.toLowerCase().includes('rim')) {
      material.diffuseColor = new Color3(1.0, 0.85, 0.12);
      material.specularColor = new Color3(0.25, 0.25, 0.25);
      material.specularPower = 24;
    } else {
      material.diffuseColor = new Color3(0.12, 0.12, 0.12);
      material.specularColor = new Color3(0.02, 0.02, 0.02);
      material.specularPower = 8;
    }
  }
}

function fitCameraToMeshes() {
  if (!camera) return;

  const allMeshes = [...previewMeshes, ...previewWheelMeshes].filter(
    (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
  );
  if (!allMeshes.length) return;

  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of allMeshes) {
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

function disposePreviewModel() {
  if (previewRoot) {
    previewRoot.dispose(false, true);
    previewRoot = null;
  }
  previewBodyRoot = null;
  previewMeshes = [];
  previewWheelMeshes = [];
}

function wheelDefsForVehicle() {
  const g = props.vehicle?.wheels ?? {};
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

async function attachWheels(myToken) {
  if (!scene || !previewRoot) return;

  try {
    const { rootUrl, fileName } = splitUrl(truckTireUrl);
    const tireResult = await SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);

    if (myToken !== activeLoadToken) {
      tireResult.meshes.forEach((mesh) => mesh.dispose());
      return;
    }

    const tireVisualMeshes = tireResult.meshes.filter(
      (mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0
    );
    if (!tireVisualMeshes.length) return;

    // Create and apply materials to source meshes
    tireVisualMeshes.forEach((mesh) => {
      mesh.setEnabled(false);
      mesh.parent = previewRoot;

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

    const wheelDefs = wheelDefsForVehicle();
    const rimSource = tireVisualMeshes[1] ?? null;
    const tireSource = tireVisualMeshes[0] ?? null;

    for (const wheel of wheelDefs) {
      const wheelRoot = new TransformNode(`previewWheelRoot_${wheel.id}`, scene);
      wheelRoot.parent = previewRoot;
      wheelRoot.position.set(wheel.x, wheel.y, wheel.z);
      wheelRoot.scaling.x = wheel.x > 0 ? -(wheel.scale[0] ?? 1.2) : (wheel.scale[0] ?? 1.2);
      wheelRoot.scaling.y = wheel.scale[1] ?? 1.2;
      wheelRoot.scaling.z = wheel.scale[2] ?? 1.2;

      if (tireSource) {
        const tireInstance = tireSource.createInstance(`previewTire_${wheel.id}`);
        tireInstance.parent = wheelRoot;
        tireInstance.isPickable = false;
        tireInstance.setEnabled(true);
        previewWheelMeshes.push(tireInstance);
      }

      if (rimSource) {
        const rimInstance = rimSource.createInstance(`previewRim_${wheel.id}`);
        rimInstance.parent = wheelRoot;
        rimInstance.isPickable = false;
        rimInstance.setEnabled(true);
        previewWheelMeshes.push(rimInstance);
      }
    }
  } catch (error) {
    console.warn('[VehiclePreview3D] Failed to load tire model for preview wheels:', error);
  }
}

async function loadVehicleModel() {
  const vehicle = props.vehicle;
  const modelUrl = vehicle?.modelUrl;
  const myToken = ++activeLoadToken;

  disposePreviewModel();
  errorMessage.value = '';

  if (!scene) return;

  if (!vehicle) {
    errorMessage.value = 'No Vehicle Selected';
    return;
  }

  if (!modelUrl) {
    errorMessage.value = `${vehicle.name ?? 'Vehicle'} preview unavailable`;
    return;
  }

  isLoading.value = true;

  try {
    const { rootUrl, fileName } = splitUrl(modelUrl);
    const result = await SceneLoader.ImportMeshAsync('', rootUrl, fileName, scene);

    if (myToken !== activeLoadToken) {
      result.meshes.forEach((mesh) => mesh.dispose());
      return;
    }

    previewRoot = new TransformNode(`previewRoot_${vehicle.key ?? 'vehicle'}`, scene);
    previewBodyRoot = new TransformNode(`previewBodyRoot_${vehicle.key ?? 'vehicle'}`, scene);
    previewBodyRoot.parent = previewRoot;

    const bodyTransform = vehicle.bodyTransform ?? {};
    const pos = bodyTransform.position ?? [0, 0, 0];
    const rot = bodyTransform.rotation ?? [0, 0, 0];
    const scl = bodyTransform.scaling ?? [1, 1, 1];

    previewBodyRoot.position.set(pos[0] ?? 0, pos[1] ?? 0, pos[2] ?? 0);
    previewBodyRoot.rotation.set(rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0);
    previewBodyRoot.scaling.set(scl[0] ?? 1, scl[1] ?? 1, scl[2] ?? 1);

    previewMeshes = result.meshes.filter((mesh) => mesh.getTotalVertices && mesh.getTotalVertices() > 0);
    previewMeshes.forEach((mesh) => {
      mesh.parent = previewBodyRoot;
      mesh.receiveShadows = false;
      mesh.isPickable = false;
    });

    if (!previewMeshes.length) {
      errorMessage.value = 'Preview model has no renderable meshes';
      return;
    }

    await attachWheels(myToken);

    applyVehicleColors();
    fitCameraToMeshes();
  } catch (error) {
    if (myToken === activeLoadToken) {
      console.warn('[VehiclePreview3D] Failed to load vehicle model:', error);
      errorMessage.value = `${vehicle.name ?? 'Vehicle'} preview unavailable`;
    }
  } finally {
    if (myToken === activeLoadToken) {
      isLoading.value = false;
    }
  }
}

onMounted(() => {
  if (!canvasRef.value) return;

  engine = new Engine(canvasRef.value, true, {
    antialias: true,
    preserveDrawingBuffer: false,
    stencil: false,
  });

  scene = new Scene(engine);
  scene.clearColor = new Color4(1, 1, 1, 0);

  camera = new ArcRotateCamera('previewCamera', -Math.PI / 2, Math.PI / 2.9, 3, new Vector3(0, 0.4, 0), scene);

  const hemi = new HemisphericLight('previewHemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;

  const keyLight = new DirectionalLight('previewKey', new Vector3(-0.3, -1, -0.2), scene);
  keyLight.position = new Vector3(0, 4, 4);
  keyLight.intensity = 0.5;

  spinObserver = scene.onBeforeRenderObservable.add(() => {
    if (previewRoot) {
      previewRoot.rotation.y += 0.008;
    }
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  resizeObserver = new ResizeObserver(() => {
    engine?.resize();
  });
  resizeObserver.observe(canvasRef.value);

  loadVehicleModel();
});

onUnmounted(() => {
  activeLoadToken++;
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (scene && spinObserver) {
    scene.onBeforeRenderObservable.remove(spinObserver);
    spinObserver = null;
  }

  disposePreviewModel();
  scene?.dispose();
  scene = null;
  engine?.dispose();
  engine = null;
  camera = null;
});

watch(
  () => props.vehicle?.key,
  () => {
    loadVehicleModel();
  }
);

watch(
  () => props.selectedColor,
  () => {
    applyVehicleColors();
  }
);
</script>
