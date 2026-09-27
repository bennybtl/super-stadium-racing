<template>
  <div
    v-if="visible"
    ref="panelEl"
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';

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
const panelEl   = ref(null);
let   dragStart = null;

// ── Viewport bounds ──────────────────────────────────────────────────────────
// A panel is capped to what is left of the window below (and right of) its own
// position, so it can never run off screen no matter how much a panel's contents
// grow; the body scrolls instead. Tracked reactively because both the window
// size and the panel's top edge move.
const PANEL_MARGIN = 16;
const MIN_PANEL_HEIGHT = 160;
// Every EditorPanel only ever renders while the editor is active, i.e. while
// EditorStatusBar's bottom bar (h-11 = 44px) is also on screen — reserve that
// so a dragged/tall panel can't slide its bottom edge under it.
const STATUS_BAR_HEIGHT = 44;
const viewport = ref({ width: window.innerWidth, height: window.innerHeight });

function onResize() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  if (dragged.value) pos.value = clampToViewport(pos.value.x, pos.value.y, ...panelSize());
}

// ── Position persistence (per panel, for this browser session) ───────────────
const STORAGE_KEY = `editorPanelPos:${props.title}`;

/** Current rendered size, or [0, 0] before the panel has ever been laid out. */
function panelSize() {
  const rect = panelEl.value?.getBoundingClientRect();
  return rect ? [rect.width, rect.height] : [0, 0];
}

// Keep the WHOLE panel on screen — not just its top-left drag handle — on
// every side, including above the status bar at the bottom.
function clampToViewport(x, y, width = 0, height = 0) {
  const maxX = Math.max(0, window.innerWidth  - width  - PANEL_MARGIN);
  const maxY = Math.max(0, window.innerHeight - height - PANEL_MARGIN - STATUS_BAR_HEIGHT);
  return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}

function savePosition() {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pos.value)); } catch {}
}

onMounted(() => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (typeof saved?.x === 'number' && typeof saved?.y === 'number') {
      pos.value     = clampToViewport(saved.x, saved.y, ...panelSize());
      dragged.value = true; // switch to left/top positioning at the saved spot
    }
  } catch {}
  window.addEventListener('resize', onResize);
});

// A panel restored from storage (or one whose content changed size) is only
// measurable once it's actually visible in the DOM — re-clamp then, using its
// real rendered size instead of the [0, 0] fallback above.
watch(() => props.visible, (v) => {
  if (!v || !dragged.value) return;
  nextTick(() => { pos.value = clampToViewport(pos.value.x, pos.value.y, ...panelSize()); });
});

function startDrag(e) {
  const panel = e.currentTarget.closest('.editor-panel') || e.currentTarget.parentElement;
  if (!panel) return;
  const rect  = panel.getBoundingClientRect();
  dragStart   = { mouseX: e.clientX, mouseY: e.clientY, panelX: rect.left, panelY: rect.top, width: rect.width, height: rect.height };
  if (!dragged.value) {
    pos.value     = { x: rect.left, y: rect.top };
    dragged.value = true;
  }
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup',   stopDrag);
}

function onDrag(e) {
  if (!dragStart) return;
  // Clamped live, not just on restore: a panel dragged past any edge would
  // otherwise become partly (or, at the right/bottom, entirely) unreachable.
  pos.value = clampToViewport(
    dragStart.panelX + (e.clientX - dragStart.mouseX),
    dragStart.panelY + (e.clientY - dragStart.mouseY),
    dragStart.width,
    dragStart.height,
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
  maxHeight: `${Math.max(MIN_PANEL_HEIGHT, viewport.value.height - topOffset.value - PANEL_MARGIN - STATUS_BAR_HEIGHT)}px`,
  maxWidth: `${Math.max(240, viewport.value.width - PANEL_MARGIN * 2)}px`,
  ...(dragged.value
    ? { left: pos.value.x + 'px', top: pos.value.y + 'px', right: 'auto' }
    : { right: props.defaultRight, top: props.defaultTop }),
}));
</script>

