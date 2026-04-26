<template>
  <EditorPanel
    v-if="editor.selectedType === 'decoration'"
    title="Decoration"
    @close="editor.closeDecoration()"
  >
    <div class="mb-4">
      <label class="block text-[12px] uppercase tracking-[0.14em] text-slate-300 mb-2">Type</label>
      <select
        class="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
        :value="editor.decoration.type"
        @change="editor.setDecorationType($event.target.value)"
      >
        <option value="flag">Flag</option>
        <option value="bannerString">Banner String</option>
      </select>
    </div>

    <template v-if="editor.decoration.type === 'flag'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Color</span>
        <span>{{ editor.decoration.color }}</span>
      </div>
      <div class="flex gap-2 mb-3">
        <button
          class="color-btn red"
          :class="{ active: editor.decoration.color === 'red' }"
          @click="editor.setDecorationColor('red')"
        >
          Red
        </button>
        <button
          class="color-btn blue"
          :class="{ active: editor.decoration.color === 'blue' }"
          @click="editor.setDecorationColor('blue')"
        >
          Blue
        </button>
      </div>
      <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete</div>
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
      />

      <div class="flex justify-between mb-1 mt-3 text-[12px]">
        <span>Heading</span>
        <span>{{ editor.decoration.heading }}°</span>
      </div>
      <input
        type="range"
        min="-180"
        max="180"
        step="1"
        :value="editor.decoration.heading"
        @input="editor.setDecorationHeading(+$event.target.value)"
      />

      <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>
    </template>

    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateDecoration()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteDecoration()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>

<style scoped>
.color-btn {
  flex: 1;
  padding: 8px;
  border: 2px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-family: Arial, Helvetica, sans-serif;
  font-weight: bold;
  color: white;
  transition: all 0.15s;
}

.color-btn.red {
  background: #e74c3c;
}

.color-btn.red:hover {
  background: #c0392b;
}

.color-btn.red.active {
  border-color: #fff;
  box-shadow: 0 0 10px rgba(231, 76, 60, 0.8);
}

.color-btn.blue {
  background: #3498db;
}

.color-btn.blue:hover {
  background: #2980b9;
}

.color-btn.blue.active {
  border-color: #fff;
  box-shadow: 0 0 10px rgba(52, 152, 219, 0.8);
}
</style>
