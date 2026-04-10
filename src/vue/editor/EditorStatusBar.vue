<template>
  <Transition name="status-bar">
    <div v-if="editor.isEditorActive" class="editor-status-bar">

      <!-- Left: quick-test button -->
      <button class="status-btn status-btn--test" @click="editor.quickTestTrack()">
        🏁 Test Track
      </button>
      <div class="status-hint">
        pan/move - WASD | rotate - QE | delete - Del | undo - Ctrl+Z | zoom - +/- | move faster - Shift
      </div>

      <!-- Default terrain picker -->
      <div class="terrain-picker">
        <span class="terrain-label">Default Terrain</span>
        <select
          class="terrain-select"
          :value="editor.trackDefaultTerrain"
          @change="editor.setTrackDefaultTerrain($event.target.value)"
        >
          <option value="packed_dirt">Packed Dirt</option>
          <option value="loose_dirt">Loose Dirt</option>
          <option value="asphalt">Asphalt</option>
          <option value="mud">Mud</option>
          <option value="water">Water</option>
          <option value="rocky">Rocky</option>
          <option value="grass">Grass</option>
        </select>
      </div>

      <!-- Right: snap controls -->
      <div class="snap-controls">
        <button
          class="snap-toggle"
          :class="{ 'snap-toggle--on': editor.snapEnabled }"
          @click="editor.toggleSnap()"
          title="Toggle grid snap [G]"
        >
          {{ editor.snapEnabled ? `GRID: ${editor.snapSize}u` : 'GRID: OFF' }}
        </button>
        <button
          class="snap-cycle"
          @click="editor.cycleSnapSize()"
          title="Cycle snap size [Shift+G]"
        >⟳</button>
        <span class="snap-hint">{{ editor.snapEnabled ? '[G / Shift+G]' : '[G]' }}</span>
      </div>

    </div>
  </Transition>
</template>

<script setup>
import { useEditorStore } from '../store.js';
const editor = useEditorStore();
</script>

<style scoped>
.editor-status-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: rgba(0, 0, 0, 0.82);
  border-top: 1px solid #2a2a2a;
  z-index: 999;
  pointer-events: auto;
  user-select: none;
  box-sizing: border-box;
}

/* ── Test track ── */
.status-btn--test {
  background: #27ae60;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 5px 14px;
  font-size: 13px;
  font-family: Arial, sans-serif;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  transition: background 0.15s;
  white-space: nowrap;
}
.status-btn--test:hover { background: #2ecc71; }

/* ── Snap controls (pushed to right) ── */
.snap-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.snap-toggle {
  background: rgba(255, 255, 255, 0.07);
  color: #888;
  border: 1px solid #444;
  border-radius: 20px;
  padding: 3px 14px;
  font-size: 12px;
  font-family: Arial, sans-serif;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  white-space: nowrap;
}
.snap-toggle:hover { background: rgba(255, 255, 255, 0.12); }
.snap-toggle--on {
  color: #2ecc71;
  border-color: #2ecc71;
  background: rgba(46, 204, 113, 0.1);
}

.snap-cycle {
  background: rgba(255, 255, 255, 0.07);
  color: #888;
  border: 1px solid #444;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  transition: color 0.15s, border-color 0.15s;
  flex-shrink: 0;
}
.snap-cycle:hover { color: #fff; border-color: #aaa; }

.snap-hint {
  color: #444;
  font-size: 11px;
  font-family: Arial, sans-serif;
}

.status-hint {
  color: #999;
  font-size: 11px;
  font-family: Arial, sans-serif;
}

/* ── Default terrain picker ── */
.terrain-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}
.terrain-label {
  color: #888;
  font-size: 11px;
  font-family: Arial, sans-serif;
  white-space: nowrap;
}
.terrain-select {
  background: rgba(255, 255, 255, 0.07);
  color: #ccc;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
  font-family: Arial, sans-serif;
  cursor: pointer;
  appearance: auto;
}
.terrain-select:hover { border-color: #888; }

/* ── Slide-up transition ── */
.status-bar-enter-active,
.status-bar-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.status-bar-enter-from,
.status-bar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
