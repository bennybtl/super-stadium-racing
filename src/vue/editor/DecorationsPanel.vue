<template>
  <EditorPanel
    v-if="editor.selectedType === 'decoration'"
    title="Decoration"
    @close="editor.featureAction('deselectDecoration')"
  >
    <div class="ed-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Kind: packs collapse to one entry; standalone decorations list individually -->
    <div class="ed-label">Type</div>
    <select
      class="ed-select"
      :value="currentGroupKey"
      @change="selectGroup($event.target.value)"
    >
      <option v-for="g in groups" :key="g.key" :value="g.key">{{ g.name }}</option>
    </select>

    <!-- Variation: only for the selected pack -->
    <template v-if="currentGroup && currentGroup.members.length > 1">
      <div class="ed-label">Variation</div>
      <select
        class="ed-select"
        :value="editor.decoration.model"
        @change="editor.setDecorationType($event.target.value)"
      >
        <option v-for="m in currentGroup.members" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </template>

    <!-- Controls come from the decoration's controller (or its `editable` flags) -->
    <template v-for="(ctl, prop) in editor.decoration.controls" :key="prop">
      <!-- Colour / generic dropdown -->
      <template v-if="ctl.type === 'color' || ctl.type === 'select'">
        <div class="ed-label">{{ ctl.label ?? 'Color' }}</div>
        <select
          class="ed-select"
          :value="editor.decoration[prop]"
          @change="editor.setDecorationProp(prop, $event.target.value)"
        >
          <option v-for="c in (ctl.options ?? COLORS)" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </template>

      <!-- Numeric slider -->
      <template v-else-if="ctl.type === 'range'">
        <div class="ed-label">
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
          class="ed-slider"
        />
      </template>

      <!-- Checkbox -->
      <template v-else-if="ctl.type === 'toggle'">
        <label class="ed-row cursor-pointer">
          <span>{{ ctl.label ?? prop }}</span>
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="!!editor.decoration[prop]"
            @change="editor.setDecorationProp(prop, $event.target.checked)"
          />
        </label>
      </template>

      <!-- Mirror pair -->
      <template v-else-if="ctl.type === 'mirror'">
        <div class="ed-label">{{ ctl.label ?? 'Mirror' }}</div>
        <div class="ed-btn-row">
          <button
            :class="editor.decoration.mirrorX ? 'ed-btn' : 'ed-btn-invert'"
            @click="editor.setDecorationProp('mirrorX', !editor.decoration.mirrorX)"
          >Flip X</button>
          <button
            :class="editor.decoration.mirrorZ ? 'ed-btn' : 'ed-btn-invert'"
            @click="editor.setDecorationProp('mirrorZ', !editor.decoration.mirrorZ)"
          >Flip Z</button>
        </div>
      </template>
    </template>

    <hr class="ed-divider" />
    <!-- Actions -->
    <div class="ed-btn-row">
      <button
        class="ed-btn-danger"
        @click="editor.featureAction('deleteSelectedDecoration')"
      >Delete</button>
      <button
        class="ed-btn"
        @click="editor.featureAction('duplicateSelectedDecoration')"
      >Duplicate</button>
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

// Everything discovered in /src/decorations/ (see DecorationLoader), sorted by name.
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
