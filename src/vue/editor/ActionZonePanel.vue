<template>
  <EditorPanel
    v-if="editor.selectedType === 'actionZone'"
    title="Action Zone"
    @close="editor.featureAction('deselectActionZone')"
  >
    <!-- Zone type -->
    <div class="text-[12px] mb-1">Zone Type</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.actionZone.zoneType"
      @change="editor.setActionZoneType($event.target.value)"
    >
      <option value="pickupSpawn">Pickup Spawn</option>
      <option value="slowZone">Slow Zone</option>
      <option value="speedBoost">Speed Boost</option>
      <option value="outOfBounds">Out of Bounds</option>
      <option value="fireworks">Fireworks</option>
    </select>

    <!-- Speed boost controls -->
    <template v-if="editor.actionZone.zoneType === 'speedBoost'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Boost Strength</span>
        <span>{{ editor.actionZone.boostStrength.toFixed(2) }}×</span>
      </div>
      <input
        type="range"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        min="1.1" max="2.5" step="0.05"
        :value="editor.actionZone.boostStrength"
        @input="editor.setFeatureProp('actionZone', 'boostStrength', +$event.target.value)"
      />
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Boost Duration</span>
        <span>{{ editor.actionZone.boostDuration.toFixed(1) }}s</span>
      </div>
      <input
        type="range"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        min="0.2" max="4" step="0.1"
        :value="editor.actionZone.boostDuration"
        @input="editor.setFeatureProp('actionZone', 'boostDuration', +$event.target.value)"
      />
      <div class="text-[10px] text-slate-400 mb-3">Multiplies top speed &amp; acceleration. Duration is how long the boost lingers after leaving the zone.</div>
    </template>

    <template v-if="editor.actionZone.zoneType === 'slowZone'">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Slow Strength</span>
        <span>{{ editor.actionZone.slowStrength * 10 }}%</span>
      </div>
      <input
        type="range"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        min="0.5" max="9.5" step="0.5"
        :value="editor.actionZone.slowStrength"
        @input="editor.setFeatureProp('actionZone', 'slowStrength', +$event.target.value)"
      />
    </template>
    <!-- Firework controls -->
    <template v-if="editor.actionZone.zoneType === 'fireworks'">
      <div class="text-[12px] mb-1">Effect</div>
      <select
        class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
        :value="editor.actionZone.fireworkMode"
        @change="editor.setFeatureProp('actionZone', 'fireworkMode', $event.target.value)"
      >
        <option value="shell">Launched Shell</option>
        <option value="sparks">Spark Fountain</option>
        <option value="flame">Flame Blast</option>
      </select>

      <!-- Shell count -->
      <template v-if="editor.actionZone.fireworkMode === 'shell'">
        <div class="flex justify-between mb-1 text-[12px]">
          <span>Shells</span>
          <span>{{ editor.actionZone.fireworkCount }}</span>
        </div>
        <input
          type="range"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
          min="1" max="6" step="1"
          :value="editor.actionZone.fireworkCount"
          @input="editor.setFeatureProp('actionZone', 'fireworkCount', +$event.target.value)"
        />
      </template>

      <!-- Fountain colour -->
      <template v-if="editor.actionZone.fireworkMode === 'sparks'">
        <div class="text-[12px] mb-1">Spark Color</div>
        <select
          class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3 capitalize"
          :value="editor.actionZone.fireworkColor"
          @change="editor.setFeatureProp('actionZone', 'fireworkColor', $event.target.value)"
        >
          <option v-for="name in SPARK_COLOR_NAMES" :key="name" :value="name" class="capitalize">{{ name }}</option>
        </select>
      </template>

      <!-- Burn time for the sustained modes -->
      <template v-if="editor.actionZone.fireworkMode !== 'shell'">
        <div class="flex justify-between mb-1 text-[12px]">
          <span>Duration</span>
          <span>{{ editor.actionZone.fireworkDuration.toFixed(1) }}s</span>
        </div>
        <input
          type="range"
          class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
          min="0.3" max="6" step="0.1"
          :value="editor.actionZone.fireworkDuration"
          @input="editor.setFeatureProp('actionZone', 'fireworkDuration', +$event.target.value)"
        />
      </template>

      <div class="flex justify-between mb-1 text-[12px]">
        <span>{{ heightLabel }}</span>
        <span>{{ editor.actionZone.fireworkHeight }} m</span>
      </div>
      <input
        type="range"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        :min="heightRange.min" :max="heightRange.max" step="1"
        :value="editor.actionZone.fireworkHeight"
        @input="editor.setFeatureProp('actionZone', 'fireworkHeight', +$event.target.value)"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>Can Rotation</span>
        <span>{{ editor.actionZone.heading.toFixed(0) }}°</span>
      </div>
      <input
        type="range" min="-180" max="180" step="5"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
        :value="editor.actionZone.heading"
        @input="editor.setFeatureProp('actionZone', 'heading', +$event.target.value)"
      />
      <button
        class="w-full rounded-md border border-purple-400/70 bg-purple-950/70 px-3 py-2 mb-3 text-[12px] font-bold uppercase tracking-[1px] text-purple-100 transition duration-150 hover:bg-purple-900"
        @click="editor.featureAction('previewActionZoneFireworks')"
      ><i class="bi bi-play-fill"></i> Preview</button>

      <div class="text-[10px] text-slate-400 mb-3">{{ modeHint }} Q/E also turns the cans. The zone re-arms once the effect finishes.</div>
    </template>

    <!-- Zone shape -->
    <div class="text-[12px] mb-1">Shape</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.actionZone.shape"
      @change="editor.setFeatureProp('actionZone', 'shape', $event.target.value)"
    >
      <option value="circle">Circle</option>
      <option value="polygon">Polygon</option>
    </select>

    <!-- Circle controls -->
    <div v-if="editor.actionZone.shape === 'circle'" class="flex justify-between mb-1 text-[12px]">
      <span>Radius</span>
      <span>{{ editor.actionZone.radius }} m</span>
    </div>
    <input
      v-if="editor.actionZone.shape === 'circle'"
      type="range"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      min="4" max="60" step="0.5"
      :value="editor.actionZone.radius"
      @input="editor.setFeatureProp('actionZone', 'radius', +$event.target.value)"
    />

    <!-- Polygon controls -->
    <template v-else>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Points</span>
        <span>{{ editor.actionZone.pointCount }}</span>
      </div>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Selected Point</span>
        <span>{{ editor.actionZone.selectedPointIndex >= 0 ? editor.actionZone.selectedPointIndex + 1 : 'Center' }}</span>
      </div>
      <div class="flex gap-2 mb-3">
        <button 
          class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900"
          @click="editor.featureAction('deleteActionZonePoint')"
        >Delete Point</button>
        <button 
          class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
          @click="editor.featureAction('insertActionZonePoint')"
        >Insert Point</button>
      </div>
    </template>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete{{ editor.actionZone.shape === 'polygon' ? ' point/zone' : '' }}</div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900" 
        @click="editor.featureAction('deleteActionZone')">Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.featureAction('duplicateActionZone')">Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { computed } from 'vue';
import { useEditorStore } from '../store.js';
import { SPARK_COLOR_NAMES } from '../../objects/sparkColors.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();

// Height means burst apex for shells and throw distance for the sustained modes,
// so the slider relabels and rescales with the effect.
const heightLabel = computed(() => (
  editor.actionZone.fireworkMode === 'shell' ? 'Burst Height' : 'Reach'
));

const heightRange = computed(() => (
  editor.actionZone.fireworkMode === 'shell' ? { min: 8, max: 60 } : { min: 3, max: 25 }
));

const modeHint = computed(() => ({
  shell:  'Shells fire from the two cans, alternating.',
  sparks: 'Both cans throw a fountain of sparks in the chosen colour.',
  flame:  'Both cans blast a column of fire.',
}[editor.actionZone.fireworkMode] ?? ''));
</script>
