<template>
  <div
    v-if="visible"
    class="editor-panel fixed bg-slate-950/95 rounded-2xl z-50 min-w-[240px] text-white pointer-events-auto shadow-[0_4px_20px_rgba(0,0,0,0.6)]"
    :style="panelStyle"
    @mousedown.stop
  >
    <!-- Header acts as drag handle -->
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-slate-700 cursor-grab active:cursor-grabbing text-slate-200"
      @mousedown="startDrag"
    >
      <span class="text-[11px] font-bold uppercase tracking-[0.2em]">{{ title }}</span>
      <button class="bg-transparent border-none text-slate-400 text-sm cursor-pointer leading-none px-1 transition hover:text-slate-100" @click.stop="$emit('close')">✕</button>
    </div>

    <!-- Slot content -->
    <div class="px-4 py-4">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue';

const props = defineProps({
  title:        { type: String,  required: true },
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
  const panel = e.currentTarget.closest('.editor-panel') || e.currentTarget.parentElement;
  if (!panel) return;
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

const PANEL_ACCENT = '#9ca3af';
const panelStyle = computed(() => ({
  // CSS variable cascades to slot content for a uniform silver accent.
  '--accent': PANEL_ACCENT,
  border: `2px solid ${PANEL_ACCENT}`,
  ...(dragged.value
    ? { left: pos.value.x + 'px', top: pos.value.y + 'px', right: 'auto' }
    : { right: props.defaultRight, top: props.defaultTop }),
}));
</script>

