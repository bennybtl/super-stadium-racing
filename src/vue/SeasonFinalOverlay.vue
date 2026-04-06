<template>
  <div v-if="store.seasonFinalData" class="overlay">
    <div class="panel">

      <div class="trophy">🏆</div>
      <h2 class="title">Championship Final</h2>

      <div class="standings">
        <div
          v-for="s in store.seasonFinalData.standings"
          :key="s.id"
          class="standing-row"
          :class="{
            'standing-row--player': s.isPlayer,
            'standing-row--first':  s.position === 1,
          }"
        >
          <span class="s-medal">{{ medal(s.position) }}</span>
          <span class="s-pos">{{ s.position }}.</span>
          <span class="s-name">{{ s.name }}</span>
          <span class="s-pts">{{ s.totalPoints }} pts</span>
        </div>
      </div>

      <button class="action-btn" @click="store.exitSeason()">Back to Menu</button>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();

function medal(pos) {
  if (pos === 1) return '🥇';
  if (pos === 2) return '🥈';
  if (pos === 3) return '🥉';
  return '  ';
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  pointer-events: auto;
  font-family: Arial, sans-serif;
}

.panel {
  background: rgba(18, 18, 18, 0.98);
  border: 3px solid #ffc107;
  border-radius: 12px;
  padding: 40px 60px;
  min-width: 400px;
  max-width: 560px;
  text-align: center;
  box-shadow: 0 16px 60px rgba(0, 0, 0, 0.8), 0 0 60px rgba(255, 193, 7, 0.15);
}

.trophy {
  font-size: 72px;
  margin-bottom: 8px;
  line-height: 1;
}

.title {
  color: #ffc107;
  font-size: 24px;
  text-transform: uppercase;
  letter-spacing: 4px;
  margin: 0 0 28px;
}

.standings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 32px;
}

.standing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 6px;
  color: #bbb;
  font-size: 17px;
  background: rgba(255, 255, 255, 0.03);
}

.standing-row--first {
  background: rgba(255, 193, 7, 0.12);
  border: 1px solid rgba(255, 193, 7, 0.3);
  font-size: 20px;
  color: #ffc107;
}

.standing-row--player {
  font-weight: bold;
  color: #fff;
}

.standing-row--first.standing-row--player {
  color: #ffc107;
}

.s-medal { width: 28px; font-size: 20px; }
.s-pos   { width: 24px; color: #888; font-weight: bold; }
.s-name  { flex: 1; text-align: left; }
.s-pts   { color: #4caf50; font-weight: bold; min-width: 64px; text-align: right; }

.standing-row--first .s-pts { color: #ffc107; }

.action-btn {
  background: linear-gradient(to bottom, #ff5722, #d84315);
  color: #fff;
  border: none;
  padding: 14px 40px;
  font-size: 17px;
  font-weight: bold;
  border-radius: 6px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 2px;
  transition: background 0.15s, transform 0.1s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

.action-btn:hover {
  background: linear-gradient(to bottom, #ff7043, #ff5722);
  transform: translateY(-2px);
}
</style>
