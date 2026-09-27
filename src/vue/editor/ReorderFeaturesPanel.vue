<template>
  <EditorPanel
    v-if="editor.reorderFeaturesOpen && editor.isEditorActive"
    title="Reorder Features"
    default-right="280px"
    @close="editor.closeReorderFeatures()"
  >
    <div class="w-72">
      <p class="mb-3 text-[11px] leading-snug text-slate-400">
        Drag to reorder. Where terrain, paths, or hills overlap (amber bar),
        whichever is lower in this list paints on top.
      </p>
      <div class="flex flex-col gap-1.5">
        <template v-for="(row, idx) in editor.featureOrderRows" :key="row.key">
          <div
            v-if="dragOverIndex === idx"
            class="h-8 rounded-lg border-2 border-dashed border-sky-400/70 bg-sky-400/10"
            @dragover.prevent="onPlaceholderDragOver($event, idx)"
            @drop.prevent="commitDrop"
          ></div>
          <div
            :ref="el => setRowEl(row.key, el)"
            draggable="true"
            class="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs text-slate-200 cursor-grab active:cursor-grabbing"
            :class="[
              row.layered ? 'border-amber-500/70 border-l-4' : 'border-slate-700',
              isActiveRow(row) ? 'bg-sky-500/20 ring-1 ring-sky-400' : '',
              idx === dragIndex ? 'opacity-30' : '',
            ]"
            @dragstart="onDragStart($event, idx)"
            @dragend="onDragEnd"
            @dragover="onRowDragOver($event, idx)"
            @drop.prevent="commitDrop"
          >
            <i class="bi bi-grip-vertical text-slate-500"></i>
            <span class="min-w-0 flex-1 truncate">
              <span class="font-semibold">{{ row.isGroup ? `${row.count} × ${row.label}` : row.label }}</span>
              <span v-if="row.sub" class="ml-1 text-slate-400">{{ row.sub }}</span>
            </span>
            <button
              v-if="row.isGroup"
              class="bg-transparent border-none text-slate-500 text-[11px] cursor-pointer px-1 hover:text-slate-300"
              @click="toggleExpanded(row.key)"
            >{{ expanded.has(row.key) ? '▲' : '▼' }}</button>
            <span class="w-4 text-right text-[10px] text-slate-600">{{ idx + 1 }}</span>
          </div>
          <div
            v-if="row.isGroup && expanded.has(row.key)"
            class="ml-6 flex flex-col gap-0.5 border-l border-dashed border-slate-700 pl-2"
          >
            <span
              v-for="(ref, i) in row.featureRefs"
              :key="i"
              class="text-[10px] text-slate-500"
            >{{ ref.model ?? ref.type }}</span>
          </div>
        </template>
        <div
          v-if="dragOverIndex === editor.featureOrderRows.length"
          class="h-8 rounded-lg border-2 border-dashed border-sky-400/70 bg-sky-400/10"
          @dragover.prevent="onPlaceholderDragOver($event, editor.featureOrderRows.length)"
          @drop.prevent="commitDrop"
        ></div>
      </div>
    </div>
  </EditorPanel>
</template>

<script setup>
import { reactive, ref, watch, nextTick } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

// View-only expand state for collapsed decoration groups (which rows show
// their individual members) — purely local, doesn't affect drag order.
const expanded = reactive(new Set());
function toggleExpanded(key) {
  if (expanded.has(key)) expanded.delete(key);
  else expanded.add(key);
}

// Highlights whichever row's feature(s) match the gizmo currently selected in
// the 3D view (kept live by EditorController._syncReorderSelection).
function isActiveRow(row) {
  const active = editor.selectedFeatureRef;
  return !!active && row.featureRefs.includes(active);
}

// Auto-scroll the highlighted row into view — on a live selection change
// while the panel is open, and whenever the panel opens (the rows themselves
// only exist in the DOM while <EditorPanel> is showing, so this component's
// own setup() runs once for the whole editor session — reopening does NOT
// recreate the watch below, and the selection often hasn't changed since the
// panel was last closed, so opening needs its own trigger too).
const rowEls = new Map();
function setRowEl(key, el) {
  if (el) rowEls.set(key, el);
  else rowEls.delete(key);
}
function scrollToActiveRow() {
  const feature = editor.selectedFeatureRef;
  if (!feature) return;
  const row = editor.featureOrderRows.find(r => r.featureRefs.includes(feature));
  const el = row && rowEls.get(row.key);
  el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}
watch(() => editor.selectedFeatureRef, () => {
  if (!editor.reorderFeaturesOpen) return;
  scrollToActiveRow();
});
watch(() => editor.reorderFeaturesOpen, (isOpen) => {
  if (!isOpen) return;
  nextTick(scrollToActiveRow);
});

// `dragIndex` is the row being dragged; `dragOverIndex` is where it would land
// if dropped right now (a placeholder gap renders there instead of relying on
// the browser's own drag cursor for feedback).
const dragIndex = ref(null);
const dragOverIndex = ref(null);

function onDragStart(e, idx) {
  dragIndex.value = idx;
  e.dataTransfer.effectAllowed = 'move';
}

function onDragEnd() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function onRowDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (dragIndex.value === null) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const isAfter = (e.clientY - rect.top) > rect.height / 2;
  dragOverIndex.value = isAfter ? idx + 1 : idx;
}

// The placeholder gap itself is also a valid drop target — it renders at
// exactly the insertion index it represents, so hovering/dropping on it
// (rather than a real row) just confirms that same index, no midpoint math
// needed. Without this, releasing the mouse over the gap dropped it on an
// element with no dragover/drop handler at all, so nothing happened.
function onPlaceholderDragOver(e, idx) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (dragIndex.value === null) return;
  dragOverIndex.value = idx;
}

function commitDrop() {
  const from = dragIndex.value;
  let to = dragOverIndex.value;
  onDragEnd();
  if (from === null || to === null) return;
  if (to > from) to -= 1; // removing `from` first shifts everything after it left by one
  if (to === from) return;
  const rows = editor.featureOrderRows.slice();
  const [moved] = rows.splice(from, 1);
  rows.splice(to, 0, moved);
  editor.previewReorderFeatures(rows);
}
</script>
