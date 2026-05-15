<template>
  <!-- All UI layers live here as a pointer-events-none overlay.
       Individual panels opt back in with pointer-events-auto. -->
  <div class="fixed inset-0 pointer-events-none z-[900] font-sans">
    <div class="absolute top-2.5 right-3.5 text-white text-[13px] font-mono drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)] select-none">
      {{ fps }}
    </div>
    <LoadingOverlay />
    <MenuOverlay />
    <SingleRaceOverlay />
    <PostRaceOverlay />
    <!-- <PitOverlay /> -->
    <SeasonFinalOverlay />
    <RaceHUD />
    <DebugPanel />
    <!-- Editor property panels (each self-gates on selectedType) -->
    <CheckpointPanel />
    <HillPanel />
    <SquareHillPanel />
    <TerrainShapePanel />
    <NormalMapDecalPanel />
    <ObstaclePanel />
    <PolyWallPanel />
    <PolyHillPanel />
    <BezierWallPanel />
    <DecorationsPanel />
    <TrackSignPanel />
    <ActionZonePanel />
    <PolyCurbPanel />
    <MeshGridPanel />
    <BridgePanel />
    <AiPathPanel />
    <TerrainPathPanel />
    <SurfaceDecalPanel />
    <AddEntityMenu />
    <EditorStatusBar />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import MenuOverlay        from './MenuOverlay.vue';
import LoadingOverlay     from './LoadingOverlay.vue';
import SingleRaceOverlay  from './SingleRaceOverlay.vue';
import PostRaceOverlay    from './PostRaceOverlay.vue';
// import PitOverlay         from './PitOverlay.vue';
import SeasonFinalOverlay from './SeasonFinalOverlay.vue';
import RaceHUD            from './RaceHUD.vue';
import DebugPanel         from './DebugPanel.vue';
import CheckpointPanel    from './editor/CheckpointPanel.vue';
import HillPanel          from './editor/HillPanel.vue';
import SquareHillPanel    from './editor/SquareHillPanel.vue';
import TerrainShapePanel  from './editor/TerrainShapePanel.vue';
import NormalMapDecalPanel from './editor/NormalMapDecalPanel.vue';
import ObstaclePanel      from './editor/ObstaclePanel.vue';
import PolyWallPanel      from './editor/PolyWallPanel.vue';
import PolyHillPanel      from './editor/PolyHillPanel.vue';
import BezierWallPanel    from './editor/BezierWallPanel.vue';
import DecorationsPanel   from './editor/DecorationsPanel.vue';
import TrackSignPanel     from './editor/TrackSignPanel.vue';
import ActionZonePanel    from './editor/ActionZonePanel.vue';
import PolyCurbPanel      from './editor/PolyCurbPanel.vue';
import MeshGridPanel      from './editor/MeshGridPanel.vue';
import BridgePanel        from './editor/BridgePanel.vue';
import AiPathPanel        from './editor/AiPathPanel.vue';
import TerrainPathPanel   from './editor/TerrainPathPanel.vue';
import SurfaceDecalPanel  from './editor/SurfaceDecalPanel.vue';
import AddEntityMenu      from './editor/AddEntityMenu.vue';
import EditorStatusBar    from './editor/EditorStatusBar.vue';

const fps = ref(0);
let _lastTime = performance.now();
let _frames = 0;
let _rafId = null;

const _tick = () => {
  _frames++;
  const now = performance.now();
  if (now - _lastTime >= 500) {
    fps.value = Math.round(_frames * 1000 / (now - _lastTime));
    _frames = 0;
    _lastTime = now;
  }
  _rafId = requestAnimationFrame(_tick);
};

onMounted(() => { _rafId = requestAnimationFrame(_tick); });
onUnmounted(() => { cancelAnimationFrame(_rafId); });
</script>
