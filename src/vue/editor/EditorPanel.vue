<template>
  <div
    v-if="visible"
    class="editor-panel fixed flex flex-col bg-slate-950/95 rounded-2xl z-50 min-w-[240px] text-white pointer-events-auto shadow-[0_4px_20px_rgba(0,0,0,0.6)]"
    :style="panelStyle"
    @mousedown.stop
  >
    <!-- Header acts as drag handle. shrink-0 so it survives a squeezed panel. -->
    <div
      class="flex shrink-0 items-center justify-between px-4 py-3 border-b border-slate-700 cursor-grab active:cursor-grabbing text-slate-200"
      @mousedown="startDrag"
    >
      <span class="text-[11px] font-bold uppercase tracking-[0.2em]">{{ title }}</span>
      <button class="bg-transparent border-none text-slate-400 text-sm cursor-pointer leading-none px-1 transition hover:text-slate-100" @click.stop="$emit('close')">✕</button>
    </div>

    <!-- Slot content: the part that scrolls once the panel hits the viewport.
         min-h-0 is what lets a flex child shrink below its content height. -->
    <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

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

// ── Viewport bounds ──────────────────────────────────────────────────────────
// A panel is capped to what is left of the window below (and right of) its own
// position, so it can never run off screen no matter how much a panel's contents
// grow; the body scrolls instead. Tracked reactively because both the window
// size and the panel's top edge move.
const PANEL_MARGIN = 16;
const MIN_PANEL_HEIGHT = 160;
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });

function onResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  if (dragged.value) pos.value = clampToViewport(pos.value.x, pos.value.y);
}

// ── Position persistence (per panel, for this browser session) ───────────────
const STORAGE_KEY = `editorPanelPos:${props.title}`;

// Keep the top-left on screen so a panel can't strand off-viewport (e.g. after
// a window resize). Leave a margin so the drag handle stays reachable.
function clampToViewport(x, y) {
  const maxX = Math.max(0, window.innerWidth  - 60);
  const maxY = Math.max(0, window.innerHeight - 40);
  return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}

function savePosition() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value)); } catch {}
}

onMounted(() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
      pos.value     = clampToViewport(saved.x, saved.y);
      dragged.value = true; // switch to left/top positioning at the saved spot
    }
  } catch {}
  window.addEventListener('resize', onResize);
});

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
  // Clamped live, not just on restore: a panel dragged past the left or top edge
  // would otherwise hide its own header and become unreachable.
  pos.value = clampToViewport(
    dragStart.panelX + (e.clientX - dragStart.mouseX),
    dragStart.panelY + (e.clientY - dragStart.mouseY)
  );
}

function stopDrag() {
  dragStart = null;
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup',   stopDrag);
  savePosition();
}

onUnmounted(() => {
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup',   stopDrag);
  window.removeEventListener('resize',    onResize);
});

const PANEL_ACCENT = '#9ca3af';

// Distance from the top of the window to the panel's top edge, whether that came
// from a drag or from the default offset.
const topOffset = computed(() => {
  if (dragged.value) return pos.value.y;
  const parsed = parseFloat(props.defaultTop);
  return Number.isFinite(parsed) ? parsed : 0;
});

const panelStyle = computed(() => ({
  // CSS variable cascades to slot content for a uniform silver accent.
  '--accent': PANEL_ACCENT,
  border: `2px solid ${PANEL_ACCENT}`,
  maxHeight: `${Math.max(MIN_PANEL_HEIGHT, viewport.value.height - topOffset.value - PANEL_MARGIN)}px`,
  maxWidth: `${Math.max(240, viewport.value.width - PANEL_MARGIN * 2)}px`,
  ...(dragged.value
    ? { left: pos.value.x + 'px', top: pos.value.y + 'px', right: 'auto' }
    : { right: props.defaultRight, top: props.defaultTop }),
}));
</script>

