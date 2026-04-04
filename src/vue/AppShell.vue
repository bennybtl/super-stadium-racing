<template>
  <!-- All UI layers live here as a pointer-events:none overlay.
       Individual panels opt back in with pointer-events:auto. -->
  <div class="ui-root">
    <MenuOverlay />
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
  </div>
</template>

<script setup>
import MenuOverlay    from './MenuOverlay.vue';
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
import FlagPanel        from './editor/FlagPanel.vue';
</script>

<style scoped>
.ui-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 900;
  font-family: Arial, sans-serif;
}
</style>
