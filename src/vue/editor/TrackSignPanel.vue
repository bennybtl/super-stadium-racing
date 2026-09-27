<template>
  <EditorPanel
    v-if="editor.selectedType === 'trackSign'"
    title="Track Sign"
    @close="editor.featureAction('deselectTrackSign')"
  >
    <!-- Hint -->
    <div class="ed-hint">WASD to move · QE to rotate · Del to delete</div>

    <!-- Content type -->
    <div class="ed-row">
      <span>Type</span>
      <select
        :value="editor.trackSign.contentType"
        @change="editor.setFeatureProp('trackSign', 'contentType', $event.target.value)"
        class="ed-select-inline"
      >
        <option value="text">Custom Text</option>
        <option value="brand">Logo</option>
      </select>
    </div>

    <div class="ed-heading">Shape</div>

    <!-- Width -->
    <div class="ed-label">
      <span>Width</span>
      <span>{{ editor.trackSign.width.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="4" max="30" step="0.5"
      :value="editor.trackSign.width"
      @input="editor.setFeatureProp('trackSign', 'width', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Scale -->
    <div class="ed-label">
      <span>Scale</span>
      <span>{{ editor.trackSign.scale.toFixed(2) }}x</span>
    </div>
    <input
      type="range" min="0.8" max="4" step="0.05"
      :value="editor.trackSign.scale"
      @input="editor.setFeatureProp('trackSign', 'scale', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Rotation -->
    <div class="ed-label">
      <span>Rotation</span>
      <span>{{ editor.trackSign.rotation }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.trackSign.rotation"
      @input="editor.setFeatureProp('trackSign', 'rotation', +$event.target.value)"
      class="ed-slider"
    />

    <!-- Height -->
    <div class="ed-label">
      <span>Height</span>
      <span>{{ editor.trackSign.heightOffset.toFixed(1) }} m</span>
    </div>
    <input
      type="range" min="0" max="10" step="0.2"
      :value="editor.trackSign.heightOffset"
      @input="editor.setFeatureProp('trackSign', 'heightOffset', +$event.target.value)"
      class="ed-slider"
    />

    <hr class="ed-divider" />
    <div class="ed-heading">Appearance</div>

    <!-- Name -->
    <template v-if="editor.trackSign.contentType === 'text'">

      <div class="ed-label">
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
      <div class="ed-row">
        <span>Logo</span>
        <select
          class="ed-select-inline"
          :value="editor.trackSign.brandImage"
          @change="editor.setFeatureProp('trackSign', 'brandImage', $event.target.value)"
        >
          <option v-for="brand in TRACK_SIGN_BRANDS" :key="brand.value" :value="brand.value">{{ brand.label }}</option>
        </select>
      </div>

      <!-- Logo size -->
      <div class="ed-label">
        <span>Logo Size</span>
        <span>{{ editor.trackSign.logoScale.toFixed(2) }}x</span>
      </div>
      <input
        type="range" min="0.5" max="2" step="0.05"
        :value="editor.trackSign.logoScale"
        @input="editor.setFeatureProp('trackSign', 'logoScale', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <!-- Background -->
    <div class="ed-row">
      <span>Background</span>
      <select
        class="ed-select-inline"
        :value="editor.trackSign.background"
        @change="editor.setFeatureProp('trackSign', 'background', $event.target.value)"
      >
        <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
      </select>
    </div>

    <!-- Primary color (text + border) -->
    <div class="ed-row">
      <span>Primary Color</span>

      <select
        class="ed-select-inline"
        :value="editor.trackSign.primaryColor"
        @change="editor.setFeatureProp('trackSign', 'primaryColor', $event.target.value)"
      >
        <option v-for="c in COLORS" :key="c.value" :value="c.value">{{ c.label }}</option>
    </select>
    </div>

    <hr class="ed-divider" />

    <!-- Actions -->
    <div class="ed-btn-row">
      <button 
        class="ed-btn-danger"
        @click="editor.featureAction('deleteTrackSign')"
      >Delete</button>
      <button 
        class="ed-btn"
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
