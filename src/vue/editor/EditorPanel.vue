<template>
  <div
    v-if="visible"
    class="editor-panel"
    :style="panelStyle"
    @mousedown.stop
  >
    <!-- Header acts as drag handle -->
    <div
      class="editor-panel-header"
      :style="{ color: props.accentColor }"
      @mousedown="startDrag"
    >
      <span class="editor-panel-title">{{ title }}</span>
      <button class="editor-panel-close" @click.stop="$emit('close')">✕</button>
    </div>

    <!-- Slot content -->
    <div class="editor-panel-body">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue';

const props = defineProps({
  title:        { type: String,  required: true },
  accentColor:  { type: String,  default: '#4a9eff' },
  visible:      { type: Boolean, default: true },
  defaultRight: { type: String,  default: '20px' },
  defaultTop:   { type: String,  default: '80px' },
});

defineEmits(['close']);

// ── Draggable state ──────────────────────────────────────────────────────────
const dragged   = ref(false);
const pos       = ref({ x: 0, y: 0 });
let   dragStart = null;

function startDrag(e) {
  const panel = e.currentTarget.closest('.editor-panel');
  const rect  = panel.getBoundingClientRect();
  dragStart   = { mouseX: e.clientX, mouseY: e.clientY, panelX: rect.left, panelY: rect.top };
  if (!dragged.value) {
    pos.value     = { x: rect.left, y: rect.top };
    dragged.value = true;
  }
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup',   stopDrag);
}

function onDrag(e) {
  if (!dragStart) return;
  pos.value = {
    x: dragStart.panelX + (e.clientX - dragStart.mouseX),
    y: dragStart.panelY + (e.clientY - dragStart.mouseY),
  };
}

function stopDrag() {
  dragStart = null;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup',   stopDrag);
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup',   stopDrag);
});

const panelStyle = computed(() => ({
  // CSS variable cascades to all slot content (for accent-color on sliders, selects, etc.)
  '--accent': props.accentColor,
  border: `2px solid ${props.accentColor}`,
  ...(dragged.value
    ? { left: pos.value.x + 'px', top: pos.value.y + 'px', right: 'auto' }
    : { right: props.defaultRight, top: props.defaultTop }),
}));
</script>

<style scoped>
.editor-panel {
  position: fixed;
  background: rgba(0, 0, 0, 0.88);
  border-radius: 10px;
  z-index: 1000;
  min-width: 240px;
  font-family: Arial, sans-serif;
  color: white;
  user-select: none;
  pointer-events: auto;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
}

.editor-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  cursor: grab;
}

.editor-panel-header:active { cursor: grabbing; }

.editor-panel-title {
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.editor-panel-close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.45);
  font-size: 14px;
  cursor: pointer;
  padding: 0 0 0 8px;
  line-height: 1;
  transition: color 0.15s;
}
.editor-panel-close:hover { color: #fff; }

.editor-panel-body {
  padding: 14px 16px 14px;
}

/* ── Shared slot-content styles (deep so child components can use these classes) ── */
:deep(.ep-row) {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
  font-size: 12px;
}

:deep(.ep-slider) {
  width: 100%;
  accent-color: var(--accent);
  margin-bottom: 14px;
  cursor: pointer;
  display: block;
}

:deep(.ep-hint) {
  font-size: 10px;
  color: #888;
  margin-bottom: 14px;
}

:deep(.ep-label) {
  font-size: 12px;
  margin-bottom: 6px;
}

:deep(.ep-select) {
  width: 100%;
  padding: 6px 8px;
  background: #2a2a2a;
  color: white;
  border: 1px solid var(--accent);
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 16px;
  cursor: pointer;
}

:deep(.ep-btn-row) {
  display: flex;
  gap: 6px;
  margin-bottom: 14px;
}

:deep(.ep-mode-btn) {
  flex: 1;
  padding: 5px 0;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  font-family: Arial;
  transition: background 0.15s;
}

:deep(.ep-btn-dup) {
  display: block;
  width: 100%;
  padding: 8px;
  background: #2980b9;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial;
  margin-bottom: 8px;
}
:deep(.ep-btn-dup:hover) { background: #3498db; }

:deep(.ep-btn-action) {
  display: block;
  width: 100%;
  padding: 8px;
  background: #2980b9;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial;
  margin-bottom: 8px;
}
:deep(.ep-btn-action:hover) { background: #3498db; }

:deep(.ep-btn-del) {
  display: block;
  width: 100%;
  padding: 8px;
  background: #c0392b;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial;
}
:deep(.ep-btn-del:hover) { background: #e74c3c; }

:deep(.ep-checkbox) {
  width: 18px;
  height: 18px;
  accent-color: var(--accent);
  cursor: pointer;
}

:deep(.ep-separator) {
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  margin: 4px 0 16px;
}

:deep(.ep-section-title) {
  font-size: 10px;
  font-weight: bold;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 10px;
}

:deep(.ep-accent) {
  color: var(--accent);
}
</style>
