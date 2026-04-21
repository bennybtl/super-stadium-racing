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
      <option value="outOfBounds">Out of Bounds</option>
    </select>

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
      <button class="w-full rounded-md bg-slate-700 text-white py-2 text-[13px] font-sans mb-2 hover:bg-slate-600" @click="editor.insertActionZonePoint()">Insert Point</button>
      <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteActionZonePoint()">Delete Point</button>
    </template>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Del to delete{{ editor.actionZone.shape === 'polygon' ? ' point/zone' : '' }}</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateActionZone()">Duplicate</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteActionZone()">Delete</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
