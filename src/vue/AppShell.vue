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
    <TerrainRectPanel />
    <PolyWallPanel />
  </div>
</template>

<script setup>
import MenuOverlay    from './MenuOverlay.vue';
import RaceHUD        from './RaceHUD.vue';
import DebugPanel     from './DebugPanel.vue';
import CheckpointPanel  from './editor/CheckpointPanel.vue';
import HillPanel        from './editor/HillPanel.vue';
import SquareHillPanel  from './editor/SquareHillPanel.vue';
import TerrainRectPanel from './editor/TerrainRectPanel.vue';
import PolyWallPanel    from './editor/PolyWallPanel.vue';
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
