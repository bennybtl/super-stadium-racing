<template>
  <EditorPanel
    v-if="editor.trackSettingsOpen && editor.isEditorActive"
    title="Track Settings"
    default-right="280px"
    @close="editor.closeTrackSettings()"
  >
    <div class="text-[12px] mb-1">Track Name</div>
    <input
      class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
      type="text"
      :value="editor.trackSettings.name"
      @input="editor.setTrackName($event.target.value)"
      placeholder="Untitled Track"
    />

    <div class="mt-4 text-[12px] mb-1">Track ID</div>
    <input
      class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
      type="text"
      :value="editor.trackSettings.id"
      @input="editor.setTrackId($event.target.value)"
      placeholder="untitled-track"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
    />
    <div class="mt-2 text-[10px] text-slate-400">Used for exported filenames. Non-slug characters are normalized automatically.</div>

    <div class="mt-4 text-[12px] mb-1">Default Terrain</div>
    <TerrainTypeSelect
      :label="'Default Terrain'"
      class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
      :model-value="editor.trackDefaultTerrain"
      @update:modelValue="editor.setTrackDefaultTerrain"
    />

    <div class="mt-4 text-[12px] mb-1">Border Terrain</div>
    <TerrainTypeSelect
      :label="'Border Terrain'"
      :model-value="editor.trackBorderTerrain"
      @update:modelValue="editor.setTrackBorderTerrain"
    />

    <div class="mt-3 text-[10px] text-slate-400">Track metadata and terrain defaults participate in undo/redo.</div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>