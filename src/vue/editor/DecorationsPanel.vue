<template>
  <EditorPanel
    v-if="editor.selectedType === 'decoration'"
    title="Decoration"
    @close="editor.featureAction('deselectDecoration')"
  >
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <div class="mb-1">
      <div class="text-[12px] mb-1">Type</div>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="typeKey"
        @change="editor.setDecorationType($event.target.value)"
      >
        <option value="flag">Flag</option>
        <option value="bannerString">Banner String</option>
        <option v-for="m in models" :key="m.id" :value="'model:' + m.id">{{ m.name }}</option>
      </select>
    </div>

    <template v-if="editor.decoration.type === 'flag'">
      <div class="text-[12px] mb-1">Color</div>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="editor.decoration.color"
        @change="editor.setDecorationColor($event.target.value)"
      >
        <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </template>

    <template v-else-if="editor.decoration.type === 'model'">
      <template v-if="editable.color">
        <div class="text-[12px] mb-1">Color</div>
        <select
          class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
          :value="editor.decoration.color"
          @change="editor.setDecorationColor($event.target.value)"
        >
          <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </template>

      <template v-if="editable.scale">
        <div class="flex justify-between mb-1 mt-3 text-[12px]">
          <span>Scale</span>
          <span>{{ editor.decoration.scale }}×</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="4"
          step="0.1"
          :value="editor.decoration.scale"
          @input="editor.setDecorationScale(+$event.target.value)"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        />
      </template>

      <template v-if="editable.heading">
        <div class="flex justify-between mb-1 mt-3 text-[12px]">
          <span>Rotation</span>
          <span>{{ editor.decoration.heading }}°</span>
        </div>
        <input
          type="range"
          min="0"
          max="360"
          step="1"
          :value="editor.decoration.heading"
          @input="editor.setDecorationHeading(+$event.target.value)"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        />
      </template>
    </template>

    <template v-else>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Width</span>
        <span>{{ editor.decoration.width }} m</span>
      </div>
      <input
        type="range"
        min="5"
        max="50"
        step="1"
        :value="editor.decoration.width"
        @input="editor.setDecorationWidth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Pole Height</span>
        <span>{{ editor.decoration.poleHeight }} m</span>
      </div>
      <input
        type="range"
        min="3"
        max="24"
        step="1"
        :value="editor.decoration.poleHeight"
        @input="editor.setDecorationPoleHeight(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Rotation</span>
        <span>{{ editor.decoration.heading }}°</span>
      </div>
      <input
        type="range"
        min="0"
        max="180"
        step="1"
        :value="editor.decoration.heading"
        @input="editor.setDecorationHeading(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

    </template>

    <hr class="border-t border-slate-700 my-4" />
    <!-- Actions -->
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteSelectedDecoration')">Delete</button>
      <button
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateSelectedDecoration')">Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

const COLORS = [
  { value: 'black',  label: 'Black' },
  { value: 'gray',   label: 'Gray' },
  { value: 'white',  label: 'White' },
  { value: 'brown',  label: 'Brown' },
  { value: 'red',    label: 'Red' },
  { value: 'orange', label: 'Orange' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'green',  label: 'Green' },
  { value: 'blue',   label: 'Blue' },
  { value: 'purple', label: 'Purple' },
];

// Model decorations discovered from /decorations/*.json (see DecorationLoader).
const models = computed(() => window.decorationLoader?.getDecorationList() ?? []);

// The Type dropdown value: 'flag' | 'bannerString' | 'model:<id>'.
const typeKey = computed(() =>
  editor.decoration.type === 'model'
    ? `model:${editor.decoration.model}`
    : editor.decoration.type
);

// Which controls the selected model exposes (all on by default).
const editable = computed(() => {
  if (editor.decoration.type !== 'model') return {};
  const def = window.decorationLoader?.getDecoration(editor.decoration.model);
  return def?.editable ?? { color: true, scale: true, heading: true };
});
</script>
