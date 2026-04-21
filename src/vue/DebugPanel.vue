<template>
  <div v-if="debug.visible" class="fixed top-2 left-2 bg-black/70 text-emerald-400 font-mono text-xs p-3 border border-emerald-400 min-w-[250px] pointer-events-none">
    <div class="flex justify-between mb-1"><span class="text-slate-400">Compression:</span><span class="text-emerald-400">{{ debug.data.compression }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Groundedness:</span><span class="text-emerald-400">{{ debug.data.groundedness }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Penetration:</span><span class="text-emerald-400">{{ debug.data.penetration }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Vert Velocity:</span><span class="text-emerald-400">{{ debug.data.vvel }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Horiz Speed:</span><span class="text-emerald-400">{{ debug.data.speed }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Effective Grip:</span><span class="text-emerald-400">{{ debug.data.grip }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Slip Angle:</span><span class="text-emerald-400">{{ debug.data.slip }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Terrain:</span><span class="text-emerald-400">{{ debug.data.terrain }}</span></div>
    <div class="flex justify-between mb-1"><span class="text-slate-400">Slope (fwd):</span><span class="text-emerald-400">{{ debug.data.slope }}</span></div>
    <div class="mb-1">X: {{ debug.data.x }}</div>
    <div class="mb-1">Y: {{ debug.data.y }}</div>
    <div class="mb-1">Z: {{ debug.data.z }}</div>
    <div class="flex justify-between mb-2"><span class="text-slate-400">Normal:</span><span class="text-emerald-400">{{ debug.data.nx }}, {{ debug.data.ny }}, {{ debug.data.nz }}</span></div>
    <div class="flex items-center gap-2 mt-2 pointer-events-auto">
      <button v-if="!debug.recording" @click="debug.startRecording()" class="rounded border border-emerald-400 bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 hover:bg-slate-800">⏺ Record</button>
      <button v-else @click="debug.stopRecording()" class="rounded border border-red-400 bg-slate-900 px-2 py-1 text-[11px] text-red-400 hover:bg-slate-800 animate-[blink_1s_step-start_infinite]">⏹ Stop</button>
      <button @click="debug.dumpLog()" class="rounded border border-emerald-400 bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 hover:bg-slate-800">⬇ Dump</button>
      <span class="text-slate-400 text-[11px]" v-if="debug.frameCount > 0">{{ debug.frameCount }} frames</span>
    </div>
  </div>
</template>

<script setup>
import { useDebugStore } from './store.js';
const debug = useDebugStore();
</script>
