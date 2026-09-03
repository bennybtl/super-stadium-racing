<template>
  <div ref="hostRef" class="relative h-full w-full">
    <canvas ref="canvasRef" class="h-full w-full" />

    <!-- HTML overlay labels, positioned over each podium block's front face -->
    <div
      v-for="label in labels"
      :key="label.position"
      class="pointer-events-none absolute -translate-x-1/2 text-center select-none"
      :style="{ left: `${label.x}px`, top: `${label.y}px` }"
    >
      <div class="text-2xl font-extrabold italic leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
        {{ ordinal(label.position) }}
      </div>
      <div class="mt-1 text-sm font-bold uppercase italic tracking-[0.12em] text-[#ffe066] drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
        {{ label.name }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Matrix,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { loadVehicleModel } from './loadVehicleModel.js';

const props = defineProps({
  // Top finishers, best first: [{ position, name, vehicleKey, color: [r,g,b] }]
  entries: { type: Array, default: () => [] },
});

const hostRef = ref(null);
const canvasRef = ref(null);
const labels = ref([]);

let engine = null;
let scene = null;
let camera = null;
let podiumRoot = null;
let models = [];
let resizeObserver = null;
let loadToken = 0;

// Blocks are laid out 2 – 1 – 3: winner centre and tallest.
const BLOCK = { w: 3, d: 3.2 };
const SLOTS = {
  1: { x: 0.0, h: 1.75, medal: [0.85, 0.64, 0.13] },
  2: { x: -4.05, h: 1.15, medal: [0.75, 0.78, 0.82] },
  3: { x: 4.05, h: 0.7, medal: [0.68, 0.42, 0.2] },
};
const TRUCK_SCALE = 0.78;
// Push the 2nd/3rd labels outward from centre (label anchors only — blocks and
// trucks stay put). 1 = under the block, >1 = further out.
const LABEL_X_SPREAD = 1.75;

function ordinal(n) {
  return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
}

function makeMaterial(name, rgb, emissiveScale = 0.25) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = new Color3(...rgb);
  mat.emissiveColor = new Color3(rgb[0] * emissiveScale, rgb[1] * emissiveScale, rgb[2] * emissiveScale);
  mat.specularColor = new Color3(0.2, 0.2, 0.2);
  return mat;
}

function buildPodiumBlocks() {
  podiumRoot = new TransformNode('podiumRoot', scene);
  for (const [pos, slot] of Object.entries(SLOTS)) {
    const block = MeshBuilder.CreateBox(`podiumBlock_${pos}`, {
      width: BLOCK.w,
      depth: BLOCK.d,
      height: slot.h,
    }, scene);
    block.parent = podiumRoot;
    block.position.set(slot.x, slot.h / 2, 0);
    block.material = makeMaterial(`podiumMat_${pos}`, slot.medal);
  }
}

async function buildTrucks() {
  const myToken = ++loadToken;
  disposeModels();

  const loader = window.vehicleLoader;

  for (const entry of props.entries.slice(0, 3)) {
    const slot = SLOTS[entry.position];
    if (!slot) continue;

    const holder = new TransformNode(`truckHolder_${entry.position}`, scene);
    holder.parent = podiumRoot;
    holder.position.set(slot.x, slot.h, 0);
    // Face the camera, with a small random yaw jitter so the row isn't uniform.
    holder.rotation.y = Math.PI + (Math.random() * 2 - 1) * (10 * Math.PI / 180);
    holder.scaling.setAll(TRUCK_SCALE);
    models.push({ dispose: () => holder.dispose(false, true) });

    const vehicleDef = entry.vehicleKey ? loader?.getVehicle(entry.vehicleKey) : null;

    if (!vehicleDef?.modelUrl) {
      placeholderTruck(holder, entry.color);
      continue;
    }

    try {
      const loaded = await loadVehicleModel(scene, vehicleDef, {
        colorValue: entry.color,
        isStale: () => myToken !== loadToken,
      });
      if (myToken !== loadToken) { loaded?.dispose(); return; }
      if (loaded) {
        loaded.root.parent = holder;
        seatOnBlock(loaded, slot.h);
      } else {
        placeholderTruck(holder, entry.color);
      }
    } catch (err) {
      console.warn('[RacePodium3D] vehicle model failed, using placeholder:', err);
      if (myToken === loadToken) placeholderTruck(holder, entry.color);
    }
  }
}

// The vehicle OBJs aren't authored with their origin at the tyre contact patch,
// so drop the model until its lowest point rests on the block's top face.
function seatOnBlock(loaded, blockTopY) {
  const meshes = [...loaded.bodyMeshes, ...loaded.wheelMeshes]
    .filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
  let minY = Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    minY = Math.min(minY, mesh.getBoundingInfo().boundingBox.minimumWorld.y);
  }
  if (Number.isFinite(minY)) loaded.root.position.y += blockTopY - minY;
}

function placeholderTruck(holder, color) {
  const box = MeshBuilder.CreateBox('podiumTruckFallback', { width: 2.4, depth: 4, height: 1.4 }, scene);
  box.parent = holder;
  box.position.y = 0.7;
  box.material = makeMaterial('podiumTruckFallbackMat', color ?? [0.8, 0.2, 0.1], 0.15);
}

function disposeModels() {
  for (const m of models) m.dispose();
  models = [];
}

// Static camera, so label anchors only move on resize. Anchor at the front
// face centre of each block and project to canvas pixels.
let _labelSig = '';
function updateLabels() {
  if (!scene || !camera || !engine) return;
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const next = [];
  for (const entry of props.entries.slice(0, 3)) {
    const slot = SLOTS[entry.position];
    if (!slot) continue;
    // Anchor just below each block's front-bottom edge so the labels sit in a
    // row under the podium.
    const anchor = new Vector3(slot.x * LABEL_X_SPREAD, -3, BLOCK.d / 3 + 0.15);
    const p = Vector3.Project(
      anchor,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(w, h),
    );
    next.push({ position: entry.position, name: entry.name, x: Math.round(p.x), y: Math.round(p.y) });
  }
  // The camera is static — only publish when the projected layout actually
  // moves (first frames, resize) so the overlay isn't re-rendered every frame.
  const sig = JSON.stringify(next);
  if (sig === _labelSig) return;
  _labelSig = sig;
  labels.value = next;
}

onMounted(() => {
  if (!canvasRef.value) return;

  engine = new Engine(canvasRef.value, true, { antialias: true, stencil: false });
  scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);

  camera = new ArcRotateCamera('podiumCamera', -Math.PI / 2, 1.12, 6.0, new Vector3(0, 1.1, 0), scene);
  camera.fov = 0.9;

  const hemi = new HemisphericLight('podiumHemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.95;
  const key = new DirectionalLight('podiumKey', new Vector3(-0.3, -1, -0.4), scene);
  key.position = new Vector3(4, 8, 6);
  key.intensity = 0.6;

  buildPodiumBlocks();
  buildTrucks();

  engine.runRenderLoop(() => scene.render());
  scene.onAfterRenderObservable.add(updateLabels);

  resizeObserver = new ResizeObserver(() => {
    engine?.resize();
    updateLabels();
  });
  resizeObserver.observe(canvasRef.value);
});

onUnmounted(() => {
  loadToken++;
  resizeObserver?.disconnect();
  resizeObserver = null;
  disposeModels();
  scene?.dispose();
  scene = null;
  engine?.dispose();
  engine = null;
  camera = null;
});

watch(() => props.entries, () => {
  if (scene) buildTrucks();
}, { deep: true });
</script>
