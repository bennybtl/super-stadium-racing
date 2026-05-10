<template>
  <div class="controls-settings">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Controls</h2>

    <div class="mode-tabs">
      <button
        class="menu-button px-8 py-3 text-xl"
        :class="activeMode === 'driving' ? 'tab-active' : 'menu-button-muted'"
        @click="activeMode = 'driving'"
      >
        Driving
      </button>
      <button
        class="menu-button px-8 py-3 text-xl"
        :class="activeMode === 'editor' ? 'tab-active' : 'menu-button-muted'"
        @click="activeMode = 'editor'"
      >
        Editor
      </button>
    </div>

    <div class="key-list">
      <div v-for="(binding, action) in visibleBindings" :key="action" class="key-row">
        <div class="action action-col">{{ action }}</div>
        <div class="button-col">
          <button class="key-btn" @click="remap(action)">{{ binding }}</button>
        </div>
      </div>
    </div>

    <hr class="my-3 opacity-60">

    <div class="footer-actions">
      <button class="menu-button px-8 py-3 text-xl" @click="resetToDefaults()">Reset to Defaults</button>
      <button class="menu-button menu-button-muted px-8 py-3 text-xl" @click="$emit('back')">Back</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const STORAGE_KEY = 'settings.controls';

const DEFAULT_BINDINGS = {
  driving: {
    'Gas': 'W',
    'Brake/Reverse': 'S',
    'Steer Left': 'A',
    'Steer Right': 'D',
    'Use Nitro': 'Q',
    'Reset Truck': 'R',
    'Cycle Camera': 'C',
  },
  editor: {
    'Move Forward': 'W',
    'Move Backward': 'S',
    'Move Left': 'D',
    'Move Right': 'A',
    'Zoom Out': '_',
    'Zoom In': '=',
    'Rotate Left': 'Q',
    'Rotate Right': 'E',
    'Fast Move(hold)': 'Shift',
    'Delete': 'Backspace',
    'Duplicate': 'Ctrl + D',
    'Undo': 'Ctrl + Z',
    'Redo': 'Ctrl + Shift + Z',
    'Add Feature': 'Space',
    'Toggle Snap': 'G',
    'Snap Size': 'Shift + G',
  },
};

function cloneDefaults() {
  return {
    driving: { ...DEFAULT_BINDINGS.driving },
    editor: { ...DEFAULT_BINDINGS.editor },
  };
}

function loadBindings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaults();
    const parsed = JSON.parse(raw);
    return {
      driving: { ...DEFAULT_BINDINGS.driving, ...(parsed?.driving || {}) },
      editor: { ...DEFAULT_BINDINGS.editor, ...(parsed?.editor || {}) },
    };
  } catch {
    return cloneDefaults();
  }
}

const activeMode = ref('driving');
const keyBindings = ref(loadBindings());

const visibleBindings = computed(() => {
  return activeMode.value === 'editor' ? keyBindings.value.editor : keyBindings.value.driving;
});

function persistBindings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keyBindings.value));
}

function remap(action) {
  const modeKey = activeMode.value;
  const current = keyBindings.value[modeKey][action];
  const entered = window.prompt(`Set key for ${action}`, current);
  if (!entered) return;

  const normalized = entered.trim();
  if (!normalized) return;

  keyBindings.value[modeKey][action] = normalized.toUpperCase();
  persistBindings();
}

function resetToDefaults() {
  keyBindings.value = cloneDefaults();
  persistBindings();
}
</script>

<style scoped>
.controls-settings { text-align: center; }
.mode-tabs {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.key-list { margin: 2rem 0; }
.key-row {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.2rem;
}
.action-col {
  width: 50%;
  padding-right: 1rem;
  text-align: right;
  font-weight: 700;
  color: #fff;
  text-transform: uppercase;
  font-style: italic;
  letter-spacing: 0.08em;
}
.button-col {
  width: 50%;
  text-align: left;
  display: flex;
  align-items: center;
}
.tab-active {
  color: #ffffff;
}
.key-btn { font-size: 1.1rem; padding: 0.5rem 1.5rem; border-radius: 6px; border: none; background: #222; color: #fff; cursor: pointer; }
.footer-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-top: 1rem;
}
</style>
