<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackSign'"
    title="Track Sign"
    @close="editor.featureAction('deselectTrackSign')"
  >
    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · QE to rotate · Del to delete</div>

    <!-- Content type -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Type</span>
      <select
        :value="editor.trackSign.contentType"
        @change="editor.setFeatureProp('trackSign', 'contentType', $event.target.value)"
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
      >
        <option value="text">Custom Text</option>
        <option value="brand">Logo</option>
      </select>
    </div>

    <!-- Name -->
    <template v-if="editor.trackSign.contentType === 'text'">

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Sign Text</span>
      </div>
      <input
        class="sign-name-input"
        type="text"
        :value="editor.trackSign.name"
        @input="editor.setFeatureProp('trackSign', 'name', $event.target.value)"
        placeholder="Track Name"
      />
    </template>

    <!-- Logo -->
     <template v-if="editor.trackSign.contentType === 'brand'">
      <div class="flex justify-between items-center mb-3 text-[12px]">
        <span>Logo</span>
        <select
          class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
          :value="editor.trackSign.brandImage"
          @change="editor.setFeatureProp('trackSign', 'brandImage', $event.target.value)"
        >
          <option v-for="brand in TRACK_SIGN_BRANDS" :key="brand.value" :value="brand.value">{{ brand.label }}</option>
        </select>
      </div>
    </template>

    <!-- Background -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Background</span>
      <select
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
        :value="editor.trackSign.background"
        @change="editor.setFeatureProp('trackSign', 'background', $event.target.value)"
      >
        <option value="black">Black</option>
        <option value="gray">Gray</option>
        <option value="white">White</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
        <option value="yellow">Yellow</option>
      </select>
    </div>

    <!-- Primary color (text + border) -->
    <div class="flex justify-between items-center mb-3 text-[12px]">
      <span>Primary Color</span>

      <select
        class="bg-slate-700 text-white text-[12px] rounded px-2 py-0.5 cursor-pointer"
        :value="editor.trackSign.primaryColor"
        @change="editor.setFeatureProp('trackSign', 'primaryColor', $event.target.value)"
      >
        <option value="black">Black</option>
        <option value="gray">Gray</option>
        <option value="white">White</option>
        <option value="red">Red</option>
        <option value="blue">Blue</option>
        <option value="yellow">Yellow</option>
      </select>
    </div>

    <hr class="border-t border-slate-700 my-4" />

    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.trackSign.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.trackSign.width"
      @input="editor.setFeatureProp('trackSign', 'width', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.trackSign.heightOffset.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.1"
      :value="editor.trackSign.heightOffset"
      @input="editor.setFeatureProp('trackSign', 'heightOffset', +$event.target.value)"
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
      @input="editor.setFeatureProp('trackSign', 'rotation', +$event.target.value)"
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
      @input="editor.setFeatureProp('trackSign', 'scale', +$event.target.value)"
      class="w-full accent-[var(--accent)] mb-1 cursor-pointer"
    />

    <hr class="border-t border-slate-700 my-4" />

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
        @click="editor.featureAction('deleteTrackSign')"
      >Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateTrackSign')"
      >Duplicate</button>
    </div>
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
