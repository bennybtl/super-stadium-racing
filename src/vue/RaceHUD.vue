<template>
  <div v-if="race.visible" class="fixed bottom-2.5 right-2.5 flex flex-col items-end gap-0 bg-black/70 pointer-events-none">
    <div v-if="race.timerVisible" class="w-full bg-black/80 text-[#00ff00] font-mono text-2xl font-bold p-1">{{ formattedTime }}</div>
    <div class="w-full text-[#999] font-mono text-base font-bold p-1">Checkpoints: <span>{{ race.checkpoints }}</span></div>
    <div class="w-full text-[#999] font-mono text-base font-bold p-1">Lap: <span>{{ race.lap }}</span>/{{ race.totalLaps }}</div>
    <div class="w-full p-1" :class="race.boostActive ? 'text-yellow-300 shadow-[0_0_20px_rgba(255,255,0,0.75)] animate-pulse' : 'text-[#999]'">
      Nitro: <span>{{ race.boosts }}</span>
    </div>

    <!-- Telemetry controls -->
    <div class="flex gap-1 p-1 pointer-events-auto">
      <button
        class="font-mono text-xs font-bold px-2 py-1 border border-slate-600 bg-black/80 text-slate-300 rounded-sm transition hover:bg-slate-800 hover:text-white"
        :class="race.telemetryRecording ? 'border-red-500 text-red-500 animate-pulse' : ''"
        @click="race.toggleTelemetry()"
      >
        {{ race.telemetryRecording ? '⏹ Stop' : '⏺ Record' }}
      </button>
      <button
        v-if="race.telemetryHasData"
        class="font-mono text-xs font-bold px-2 py-1 border border-sky-500 bg-black/80 text-sky-400 rounded-sm transition hover:bg-slate-800 hover:text-white"
        @click="race.exportTelemetry()"
      >
        ⬇ Export
      </button>
    </div>
    <div v-if="race.telemetryRecording" class="font-mono text-xs font-bold text-red-500 px-1 pb-1 animate-pulse">● REC</div>
  </div>

  <div v-if="race.countdownVisible" class="fixed inset-0 flex items-center justify-center pointer-events-none">
    <span class="text-[20vw] font-black text-white drop-shadow-[0_0_80px_rgba(255,200,0,0.7)] leading-none select-none" :style="{ color: race.countdownText === 'GO!' ? '#00ff44' : '#ffffff' }">
      {{ race.countdownText }}
    </span>
  </div>

  <div v-if="race.oobCountdownVisible" class="fixed top-[90px] left-1/2 -translate-x-1/2 pointer-events-none">
    <div class="bg-[#6e0000]/75 border border-[#ffa0a0]/50 text-white px-3 py-2 rounded-xl text-center shadow-[0_0_14px_rgba(255,40,40,0.35)] font-mono">
      <div class="text-[11px] tracking-[1px] opacity-90">OUT OF BOUNDS</div>
      <div class="text-base font-bold">RESPAWN IN {{ race.oobCountdownSeconds }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useRaceStore } from './store.js';

const race = useRaceStore();

const formattedTime = computed(() => {
  const ms = race.timerMs;
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
});
</script>

