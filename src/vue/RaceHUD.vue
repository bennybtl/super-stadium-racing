<template>
  <div v-if="race.visible" class="race-status-panel">
    <div v-if="race.timerVisible" class="race-timer">{{ formattedTime }}</div>
    <div class="hud-row">Checkpoints: <span class="hud-val">{{ race.checkpoints }}</span></div>
    <div class="hud-row">Lap: <span class="hud-val">{{ race.lap }}</span>/{{ race.totalLaps }}</div>
    <div class="hud-row" :class="{ 'boost-active': race.boostActive }">
      Nitro: <span class="hud-val">{{ race.boosts }}</span>
    </div>
  </div>

  <div v-if="race.countdownVisible" class="countdown-overlay">
    <span class="countdown-text" :style="{ color: race.countdownText === 'GO!' ? '#00ff44' : '#ffffff' }">
      {{ race.countdownText }}
    </span>
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

<style scoped>
.race-status-panel {
  position: fixed;
  bottom: 10px;
  right: 10px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0;
  background: rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

.race-timer {
  width: 100%;
  background: rgba(0, 0, 0, 0.8);
  color: #00ff00;
  font-family: 'Courier New', monospace;
  font-size: 24px;
  font-weight: bold;
  padding: 5px;
}

.hud-row {
  width: 100%;
  color: #999;
  font-family: 'Courier New', monospace;
  font-size: 16px;
  font-weight: bold;
  padding: 5px;
}

.hud-val {
  color: inherit;
}

.boost-active {
  color: #ff0;
  box-shadow: 0 0 20px #ff0;
  animation: pulse 0.3s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.7; }
}

.countdown-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.countdown-text {
  font-size: 20vw;
  font-family: 'Arial Black', Arial, sans-serif;
  font-weight: 900;
  text-shadow: 0 0 80px rgba(255, 200, 0, 0.7), 6px 6px 0 rgba(0, 0, 0, 0.8);
  line-height: 1;
  user-select: none;
}
</style>
