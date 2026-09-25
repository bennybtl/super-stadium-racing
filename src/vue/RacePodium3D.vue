<template>
  <div ref="hostRef" class="relative h-full w-full">
    <canvas ref="canvasRef" class="h-full w-full" />

    <!-- HTML overlay labels, on each podium block's front face (shown as its truck lands) -->
    <div
      v-for="label in labels"
      :key="label.position"
      class="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-center select-none transition-opacity duration-300"
      :class="label.shown ? 'opacity-100' : 'opacity-0'"
      :style="{ left: `${label.x}px`, top: `${label.y}px` }"
    >
      <div class="text-3xl font-extrabold italic leading-none text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
        {{ ordinal(label.position) }}
      </div>
      <div class="mt-1 text-sm font-bold uppercase italic tracking-[0.12em] text-[#ffe066] drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
        {{ label.name }}
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * RacePodium3D — the post-race podium stage (single race + championship).
 *
 * A small self-contained Babylon scene: medal blocks on an asphalt floor that
 * fades into black, an arc of sponsor banners behind (TrackSign, random brand
 * logos, SSR logo centre-top), a spotlight on the winner, and two pairs of
 * mortar cans (FireworkLaunchers) driven by a FireworksManager.
 *
 * Reveal: the camera sweeps in, then 3rd → 2nd → 1st drop onto their blocks,
 * each landing firing the cans' flames; the winner lands to a full flame
 * volley plus shells, then sways. After that a random flame or shell burst
 * goes off every few seconds. All timings / placements are constants below.
 */
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
  ShadowGenerator,
  SpotLight,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { loadVehicleModel } from './loadVehicleModel.js';
import { TrackSign } from '../objects/TrackSign.js';
import { FireworkLaunchers } from '../objects/FireworkLaunchers.js';
import { FireworksManager } from '../managers/FireworksManager.js';
import asphaltUrl from '../assets/textures/asphalt_1.texture.png?url';

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
let shadowGen = null;
let fireworks = null;
let cannonPoints = { left: [], right: [], all: [] };
let podiumRoot = null;
let stageParts = [];
let models = [];
let holders = {}; // position → { holder, slot, landed }
let resizeObserver = null;
let loadToken = 0;
let elapsed = 0;
let nextIdleBurst = Infinity;

// Blocks are laid out 2 – 1 – 3: winner centre and tallest.
const BLOCK = { w: 3, d: 3.2 };
const SLOTS = {
  1: { x: 0.0, h: 1.75, medal: [0.85, 0.64, 0.13] },
  2: { x: -4.05, h: 1.15, medal: [0.75, 0.78, 0.82] },
  3: { x: 4.05, h: 0.7, medal: [0.68, 0.42, 0.2] },
};
const TRUCK_SCALE = 0.78;

// ── Stage ────────────────────────────────────────────────────────────────────
const BG = [0.02, 0.02, 0.03];
const FOG_DENSITY = 0.035;
const FLOOR_SIZE = 90;
const FLOOR_TILE_M = 8;
// Sponsor banner arc behind the podium (camera looks toward +Z). Banners are
// spaced edge to edge along the arc (chord = banner width + gap), so changing
// width / scale / radius never makes neighbours intersect.
const BANNER_ARC_RADIUS = 14;
const BANNER_COUNT = 7;
const BANNER_WIDTH = 4.6;
const BANNER_GAP = 0.3;           // metres between neighbouring banners
const BANNER_SCALE = 1.25;
const BANNER_RAISE = 1.0;         // TrackSign heightOffset
const CENTER_BANNER = { brand: 'ssr-logo.png', width: 9, scale: 1.4, raise: 3.6, back: 1.2 };
const BANNER_BACKGROUNDS = ['black', 'white', 'red', 'blue', 'yellow'];
// Mortar cans: two pairs straddling the podium (radius = half the spacing).
const CANNON_PAIRS = [{ radius: 6.6, z: -0.6 }, { radius: 9.2, z: 1.8 }];

// ── Camera ───────────────────────────────────────────────────────────────────
// Target sits low so the podium rides in the upper part of the screen — the
// standings table overlays the bottom.
const CAMERA_TARGET = new Vector3(0, -0.4, 2.5);
const CAMERA_FINAL = { alpha: -Math.PI / 2, beta: 1.2, radius: 15.5 };
const CAMERA_START = { alpha: -Math.PI / 2 - 0.55, beta: 1.05, radius: 24 };
const CAMERA_INTRO_S = 2.2;
const CAMERA_FOV = 0.8;

// ── Reveal / fireworks ───────────────────────────────────────────────────────
const REVEAL_AT = { 3: 1.0, 2: 1.8, 1: 2.8 }; // seconds after mount
const DROP_HEIGHT = 6;
const DROP_S = 0.45;
const FLAME = { fireworkMode: 'flame', fireworkDuration: 0.9, fireworkHeight: 5 };
const WINNER_FLAME = { ...FLAME, fireworkDuration: 1.6, fireworkHeight: 7 };
const WINNER_SHELLS = { count: 5, height: 11 };
const IDLE_BURST_S = [5, 8];      // random gap between idle bursts
const WINNER_SWAY = { amp: 0.22, rate: 0.7 };

// Every brand logo except the SSR badges (the centre banner carries the SSR logo).
const BRAND_FILES = Object.keys(import.meta.glob('../assets/brands/*.png'))
  .map((p) => p.split('/').pop())
  .filter((f) => !f.startsWith('ssr-'));

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

function shuffled(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const lerp = (a, b, t) => a + (b - a) * t;

// ── Build ────────────────────────────────────────────────────────────────────

function buildStage() {
  // Asphalt floor, faded into the black background by fog.
  const floor = MeshBuilder.CreateGround('podiumFloor', { width: FLOOR_SIZE, height: FLOOR_SIZE }, scene);
  const floorMat = new StandardMaterial('podiumFloorMat', scene);
  const tex = new Texture(asphaltUrl, scene);
  tex.uScale = tex.vScale = FLOOR_SIZE / FLOOR_TILE_M;
  floorMat.diffuseTexture = tex;
  floorMat.diffuseColor = new Color3(0.45, 0.45, 0.48);
  floorMat.specularColor = new Color3(0.05, 0.05, 0.05);
  floor.material = floorMat;
  floor.receiveShadows = true;
  stageParts.push(floor, floorMat, tex);

  // Sponsor banners on an arc, each facing the podium centre.
  const brands = shuffled(BRAND_FILES);
  const bgs = shuffled(BANNER_BACKGROUNDS);
  const halfSpan = (BANNER_WIDTH * BANNER_SCALE + BANNER_GAP) / 2;
  const step = 2 * Math.asin(Math.min(1, halfSpan / BANNER_ARC_RADIUS));
  for (let i = 0; i < BANNER_COUNT; i++) {
    const a = (i - (BANNER_COUNT - 1) / 2) * step;
    stageParts.push(new TrackSign({
      x: Math.sin(a) * BANNER_ARC_RADIUS,
      z: Math.cos(a) * BANNER_ARC_RADIUS,
      rotation: a,
      contentType: 'brand',
      brandImage: brands[i % brands.length],
      background: bgs[i % bgs.length],
      primaryColor: 'yellow',
      width: BANNER_WIDTH,
      scale: BANNER_SCALE,
      heightOffset: BANNER_RAISE,
    }, 0, scene));
  }
  stageParts.push(new TrackSign({
    x: 0,
    z: BANNER_ARC_RADIUS + CENTER_BANNER.back,
    rotation: 0,
    contentType: 'brand',
    brandImage: CENTER_BANNER.brand,
    background: 'black',
    primaryColor: 'yellow',
    width: CENTER_BANNER.width,
    scale: CENTER_BANNER.scale,
    heightOffset: CENTER_BANNER.raise,
  }, 0, scene));

  // Mortar cans — a flat stand-in "track" seats them on the floor.
  const flat = { getHeightAt: () => 0 };
  cannonPoints = { left: [], right: [], all: [] };
  for (const pair of CANNON_PAIRS) {
    const launchers = new FireworkLaunchers({ x: 0, z: pair.z, radius: pair.radius, heading: 0 }, flat, scene);
    stageParts.push(launchers);
    for (const p of launchers.launchPoints) {
      (p.x < 0 ? cannonPoints.left : cannonPoints.right).push(p);
      cannonPoints.all.push(p);
    }
  }
  fireworks = new FireworksManager(scene, flat);
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
    block.receiveShadows = true;
    shadowGen?.addShadowCaster(block);
  }
}

async function buildTrucks() {
  const myToken = ++loadToken;
  disposeModels();
  holders = {};

  const loader = window.vehicleLoader;

  for (const entry of props.entries.slice(0, 3)) {
    const slot = SLOTS[entry.position];
    if (!slot) continue;

    const holder = new TransformNode(`truckHolder_${entry.position}`, scene);
    holder.parent = podiumRoot;
    holder.position.set(slot.x, slot.h + DROP_HEIGHT, 0);
    holder.setEnabled(false); // shown when its reveal starts
    // Face the camera, with a small random yaw jitter so the row isn't uniform.
    holder.rotation.y = Math.PI + (Math.random() * 2 - 1) * (10 * Math.PI / 180);
    holder.scaling.setAll(TRUCK_SCALE);
    holders[entry.position] = { holder, slot, baseYaw: holder.rotation.y, landed: false };
    models.push({ dispose: () => holder.dispose(false, true) });
  }

  for (const entry of props.entries.slice(0, 3)) {
    const h = holders[entry.position];
    if (!h) continue;
    const vehicleDef = entry.vehicleKey ? loader?.getVehicle(entry.vehicleKey) : null;
    if (!vehicleDef?.modelUrl) {
      placeholderTruck(h.holder, entry.color);
      continue;
    }
    try {
      const loaded = await loadVehicleModel(scene, vehicleDef, {
        colorValue: entry.color,
        isStale: () => myToken !== loadToken,
      });
      if (myToken !== loadToken) { loaded?.dispose(); return; }
      if (loaded) {
        loaded.root.parent = h.holder;
        seatOnBlock(loaded);
        for (const m of [...loaded.bodyMeshes, ...loaded.wheelMeshes]) shadowGen?.addShadowCaster(m);
      } else {
        placeholderTruck(h.holder, entry.color);
      }
    } catch (err) {
      console.warn('[RacePodium3D] vehicle model failed, using placeholder:', err);
      if (myToken === loadToken) placeholderTruck(h.holder, entry.color);
    }
  }
}

// The vehicle OBJs aren't authored with their origin at the tyre contact patch,
// so drop the model until its lowest point rests on the holder's origin (the
// block top once the holder has landed). Measured relative to the holder, so it
// works while the holder is still up in the air.
function seatOnBlock(loaded) {
  const holder = loaded.root.parent;
  const meshes = [...loaded.bodyMeshes, ...loaded.wheelMeshes]
    .filter((m) => m.getTotalVertices && m.getTotalVertices() > 0);
  holder.computeWorldMatrix(true);
  let minY = Infinity;
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    minY = Math.min(minY, mesh.getBoundingInfo().boundingBox.minimumWorld.y);
  }
  if (Number.isFinite(minY)) {
    const holderY = holder.getAbsolutePosition().y;
    loaded.root.position.y += (holderY - minY) / TRUCK_SCALE;
  }
}

function placeholderTruck(holder, color) {
  const box = MeshBuilder.CreateBox('podiumTruckFallback', { width: 2.4, depth: 4, height: 1.4 }, scene);
  box.parent = holder;
  box.position.y = 0.7;
  box.material = makeMaterial('podiumTruckFallbackMat', color ?? [0.8, 0.2, 0.1], 0.15);
  shadowGen?.addShadowCaster(box);
}

function disposeModels() {
  for (const m of models) m.dispose();
  models = [];
}

// ── Show ─────────────────────────────────────────────────────────────────────

function restartShow() {
  elapsed = 0;
  nextIdleBurst = Infinity;
  camera.alpha = CAMERA_START.alpha;
  camera.beta = CAMERA_START.beta;
  camera.radius = CAMERA_START.radius;
}

function fireFlames(points, zone = FLAME) {
  if (points.length) fireworks.trigger(zone, points);
}

function tick() {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  elapsed += dt;

  // Camera sweep in.
  const c = easeOutCubic(Math.min(1, elapsed / CAMERA_INTRO_S));
  camera.alpha = lerp(CAMERA_START.alpha, CAMERA_FINAL.alpha, c);
  camera.beta = lerp(CAMERA_START.beta, CAMERA_FINAL.beta, c);
  camera.radius = lerp(CAMERA_START.radius, CAMERA_FINAL.radius, c);

  // Trucks drop onto their blocks in order; each landing sets off the cans.
  for (const [pos, h] of Object.entries(holders)) {
    const t = (elapsed - REVEAL_AT[pos]) / DROP_S;
    if (t < 0) continue;
    h.holder.setEnabled(true);
    const k = Math.min(1, t);
    // Fall (ease-in), then a small settle bounce.
    const fall = (1 - k * k) * DROP_HEIGHT;
    const bounce = k >= 1 ? Math.max(0, Math.sin(Math.min(1, (t - 1) * 2.5) * Math.PI)) * 0.25 : 0;
    h.holder.position.y = h.slot.h + fall + bounce;
    if (k >= 1 && !h.landed) {
      h.landed = true;
      if (pos === '1') {
        fireFlames(cannonPoints.all, WINNER_FLAME);
        fireworks.launch(0, 0, WINNER_SHELLS);
        nextIdleBurst = elapsed + IDLE_BURST_S[0];
      } else {
        fireFlames(pos === '2' ? cannonPoints.left : cannonPoints.right);
      }
    }
    if (pos === '1' && h.landed) {
      h.holder.rotation.y = h.baseYaw + Math.sin((elapsed - REVEAL_AT[1]) * WINNER_SWAY.rate) * WINNER_SWAY.amp;
    }
  }

  // Idle: an occasional flame or shell burst while the screen stays up.
  if (elapsed >= nextIdleBurst) {
    if (Math.random() < 0.6) fireFlames(cannonPoints.all);
    else fireworks.launch(0, 0, { count: 3, height: 9 });
    nextIdleBurst = elapsed + lerp(IDLE_BURST_S[0], IDLE_BURST_S[1], Math.random());
  }

  fireworks.update([], [], dt);
}

// Label anchors: each block's front face, projected to canvas pixels. Only
// published when something changed (camera sweep, reveal, resize).
let _labelSig = '';
function updateLabels() {
  if (!scene || !camera || !engine) return;
  const w = engine.getRenderWidth();
  const h = engine.getRenderHeight();
  const next = [];
  for (const entry of props.entries.slice(0, 3)) {
    const slot = SLOTS[entry.position];
    if (!slot) continue;
    const anchor = new Vector3(slot.x, slot.h / 2, -BLOCK.d / 2);
    const p = Vector3.Project(
      anchor,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(w, h),
    );
    next.push({
      position: entry.position,
      name: entry.name,
      x: Math.round(p.x),
      y: Math.round(p.y),
      shown: !!holders[entry.position]?.landed,
    });
  }
  const sig = JSON.stringify(next);
  if (sig === _labelSig) return;
  _labelSig = sig;
  labels.value = next;
}

onMounted(() => {
  if (!canvasRef.value) return;

  engine = new Engine(canvasRef.value, true, { antialias: true, stencil: false });
  scene = new Scene(engine);
  scene.clearColor = new Color4(BG[0], BG[1], BG[2], 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = FOG_DENSITY;
  scene.fogColor = new Color3(...BG);

  camera = new ArcRotateCamera('podiumCamera', CAMERA_START.alpha, CAMERA_START.beta, CAMERA_START.radius, CAMERA_TARGET.clone(), scene);
  camera.fov = CAMERA_FOV;

  const hemi = new HemisphericLight('podiumHemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.45;
  hemi.groundColor = new Color3(0.1, 0.1, 0.14);
  // Key from the front-left, throwing shadows back toward the banners.
  const key = new DirectionalLight('podiumKey', new Vector3(0.35, -1, 0.55), scene);
  key.position = new Vector3(-6, 14, -10);
  key.intensity = 0.75;
  // Warm spot on the winner's block.
  const spot = new SpotLight('podiumSpot', new Vector3(0, 11, -4), new Vector3(0, -11, 4).normalize(), 0.55, 2, scene);
  spot.diffuse = new Color3(1, 0.9, 0.7);
  spot.intensity = 1.1;

  shadowGen = new ShadowGenerator(1024, key);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.bias = 0.002;

  buildStage();
  buildPodiumBlocks();
  buildTrucks();
  restartShow();

  scene.onBeforeRenderObservable.add(tick);
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
  fireworks?.dispose();
  fireworks = null;
  for (const part of stageParts) part.dispose?.();
  stageParts = [];
  scene?.dispose();
  scene = null;
  engine?.dispose();
  engine = null;
  camera = null;
  shadowGen = null;
});

watch(() => props.entries, () => {
  if (!scene) return;
  buildTrucks();
  restartShow();
}, { deep: true });
</script>
