<template>
  <EditorPanel
    v-if="editor.selectedType === 'bannerString'"
    title="Banner String"
    accent-color="#e8aa22"
    @close="editor.closeBannerString()"
  >
    <!-- Width -->
    <div class="ep-row">
      <span>Width</span>
      <span>{{ editor.bannerString.width }} m</span>
    </div>
    <input
      type="range"
      min="5"
      max="50"
      step="1"
      :value="editor.bannerString.width"
      @input="editor.setBannerStringWidth(+$event.target.value)"
    />

    <!-- Pole Height -->
    <div class="ep-row">
      <span>Pole Height</span>
      <span>{{ editor.bannerString.poleHeight }} m</span>
    </div>
    <input
      type="range"
      min="3"
      max="24"
      step="1"
      :value="editor.bannerString.poleHeight"
      @input="editor.setBannerStringPoleHeight(+$event.target.value)"
    />

    <!-- Heading -->
    <div class="ep-row">
      <span>Heading</span>
      <span>{{ editor.bannerString.heading }}°</span>
    </div>

    <div class="ep-hint">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="ep-btn-dup" @click="editor.duplicateBannerString()">Duplicate</button>
    <button class="ep-btn-del" @click="editor.deleteBannerString()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
