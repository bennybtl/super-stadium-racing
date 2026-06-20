<template>
  <EditorPanel
    v-if="editor.selectedType === 'actionZone'"
    title="Action Zone"
    @close="editor.closeActionZone()"
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
        @input="editor.setActionZoneBoostStrength(+$event.target.value)"
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
        @input="editor.setActionZoneBoostDuration(+$event.target.value)"
      />
      <div class="text-[10px] text-slate-400 mb-3">Multiplies top speed &amp; acceleration. Duration is how long the boost lingers after leaving the zone.</div>
    </template>

    <!-- Zone shape -->
    <div class="text-[12px] mb-1">Shape</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.actionZone.shape"
      @change="editor.setActionZoneShape($event.target.value)"
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
      @input="editor.setActionZoneRadius(+$event.target.value)"
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
          @click="editor.deleteActionZonePoint()"
        >Delete Point</button>
        <button 
          class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
          @click="editor.insertActionZonePoint()"
        >Insert Point</button>
      </div>
    </template>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete{{ editor.actionZone.shape === 'polygon' ? ' point/zone' : '' }}</div>

    <!-- Actions -->
    <div class="flex gap-2">
      <button 
        class="flex-1 rounded-md border border-red-500/70 bg-red-950/70 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-red-100 transition duration-150 hover:bg-red-900" 
        @click="editor.deleteActionZone()">Delete</button>
      <button 
        class="flex-1 rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-[12px] font-bold uppercase tracking-[1px] text-slate-100 transition duration-150 hover:bg-slate-700"
        @click="editor.duplicateActionZone()">Duplicate</button>
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
