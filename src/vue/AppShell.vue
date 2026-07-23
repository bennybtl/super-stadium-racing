<template>
  <!-- All UI layers live here as a pointer-events-none overlay.
       Individual panels opt back in with pointer-events-auto. -->
  <div class="fixed inset-0 pointer-events-none z-[900] font-sans">
    <div class="absolute top-2.5 right-3.5 text-[13px] font-mono drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] select-none">
      <span class="text-white">{{ fps }}</span>
      <span :class="minFpsClass"> (min {{ minFps }})</span>
    </div>
    <LoadingOverlay />
    <MenuOverlay />
    <SingleRaceOverlay />
    <RaceHUD />
    <DebugPanel />
    <VehicleDebugOverlay />
    <!-- Editor property panels (each self-gates on selectedType) -->
    <CheckpointPanel />
    <HillPanel />
    <SquareHillPanel />
    <TerrainShapePanel />
    <ObstaclePanel />
    <PolyWallPanel />
    <PolyHillPanel />
    <DecorationsPanel />
    <TrackSignPanel />
    <TrackSettingsPanel />
    <ActionZonePanel />
    <PolyCurbPanel />
    <MeshGridPanel />
    <BridgeMeshPanel />
    <AiPathPanel />
    <TerrainPathPanel />
    <SurfaceDecalPanel />
    <AddEntityMenu />
    <EditorStatusBar />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import MenuOverlay        from './MenuOverlay.vue';
import LoadingOverlay     from './LoadingOverlay.vue';
import SingleRaceOverlay  from './SingleRaceOverlay.vue';
import RaceHUD            from './RaceHUD.vue';
import DebugPanel         from './DebugPanel.vue';
import VehicleDebugOverlay from './VehicleDebugOverlay.vue';
import CheckpointPanel    from './editor/CheckpointPanel.vue';
import HillPanel          from './editor/HillPanel.vue';
import SquareHillPanel    from './editor/SquareHillPanel.vue';
import TerrainShapePanel  from './editor/TerrainShapePanel.vue';
import ObstaclePanel      from './editor/ObstaclePanel.vue';
import PolyWallPanel      from './editor/PolyWallPanel.vue';
import PolyHillPanel      from './editor/PolyHillPanel.vue';
import DecorationsPanel   from './editor/DecorationsPanel.vue';
import TrackSignPanel     from './editor/TrackSignPanel.vue';
import TrackSettingsPanel from './editor/TrackSettingsPanel.vue';
import ActionZonePanel    from './editor/ActionZonePanel.vue';
import PolyCurbPanel      from './editor/PolyCurbPanel.vue';
import MeshGridPanel      from './editor/MeshGridPanel.vue';
import BridgeMeshPanel    from './editor/BridgeMeshPanel.vue';
import AiPathPanel        from './editor/AiPathPanel.vue';
import TerrainPathPanel   from './editor/TerrainPathPanel.vue';
import SurfaceDecalPanel  from './editor/SurfaceDecalPanel.vue';
import AddEntityMenu      from './editor/AddEntityMenu.vue';
import EditorStatusBar    from './editor/EditorStatusBar.vue';

// Average fps over each 500ms window, plus the "min fps" derived from the
// longest single frame in that window. The average is vsync-capped and smoothed,
// so it reads a steady 60 even through hitches; min fps exposes those hitches —
// one 33ms frame shows as min ~30 while the average still says 60.
const fps = ref(0);
const minFps = ref(0);
let _lastTime = performance.now();
let _lastFrameTime = _lastTime;
let _frames = 0;
let _maxFrameMs = 0;
let _rafId = null;

const _tick = () => {
  const now = performance.now();
  const frameMs = now - _lastFrameTime;
  _lastFrameTime = now;
  _frames++;
  if (frameMs > _maxFrameMs) _maxFrameMs = frameMs;

  if (now - _lastTime >= 500) {
    fps.value = Math.round(_frames * 1000 / (now - _lastTime));
    minFps.value = _maxFrameMs > 0 ? Math.round(1000 / _maxFrameMs) : fps.value;
    _frames = 0;
    _maxFrameMs = 0;
    _lastTime = now;
  }
  _rafId = requestAnimationFrame(_tick);
};

// Amber when the worst frame dips below ~50fps (>20ms), red below ~30fps (>33ms).
const minFpsClass = computed(() => {
  if (minFps.value > 0 && minFps.value < 30) return 'text-red-400';
  if (minFps.value > 0 && minFps.value < 50) return 'text-amber-400';
  return 'text-slate-400';
});

onMounted(() => {
  _lastTime = _lastFrameTime = performance.now();
  _rafId = requestAnimationFrame(_tick);
});
onUnmounted(() => { cancelAnimationFrame(_rafId); });
</script>
