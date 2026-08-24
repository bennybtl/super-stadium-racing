<template>
  <EditorPanel
    v-if="editor.selectedType === 'startPosition'"
    title="Start Position"
    @close="editor.featureAction('deselectStartPosition')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <div class="text-[10px] text-slate-400 mb-3 max-w-48">
      Overrides the default grid behind the finish line. Click a pad to pick a slot — keep the
      whole grid behind the finish line so the first lap still counts.
    </div>

    <!-- Layout mode -->
    <div class="flex justify-between items-center mb-1 text-[12px]">
      <span>Layout</span>
      <select
        :value="sp.mode"
        @change="editor.setFeatureProp('startPosition', 'mode', $event.target.value)"
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option value="grid">Grid</option>
        <option value="custom">Custom</option>
      </select>
    </div>
    <div class="text-[10px] text-slate-400 mb-3">
      {{ sp.mode === 'custom'
        ? 'Drag each pad on its own; the marker moves and turns the whole set.'
        : 'Rows are generated from the settings below.' }}
    </div>

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ sp.rotation.toFixed(0) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="5"
      :value="sp.rotation"
      @input="editor.setFeatureProp('startPosition', 'rotation', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Grid shape -->
    <template v-if="sp.mode === 'grid'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Trucks per row</span>
        <span>{{ sp.columns }}</span>
      </div>
      <input
        type="range" min="1" max="10" step="1"
        :value="sp.columns"
        @input="editor.setFeatureProp('startPosition', 'columns', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
      />
      <div class="text-[10px] text-slate-400 mb-3">10 makes a single-row land rush start.</div>

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Row spread</span>
        <span>{{ sp.colSpacing.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="2.5" max="20" step="0.5"
        :value="sp.colSpacing"
        @input="editor.setFeatureProp('startPosition', 'colSpacing', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Row gap</span>
        <span>{{ sp.rowSpacing.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="4" max="25" step="0.5"
        :value="sp.rowSpacing"
        @input="editor.setFeatureProp('startPosition', 'rowSpacing', +$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <!-- Custom layout -->
    <template v-else>
      <button
        class="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 mb-3 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('resetStartPositionLayout')"
      >
        Reset to grid layout
      </button>
    </template>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Selected slot -->
    <div class="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300 mb-2">Slot</div>
    <div v-if="sp.selectedSlot < 0" class="text-[10px] text-slate-400 mb-1">
      Click a pad to pick the slot to edit.
    </div>
    <template v-else>
      <div class="flex justify-between mb-2 text-[12px]">
        <span>Starts</span>
        <span class="text-slate-300 font-bold">
          {{ isPole ? 'Pole' : ordinal(sp.slotOrder) }}
        </span>
      </div>

      <button
        class="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 mb-3 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800"
        :disabled="isPole"
        @click="editor.featureAction('setStartPositionPole')"
      >
        {{ isPole ? 'Is pole position' : 'Set as pole position' }}
      </button>

      <template v-if="sp.mode === 'custom'">
        <div class="flex justify-between mb-1 text-[12px]">
          <span>Slot rotation</span>
          <span>{{ sp.slotRotation.toFixed(0) }}°</span>
        </div>
        <input
          type="range" min="-180" max="180" step="5"
          :value="sp.slotRotation"
          @input="editor.setFeatureProp('startPosition', 'slotRotation', +$event.target.value)"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        />
      </template>
    </template>

    <hr class="border-t border-slate-700 my-4" />

    <button
      class="w-full rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
      @click="editor.featureAction('deleteStartPosition')"
    >
      Delete
    </button>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
const sp = computed(() => editor.startPosition);
const isPole = computed(() => sp.value.selectedSlot === sp.value.poleIndex);

const ordinal = (n) => {
  const rest = n % 100;
  const suffix = rest >= 11 && rest <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
};
</script>
