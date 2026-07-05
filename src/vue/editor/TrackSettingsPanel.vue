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
    <div class="mt-2 text-[10px] text-slate-400">Used for exported filenames.</div>

    <div class="mt-4 text-[12px] mb-1">Pack ID</div>
    <input
      class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
      type="text"
      :value="editor.trackSettings.packId"
      @input="editor.setTrackPackId($event.target.value)"
      placeholder="(no pack)"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
    />
    <div class="mt-2 text-[10px] text-slate-400">Groups the track under a pack in the selection menu. Leave blank for no pack.</div>

    <label class="mt-4 flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        class="h-4 w-4 accent-[var(--accent)] cursor-pointer"
        :checked="editor.trackSettings.hidden"
        @change="editor.setTrackHidden($event.target.checked)"
      />
      <span class="text-[13px] text-white">Hidden</span>
    </label>
    <div class="mt-2 text-[10px] text-slate-400">Hidden tracks are excluded from the race/practice selection until ready. <br>They still appear in the editor's track list.</div>

    <label class="mt-4 flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        class="h-4 w-4 accent-[var(--accent)] cursor-pointer"
        :checked="editor.trackSettings.dirtChunks"
        @change="editor.setTrackDirtChunks($event.target.checked)"
      />
      <span class="text-[13px] text-white">Dirt Chunks</span>
    </label>
    <div class="mt-2 text-[10px] text-slate-400">Scatters procedural dirt debris along walls and off the racing line.</div>

    <div class="mt-4 grid grid-cols-2 gap-2">
      <div>
        <div class="text-[12px] mb-1">Width</div>
        <input
          class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
          type="number"
          min="80"
          max="320"
          step="1"
          :value="editor.trackSettings.width"
          @input="editor.setTrackWidth($event.target.value)"
        />
      </div>
      <div>
        <div class="text-[12px] mb-1">Depth</div>
        <input
          class="w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-[13px] text-white outline-none transition focus:border-slate-500"
          type="number"
          min="80"
          max="320"
          step="1"
          :value="editor.trackSettings.depth"
          @input="editor.setTrackDepth($event.target.value)"
        />
      </div>
    </div>
    <div class="mt-2 text-[10px] text-slate-400">Track size range: 80 to 320 meters.</div>

    <button
      class="mt-3 mb-6 w-full rounded-md border border-slate-600 bg-slate-800/70 px-3 py-2 text-[12px] font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-700/70"
      type="button"
      @click="editor.rebuildScene"
    >
      Rebuild Scene
    </button>

    <TerrainTypeSelect
      :label="'Default Terrain'"
      :model-value="editor.trackDefaultTerrain"
      @update:modelValue="editor.setTrackDefaultTerrain"
    />

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