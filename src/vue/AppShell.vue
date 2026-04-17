<template>
  <!-- All UI layers live here as a pointer-events:none overlay.
       Individual panels opt back in with pointer-events:auto. -->
  <div class="ui-root">
    <div class="fps-counter">{{ fps }}</div>
    <MenuOverlay />
    <SingleRaceOverlay />
    <PostRaceOverlay />
    <PitOverlay />
    <SeasonFinalOverlay />
    <RaceHUD />
    <DebugPanel />
    <!-- Editor property panels (each self-gates on selectedType) -->
    <CheckpointPanel />
    <HillPanel />
    <SquareHillPanel />
    <TerrainShapePanel />
    <NormalMapDecalPanel />
    <PolyWallPanel />
    <PolyHillPanel />
    <BezierWallPanel />
    <FlagPanel />
    <TrackSignPanel />
    <BannerStringPanel />
    <ActionZonePanel />
    <PolyCurbPanel />
    <MeshGridPanel />
    <BridgePanel />
    <AddEntityMenu />
    <EditorStatusBar />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import MenuOverlay        from './MenuOverlay.vue';
import SingleRaceOverlay  from './SingleRaceOverlay.vue';
import PostRaceOverlay    from './PostRaceOverlay.vue';
import PitOverlay       from './PitOverlay.vue';
import SeasonFinalOverlay from './SeasonFinalOverlay.vue';
import RaceHUD        from './RaceHUD.vue';
import DebugPanel     from './DebugPanel.vue';
import CheckpointPanel  from './editor/CheckpointPanel.vue';
import HillPanel        from './editor/HillPanel.vue';
import SquareHillPanel  from './editor/SquareHillPanel.vue';
import TerrainShapePanel  from './editor/TerrainShapePanel.vue';
import NormalMapDecalPanel from './editor/NormalMapDecalPanel.vue';
import PolyWallPanel    from './editor/PolyWallPanel.vue';
import PolyHillPanel    from './editor/PolyHillPanel.vue';
import BezierWallPanel  from './editor/BezierWallPanel.vue';
import FlagPanel          from './editor/FlagPanel.vue';
import TrackSignPanel     from './editor/TrackSignPanel.vue';
import BannerStringPanel  from './editor/BannerStringPanel.vue';
import ActionZonePanel    from './editor/ActionZonePanel.vue';
import PolyCurbPanel      from './editor/PolyCurbPanel.vue';
import MeshGridPanel      from './editor/MeshGridPanel.vue';
import BridgePanel        from './editor/BridgePanel.vue';
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

<style scoped>
.ui-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 900;
  font-family: Arial, sans-serif;
}

.fps-counter {
  position: absolute;
  top: 10px;
  right: 14px;
  color: white;
  font-size: 13px;
  font-family: monospace;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  user-select: none;
}
</style>
