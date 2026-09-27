<template>
  <EditorPanel
    v-if="editor.trackSettingsOpen && editor.isEditorActive"
    title="Track Settings"
    default-right="280px"
    @close="editor.closeTrackSettings()"
  >
  <div class="flex flex-row">
    <div class="mt-2 grid grid-cols-3 gap-2 max-w-[36rem]">
      <div>
        <label>Track Name</label>
        <input
          class="ed-input"
          type="text"
          :value="editor.trackSettings.name"
          @input="editor.setTrackName($event.target.value)"
          placeholder="Untitled Track"
        />
      </div>
      <div>
        <label>Track ID</label>
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
          <label>Pack ID</label>
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
    </div>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <div>
        <div class="ed-label">Width</div>
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
        <div class="ed-label">Depth</div>
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
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Hidden tracks are excluded from the race/practice selection until ready. <br>They still appear in the editor's track list.</div>
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
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Driving off the track perimeter into the surrounding dead space triggers the out-of-bounds respawn, even without an explicit out-of-bounds zone.</div>
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
        <div class="mt-2 text-[10px] text-slate-400 max-w-96">Turn off for tracks whose terrain only works one way (a one-way drop, a jump with no reverse landing, etc.) — excludes the track from reverse selection in cups and race setup.</div>
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
        <div class="mt-2 text-[10px] text-slate-400">Scatters procedural grass tufts along walls and off the racing line, over grass terrain only.</div>
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
        <div class="mt-2 text-[10px] text-slate-400">Lights the placed Track Light poles for the day look too (ambient floor + poles, no sun) — for arena-style tracks. Needs Track Light features placed to have any effect. Off (default) uses a single directional sun, which reads better on open outdoor terrain.</div>
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
      class="mt-3 mb-2 w-full rounded-md border border-slate-600 bg-slate-800/70 px-3 py-2 text-[12px] font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-700/70"
      type="button"
      @click="editor.rebuildScene"
    >
      Rebuild Scene
    </button>


    <div class="mt-3 text-[10px] text-slate-400">Track metadata and terrain defaults participate in undo/redo.</div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';
import TerrainTypeSelect from './TerrainTypeSelect.vue';

const editor = useEditorStore();
</script>