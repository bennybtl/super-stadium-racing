<template>
  <EditorPanel
    v-if="editor.trackSettingsOpen && editor.isEditorActive"
    title="Track Settings"
    default-right="280px"
    @close="editor.closeTrackSettings()"
  >
    <div class="mt-2 grid grid-cols-3 gap-2">
      <div>
        <label class="ed-label">Track Name</label>
        <input
          class="ed-input"
          type="text"
          :value="editor.trackSettings.name"
          @input="editor.setTrackName($event.target.value)"
          placeholder="Untitled Track"
        />
      </div>
      <div>
        <label class="ed-label">Track ID</label>
        <input
          class="ed-input"
          type="text"
          :value="editor.trackSettings.id"
          @input="editor.setTrackId($event.target.value)"
          placeholder="untitled-track"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          autocorrect="off"
        />
      </div>
      <div>
          <label class="ed-label">Pack ID</label>
          <input
            class="ed-input"
            type="text"
            :value="editor.trackSettings.packId"
            @input="editor.setTrackPackId($event.target.value)"
            placeholder="(no pack)"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            autocorrect="off"
          />
      </div>
    </div>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <div>
        <label class="ed-label">Width</label>
        <input
          class="ed-input"
          type="number"
          min="80"
          max="320"
          step="1"
          :value="editor.trackSettings.width"
          @input="editor.setTrackWidth($event.target.value)"
        />
      </div>
      <div>
        <label class="ed-label">Depth</label>
        <input
          class="ed-input"
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

    <div class="mt-2 grid grid-cols-3 gap-2 max-w-[36rem]">
      <div>
        <TerrainTypeSelect
          :label="'Default Terrain'"
          :model-value="editor.trackDefaultTerrain"
          @update:modelValue="editor.setTrackDefaultTerrain"
        />
      </div>
      <div>
        <TerrainTypeSelect
          :label="'Border Terrain'"
          :model-value="editor.trackBorderTerrain"
          @update:modelValue="editor.setTrackBorderTerrain"
        />
      </div>
    </div>

    <hr class="ed-divider" />

    <div class="mt-2 grid grid-cols-3 gap-2 max-w-[36rem]">
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="editor.trackSettings.hidden"
            @change="editor.setTrackHidden($event.target.checked)"
          />
          <span class="text-[13px] text-white">Hidden</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Hidden tracks are excluded from the race/practice selection but still appear in the editor's track list.</div>
      </div>
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="editor.trackSettings.oobDeadSpace"
            @change="editor.setTrackOobDeadSpace($event.target.checked)"
          />
          <span class="text-[13px] text-white">Reset in Dead Space</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Driving into the edge dead space triggers the out-of-bounds respawn.</div>
      </div>
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            class="ed-checkbox"
            :checked="editor.trackSettings.allowReverse"
            @change="editor.setTrackAllowReverse($event.target.checked)"
          />
          <span class="text-[13px] text-white">Allow Reverse</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Excludes the track from reverse selection in cups and race setup.</div>
      </div>
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          class="ed-checkbox"
          :checked="editor.trackSettings.dirtChunks"
          @change="editor.setTrackDirtChunks($event.target.checked)"
        />
        <span class="text-[13px] text-white">Dirt Chunks</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400">Scatters procedural dirt debris along walls and off the racing line.</div>
      </div>
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          class="ed-checkbox"
          :checked="editor.trackSettings.grassBlades"
          @change="editor.setTrackGrassBlades($event.target.checked)"
        />
        <span class="text-[13px] text-white">Grass Blades</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400">Scatters procedural grass tufts along walls over grass terrain.</div>
      </div>
      <div>
        <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          class="ed-checkbox"
          :checked="editor.trackSettings.stadiumLighting"
          @change="editor.setTrackStadiumLighting($event.target.checked)"
        />
        <span class="text-[13px] text-white">Stadium Lighting</span>
        </label>
        <div class="mt-2 text-[10px] text-slate-400">On: Use the Track Light poles for the day. Off: (default) uses a single directional sun, which reads better on open outdoor terrain.</div>
      </div>
    </div>
    <hr class="ed-divider" />

    <div class="ed-heading">Perimeter Wall</div>

    <label class="mt-2 flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        class="ed-checkbox"
        :checked="editor.trackBorderWall.enabled"
        @change="editor.setTrackBorderWall('enabled', $event.target.checked)"
      />
      <span class="text-[13px] text-white">Wall</span>
    </label>
    <div class="mt-2 text-[10px] text-slate-400 max-w-96">The boxes sealing the track edge. Off leaves the perimeter open and carries the border terrain out to the horizon instead — pair with Reset in Dead Space to keep trucks on the track.</div>

    <template v-if="editor.trackBorderWall.enabled">
      <div class="ed-label">
        <span>Thickness</span>
        <span>{{ editor.trackBorderWall.thickness }}m</span>
      </div>
      <input
        type="range"
        min="0.5"
        max="8"
        step="0.5"
        :value="editor.trackBorderWall.thickness"
        @input="editor.setTrackBorderWall('thickness', +$event.target.value)"
        class="ed-slider"
      />

      <div class="ed-label">
        <span>Height</span>
        <span>{{ editor.trackBorderWall.height }}m</span>
      </div>
      <input
        type="range"
        min="1"
        max="20"
        step="1"
        :value="editor.trackBorderWall.height"
        @input="editor.setTrackBorderWall('height', +$event.target.value)"
        class="ed-slider"
      />
    </template>

    <hr class="border-t border-slate-700 my-2" />

    <button
      class="mt-3 mb-2 w-full rounded-md bg-white/70 px-3 py-1 text-[14px] font-semibold text-black transition hover:bg-white uppercase"
      type="button"
      @click="editor.rebuildScene"
    >
      Rebuild Scene
    </button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>