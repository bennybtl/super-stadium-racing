<template>
  <EditorPanel
    v-if="editor.selectedType === 'decoration'"
    title="Decoration"
    @close="editor.featureAction('deselectDecoration')"
  >
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Kind: packs collapse to one entry; standalone decorations list individually -->
    <div class="text-[12px] mb-1">Type</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="currentGroupKey"
      @change="selectGroup($event.target.value)"
    >
      <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.name }}</option>
    </select>

    <!-- Variation: only for the selected pack -->
    <template v-if="currentGroup && currentGroup.members.length > 1">
      <div class="text-[12px] mb-1">Variation</div>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="editor.decoration.model"
        @change="editor.setDecorationType($event.target.value)"
      >
        <option v-for="m in currentGroup.members" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </template>

    <!-- Controls come from the decoration's controller (or its `editable` flags) -->
    <template v-for="(ctl, prop) in editor.decoration.controls" :key="prop">
      <!-- Colour -->
      <template v-if="ctl.type === 'color'">
        <div class="text-[12px] mb-1 mt-3">{{ ctl.label ?? 'Color' }}</div>
        <select
          class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
          :value="editor.decoration[prop]"
          @change="editor.setDecorationProp(prop, $event.target.value)"
        >
          <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </template>

      <!-- Numeric slider -->
      <template v-else-if="ctl.type === 'range'">
        <div class="flex justify-between mb-1 mt-1 text-[12px]">
          <span>{{ ctl.label ?? prop }}</span>
          <span>{{ editor.decoration[prop] }}{{ ctl.unit ?? '' }}</span>
        </div>
        <input
          type="range"
          :min="ctl.min"
          :max="ctl.max"
          :step="ctl.step ?? 1"
          :value="editor.decoration[prop]"
          @input="editor.setDecorationProp(prop, +$event.target.value)"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        />
      </template>

      <!-- Checkbox -->
      <template v-else-if="ctl.type === 'toggle'">
        <label class="flex items-center justify-between text-[12px] text-slate-200 mb-1 mt-3">
          <span>{{ ctl.label ?? prop }}</span>
          <input
            type="checkbox"
            :checked="!!editor.decoration[prop]"
            @change="editor.setDecorationProp(prop, $event.target.checked)"
          />
        </label>
      </template>

      <!-- Mirror pair -->
      <template v-else-if="ctl.type === 'mirror'">
        <div class="text-[12px] mb-1 mt-3">{{ ctl.label ?? 'Mirror' }}</div>
        <div class="flex gap-2 mb-3">
          <button
            class="flex-1 rounded border px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition duration-150"
            :class="editor.decoration.mirrorX ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'"
            @click="editor.setDecorationProp('mirrorX', !editor.decoration.mirrorX)"
          >Flip X</button>
          <button
            class="flex-1 rounded border px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition duration-150"
            :class="editor.decoration.mirrorZ ? 'border-sky-500 bg-sky-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'"
            @click="editor.setDecorationProp('mirrorZ', !editor.decoration.mirrorZ)"
          >Flip Z</button>
        </div>
      </template>
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

// Everything discovered in /decorations/ (see DecorationLoader), sorted by name.
const decorations = computed(() =>
  [...(window.decorationLoader?.getDecorationList() ?? [])].sort((a, b) => a.name.localeCompare(b.name))
);

// Collapse decorations sharing a packId into one Type entry. The group key is
// the packId (or the decoration's own id when it isn't in a pack).
const groups = computed(() => {
  const byKey = new Map();
  for (const d of decorations.value) {
    const key = d.packId ?? d.id;
    let g = byKey.get(key);
    if (!g) {
      g = { key, name: d.packId ? (d.packName ?? d.packId) : d.name, members: [] };
      byKey.set(key, g);
    }
    g.members.push({ id: d.id, name: d.name });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
});

// The group the currently-selected decoration belongs to.
const currentGroupKey = computed(() => {
  const model = editor.decoration.model;
  return decorations.value.find(d => d.id === model)?.packId ?? model;
});
const currentGroup = computed(() =>
  groups.value.find(g => g.key === currentGroupKey.value) ?? null
);

// Switching Type: keep the current variation if it's already in the chosen
// pack, otherwise jump to the pack's first member.
function selectGroup(key) {
  const group = groups.value.find(g => g.key === key);
  if (!group) return;
  if (group.members.some(m => m.id === editor.decoration.model)) return;
  editor.setDecorationType(group.members[0].id);
}
</script>
