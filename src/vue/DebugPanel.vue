<template>
  <div v-if="debug.visible" class="debug-panel">
    <div class="row"><span class="label">Compression:</span><span class="value">{{ debug.data.compression }}</span></div>
    <div class="row"><span class="label">Groundedness:</span><span class="value">{{ debug.data.groundedness }}</span></div>
    <div class="row"><span class="label">Penetration:</span><span class="value">{{ debug.data.penetration }}</span></div>
    <div class="row"><span class="label">Vert Velocity:</span><span class="value">{{ debug.data.vvel }}</span></div>
    <div class="row"><span class="label">Horiz Speed:</span><span class="value">{{ debug.data.speed }}</span></div>
    <div class="row"><span class="label">Effective Grip:</span><span class="value">{{ debug.data.grip }}</span></div>
    <div class="row"><span class="label">Slip Angle:</span><span class="value">{{ debug.data.slip }}</span></div>
    <div class="row"><span class="label">Terrain:</span><span class="value">{{ debug.data.terrain }}</span></div>
    <div class="row"><span class="label">Slope (fwd):</span><span class="value">{{ debug.data.slope }}</span></div>
    <div>X: {{ debug.data.x }}</div>
    <div>Y: {{ debug.data.y }}</div>
    <div>Z: {{ debug.data.z }}</div>
    <div class="row"><span class="label">Normal:</span><span class="value">{{ debug.data.nx }}, {{ debug.data.ny }}, {{ debug.data.nz }}</span></div>
    <div class="log-bar">
      <button v-if="!debug.recording" @click="debug.startRecording()">⏺ Record</button>
      <button v-else                  @click="debug.stopRecording()" class="recording">⏹ Stop</button>
      <button @click="debug.dumpLog()">⬇ Dump</button>
      <span class="frames" v-if="debug.frameCount > 0">{{ debug.frameCount }} frames</span>
    </div>
  </div>
</template>

<script setup>
import { useDebugStore } from './store.js';
const debug = useDebugStore();
</script>

<style scoped>
.debug-panel {
  position: fixed;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: #0f0;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  padding: 10px;
  border: 1px solid #0f0;
  min-width: 250px;
  pointer-events: none;
}

.row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 2px;
}

.label { color: #888; }
.value { color: #0f0; text-align: right; }

.log-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  pointer-events: auto;
}

.log-bar button {
  background: #111;
  color: #0f0;
  border: 1px solid #0f0;
  font-family: inherit;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}

.log-bar button.recording {
  color: #f44;
  border-color: #f44;
  animation: blink 1s step-start infinite;
}

.frames { color: #888; font-size: 11px; }

@keyframes blink { 50% { opacity: 0.3; } }
</style>
