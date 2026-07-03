<template>
  <EditorPanel
    v-if="editor.selectedType === 'bannerString'"
    title="Banner String"
    @close="editor.featureAction('deselectBannerString')"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.bannerString.width }} m</span>
    </div>
    <input
      type="range"
      min="5"
      max="50"
      step="1"
      :value="editor.bannerString.width"
      @input="editor.setFeatureProp('bannerString', 'width', +$event.target.value)"
    />

    <!-- Pole Height -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Pole Height</span>
      <span>{{ editor.bannerString.poleHeight }} m</span>
    </div>
    <input
      type="range"
      min="3"
      max="24"
      step="1"
      :value="editor.bannerString.poleHeight"
      @input="editor.setFeatureProp('bannerString', 'poleHeight', +$event.target.value)"
    />

    <!-- Heading -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Heading</span>
      <span>{{ editor.bannerString.heading }}°</span>
    </div>
    <input
      type="range"
      min="-180"
      max="180"
      step="1"
      :value="editor.bannerString.heading"
      @input="editor.setFeatureProp('bannerString', 'heading', +$event.target.value)"
    />

    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.featureAction('duplicateBannerString')">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.featureAction('deleteBannerString')">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
