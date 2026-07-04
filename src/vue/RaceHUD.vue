<template>
  <div v-if="race.visible" class="pointer-events-none">
    <div
      v-if="race.timerVisible"
      class="fixed left-1/2 top-4 z-[1200] -translate-x-1/2"
    >
      <div class="rounded-[14px] bg-[#0c0c0c]/60 px-6 py-2 shadow-[0_10px_12px_rgba(0,0,0,0.55)]">
        <div class="flex items-center gap-3">
          <span class="h-[2px] w-10 rounded-full bg-gradient-to-r from-[#2e54ff] to-[#e61515]"></span>
          <span class="font-mono text-[28px] font-black tracking-[0.12em] text-white tabular-nums drop-shadow-[0_0_10px_rgba(0,0,0,0.8)]">
            {{ formattedTime }}
          </span>
          <span class="h-[2px] w-10 rounded-full bg-gradient-to-l from-[#e61515] to-[#2e54ff]"></span>
        </div>
      </div>
    </div>

    <div class="fixed left-1/2 bottom-4 -translate-x-1/2 z-[1200]">
      <div class="rounded-[14px] overflow-hidden bg-[#0c0c0c]/60 px-2 py-2 shadow-[0_10px_12px_rgba(0,0,0,0.62)] backdrop-blur-sm">
        <div class="grid gap-px" :style="gridStyle">
          <div class="flex h-full items-center justify-end text-right font-mono text-[10px] font-black uppercase tracking-[0.28em] text-[#d2cbc3] leading-none">
          </div>
          <div
            v-for="(truck, index) in race.truckStatus"
            :key="`name-${truck.id ?? index}`"
            class="text-center"
          >
            <div class="truncate font-mono text-[10px] font-black uppercase tracking-[0.16em] text-white" :style="truckChipStyle(truck, index)">
              {{ truckLabel(truck, index) }}
            </div>
          </div>

          <div class="flex h-full items-center justify-end text-right font-mono text-[10px] font-black uppercase tracking-[0.28em] text-[#d2cbc3] leading-none">
            Lap
          </div>
          <div
            v-for="(truck, index) in race.truckStatus"
            :key="`lap-${truck.id ?? index}`"
            class="text-center"
          >
            <div class="rounded-md border font-mono text-white tabular-nums" :style="cellStyle(truck, index, truck.finished ? 0.45 : 1)">
              {{ truck.lap }}/{{ truck.totalLaps }}
            </div>
          </div>

          <div class="flex h-full items-center justify-end text-right font-mono text-[10px] font-black uppercase tracking-[0.28em] text-[#d2cbc3] leading-none">
            Nitro
          </div>

          <div
            v-for="(truck, index) in race.truckStatus"
            :key="`nitro-${truck.id ?? index}`"
            class="text-center"
          >
            <div
              class="rounded-md border font-mono text-white tabular-nums"
              :class="truck.boostActive ? 'animate-pulse' : ''"
              :style="cellStyle(truck, index, truck.boostActive ? 1 : 0.82, true)"
            >
             {{ truck.boosts }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div v-if="race.hotLapMode && race.visible" class="pointer-events-none">
    <div class="fixed right-4 top-4 z-[1200] flex flex-col items-end gap-2">
      <div class="rounded-[10px] bg-[#0c0c0c]/60 px-4 py-2 shadow-[0_6px_12px_rgba(0,0,0,0.5)]">
        <div class="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#8ab4f8]">Best Lap</div>
        <div class="font-mono text-[20px] font-black tabular-nums text-white">
          {{ race.hotLapBestMs != null ? formatMs(race.hotLapBestMs) : '--:--.--' }}
        </div>
      </div>
      <button
        class="pointer-events-auto rounded-[8px] bg-[#0c0c0c]/60 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] shadow-[0_4px_8px_rgba(0,0,0,0.4)] transition-colors"
        :class="race.hotLapGhostVisible ? 'text-[#8ab4f8]' : 'text-[#666]'"
        @click="toggleGhost"
      >
        Ghost {{ race.hotLapGhostVisible ? 'ON' : 'OFF' }}
      </button>
    </div>
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

const gridStyle = computed(() => ({
  gridTemplateColumns: `3.75rem repeat(${Math.max(1, race.truckStatus.length)}, minmax(0, 1fr))`,
}));

function formatMs(ms) {
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

const formattedTime = computed(() => formatMs(race.timerMs));

function toggleGhost() {
  race.hotLapGhostVisible = !race.hotLapGhostVisible;
}

function truckLabel(truck, index) {
  return truck?.name ?? `Truck ${index + 1}`;
}

function toCssColor(color) {
  if (!color) return '#ff6b2e';
  if (typeof color === 'string') return color;
  if (typeof color.toHexString === 'function') return color.toHexString();
  if (typeof color.r === 'number' && typeof color.g === 'number' && typeof color.b === 'number') {
    const to255 = value => Math.max(0, Math.min(255, Math.round(value * 255)));
    return `rgb(${to255(color.r)} ${to255(color.g)} ${to255(color.b)})`;
  }
  return '#ff6b2e';
}

function cellStyle(truck, index, opacity = 1, nitro = false) {
  const color = toCssColor(truck?.color);
  return {
    borderColor: color,
    background: nitro
      ? `linear-gradient(180deg, rgba(0,0,0,0.9), rgba(15,15,15,0.98))`
      : `linear-gradient(180deg, rgba(255,255,255,${0.10 * opacity}), rgba(0,0,0,0.95))`,
    boxShadow: truck?.boostActive
      ? `0 0 0 1px ${color}, 0 0 18px rgba(255,255,255,0.08)`
      : `0 0 0 1px rgba(255,255,255,0.06)`,
    color: truck?.finished ? 'rgba(255,255,255,0.55)' : 'white',
  };
}

function truckChipStyle(truck, index) {
  const color = toCssColor(truck?.color);
  return {
    color,
    textShadow: `0 0 10px ${color}44`,
  };
}
</script>

