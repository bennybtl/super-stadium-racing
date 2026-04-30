<template>
  <Transition name="status-bar">
    <div v-if="editor.isEditorActive" class="fixed bottom-0 left-0 right-0 h-11 flex items-center gap-3 px-4 bg-black/80 border-t border-slate-900 z-[999] pointer-events-auto select-none box-border">

      <!-- Left: quick-test button -->
      <button class="rounded-xl bg-emerald-600 text-white px-4 py-2 text-[13px] font-sans shadow-sm shadow-black/40 transition hover:bg-emerald-500 whitespace-nowrap" @click="editor.quickTestTrack()">
        🏁 Test Track
      </button>
      <div class="text-slate-400 text-[11px] font-sans">
        Pan/Move: W,A,S,D | Rotate: Q,E | Delete: Del | Undo: Ctrl+Z | Zoom: +/- | Move Faster: Shift
      </div>

      <!-- Default terrain picker -->
      <div class="flex items-center gap-2">
        <span class="text-slate-500 text-[11px] font-sans whitespace-nowrap">Default Terrain</span>
        <select
          class="w-full max-w-[180px] bg-white/5 text-slate-200 border border-slate-800 rounded-lg px-2 py-1 text-[12px] font-sans cursor-pointer"
          :value="editor.trackDefaultTerrain"
          @change="editor.setTrackDefaultTerrain($event.target.value)"
        >
          <option value="packed_dirt">Packed Dirt</option>
          <option value="loose_dirt">Loose Dirt</option>
          <option value="asphalt">Asphalt</option>
          <option value="mud">Mud</option>
          <option value="water">Water</option>
          <option value="rocky">Rocky</option>
          <option value="grass">Grass</option>
        </select>
      </div>

      <!-- Border terrain picker -->
      <div class="flex items-center gap-2">
        <span class="text-slate-500 text-[11px] font-sans whitespace-nowrap">Border Terrain</span>
        <select
          class="w-full max-w-[180px] bg-white/5 text-slate-200 border border-slate-800 rounded-lg px-2 py-1 text-[12px] font-sans cursor-pointer"
          :value="editor.trackBorderTerrain"
          @change="editor.setTrackBorderTerrain($event.target.value)"
        >
          <option value="packed_dirt">Packed Dirt</option>
          <option value="loose_dirt">Loose Dirt</option>
          <option value="asphalt">Asphalt</option>
          <option value="mud">Mud</option>
          <option value="water">Water</option>
          <option value="rocky">Rocky</option>
          <option value="grass">Grass</option>
        </select>
      </div>

      <!-- Right: snap controls -->
      <div class="ml-auto flex items-center gap-2">
        <button
          class="rounded-full border border-slate-700 bg-white/5 text-slate-400 text-[12px] font-sans px-3 py-1 whitespace-nowrap transition duration-150 ease-in-out hover:bg-white/10"
          :class="{ 'text-emerald-400 border-emerald-400 bg-emerald-500/10': editor.snapEnabled }"
          @click="editor.toggleSnap()"
          title="Toggle grid snap [G]"
        >
          {{ editor.snapEnabled ? `GRID: ${editor.snapSize}u` : 'GRID: OFF' }}
        </button>
        <button
          class="grid h-6 w-6 place-items-center rounded-full border border-slate-700 bg-white/5 text-slate-400 text-[13px] transition duration-150 ease-in-out hover:text-white hover:border-slate-400"
          @click="editor.cycleSnapSize()"
          title="Cycle snap size [Shift+G]"
        >⟳</button>
        <button
          class="rounded-full border border-slate-700 bg-white/5 text-slate-400 text-[12px] font-sans px-3 py-1 whitespace-nowrap transition duration-150 ease-in-out hover:bg-white/10"
          :class="{ 'text-emerald-400 border-emerald-400 bg-emerald-500/10': editor.gizmosVisible }"
          @click="editor.toggleGizmosVisible()"
          title="Toggle editor gizmos"
        >
          {{ editor.gizmosVisible ? 'GIZMOS ON' : 'GIZMOS OFF' }}
        </button>
        <span class="text-slate-500 text-[11px] font-sans">{{ editor.snapEnabled ? '[G / Shift+G]' : '[G]' }}</span>
      </div>

    </div>
  </Transition>
</template>

<script setup>
import { useEditorStore } from '../store.js';
const editor = useEditorStore();
</script>

<style scoped>
/* ── Slide-up transition ── */
.status-bar-enter-active,
.status-bar-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.status-bar-enter-from,
.status-bar-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
