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
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core';
import { loadVehicleModel, fitCameraToMeshes } from './loadVehicleModel.js';

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
let model = null;
let resizeObserver = null;
let spinObserver = null;
let activeLoadToken = 0;

const selectedColorValue = computed(() => {
  return props.colorOptions.find((option) => option.key === props.selectedColor)?.value ?? null;
});

function disposeModel() {
  model?.dispose();
  model = null;
}

async function loadModel() {
  const vehicle = props.vehicle;
  const myToken = ++activeLoadToken;

  disposeModel();
  errorMessage.value = '';

  if (!scene) return;

  if (!vehicle) {
    errorMessage.value = 'No Vehicle Selected';
    return;
  }

  if (!vehicle.modelUrl) {
    errorMessage.value = `${vehicle.name ?? 'Vehicle'} preview unavailable`;
    return;
  }

  isLoading.value = true;

  try {
    const loaded = await loadVehicleModel(scene, vehicle, {
      colorValue: selectedColorValue.value,
      isStale: () => myToken !== activeLoadToken,
    });
    if (!loaded) return;

    if (!loaded.bodyMeshes.length) {
      loaded.dispose();
      errorMessage.value = 'Preview model has no renderable meshes';
      return;
    }

    model = loaded;
    fitCameraToMeshes(camera, [...loaded.bodyMeshes, ...loaded.wheelMeshes]);
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
    if (model) model.root.rotation.y += 0.008;
  });

  engine.runRenderLoop(() => {
    scene.render();
  });

  resizeObserver = new ResizeObserver(() => {
    engine?.resize();
  });
  resizeObserver.observe(canvasRef.value);

  loadModel();
});

onUnmounted(() => {
  activeLoadToken++;
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (scene && spinObserver) {
    scene.onBeforeRenderObservable.remove(spinObserver);
    spinObserver = null;
  }

  disposeModel();
  scene?.dispose();
  scene = null;
  engine?.dispose();
  engine = null;
  camera = null;
});

watch(
  () => props.vehicle?.key,
  () => {
    loadModel();
  }
);

watch(
  () => props.selectedColor,
  () => {
    model?.recolor(selectedColorValue.value);
  }
);
</script>
