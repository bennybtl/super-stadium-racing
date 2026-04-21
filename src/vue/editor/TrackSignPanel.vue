<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackSign'"
    title="Track Sign"
    @close="editor.closeTrackSign()"
  >
    <!-- Content type -->
    <div class="text-[12px] mb-1">Content</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.trackSign.contentType"
      @change="editor.setTrackSignContentType($event.target.value)"
    >
      <option value="text">Custom Text</option>
      <option value="brand">Brand Logo</option>
    </select>

    <!-- Name -->
    <div v-if="editor.trackSign.contentType === 'text'" class="flex justify-between mb-1 text-[12px]">
      <span>Sign Text</span>
    </div>
    <input
      v-if="editor.trackSign.contentType === 'text'"
      class="sign-name-input"
      type="text"
      :value="editor.trackSign.name"
      @input="editor.setTrackSignName($event.target.value)"
      placeholder="Track Name"
    />

    <!-- Brand image -->
    <div v-if="editor.trackSign.contentType === 'brand'" class="text-[12px] mb-1">Brand Logo</div>
    <select
      v-if="editor.trackSign.contentType === 'brand'"
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.trackSign.brandImage"
      @change="editor.setTrackSignBrandImage($event.target.value)"
    >
      <option v-for="brand in TRACK_SIGN_BRANDS" :key="brand.value" :value="brand.value">{{ brand.label }}</option>
    </select>

    <!-- Background -->
    <div class="text-[12px] mb-1">Background</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.trackSign.background"
      @change="editor.setTrackSignBackground($event.target.value)"
    >
      <option value="black">Black</option>
      <option value="gray">Gray</option>
      <option value="white">White</option>
      <option value="red">Red</option>
      <option value="blue">Blue</option>
      <option value="yellow">Yellow</option>
    </select>

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.trackSign.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.trackSign.width"
      @input="editor.setTrackSignWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Scale -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Scale</span>
      <span>{{ editor.trackSign.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.4" max="2.5" step="0.05"
      :value="editor.trackSign.scale"
      @input="editor.setTrackSignScale(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height Offset</span>
      <span>{{ editor.trackSign.heightOffset.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.1"
      :value="editor.trackSign.heightOffset"
      @input="editor.setTrackSignHeightOffset(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Rotation -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Rotation</span>
      <span>{{ editor.trackSign.rotation }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.trackSign.rotation"
      @input="editor.setTrackSignRotation(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateTrackSign()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteTrackSign()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import { TRACK_SIGN_BRANDS } from '../../constants.js';

const editor = useEditorStore();
</script>

<style scoped>
.sign-name-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  background: #1a1a2e;
  border: 1px solid #cc0000;
  border-radius: 4px;
  color: #ff4444;
  font-size: 14px;
  font-family: Arial, sans-serif;
  font-weight: bold;
  font-style: italic;
  margin-bottom: 6px;
  outline: none;
  transition: border-color 0.15s;
}
.sign-name-input:focus {
  border-color: #ff2222;
  box-shadow: 0 0 6px rgba(204, 0, 0, 0.5);
}
</style>
