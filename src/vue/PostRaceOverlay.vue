<template>
  <div v-if="store.postRaceData" class="overlay">
    <div class="panel">

      <h2 class="section-title">
        Race Results — {{ store.postRaceData.trackKey }}
        <span class="subtitle">(Race {{ store.postRaceData.raceNumber }} of {{ store.postRaceData.totalRaces }})</span>
      </h2>

      <!-- Results table -->
      <table class="results-table">
        <thead>
          <tr>
            <th>Pos</th>
            <th>Driver</th>
            <th>Race Time</th>
            <th>Best Lap</th>
            <th>Pts</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in store.postRaceData.rows"
            :key="row.id"
            :class="{ 'row--player': row.isPlayer, 'row--dnf': row.dnf }"
          >
            <td class="pos">{{ row.finishPosition }}</td>
            <td class="name">{{ row.name }}<span v-if="row.dnf" class="dnf-badge">DNF</span></td>
            <td>{{ formatTime(row.totalRaceTimeMs) }}</td>
            <td>{{ formatTime(row.fastestLapMs) }}</td>
            <td class="pts">+{{ row.pointsEarned }}</td>
            <td class="total">{{ row.totalPoints }}</td>
          </tr>
        </tbody>
      </table>

      <div class="divider" />

      <!-- Championship standings -->
      <h2 class="section-title">Championship Standings</h2>
      <div class="standings">
        <div
          v-for="s in store.postRaceData.standings"
          :key="s.id"
          class="standing-row"
          :class="{ 'standing-row--player': s.isPlayer }"
        >
          <span class="s-pos">{{ s.position }}.</span>
          <span class="s-name">{{ s.name }}</span>
          <span class="s-pts">{{ s.totalPoints }} pts</span>
        </div>
      </div>

      <div class="divider" />

      <button class="action-btn" @click="store.goToPit()">Head to the Pit →</button>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const store = useMenuStore();

function formatTime(ms) {
  if (ms == null) return '—';
  const m  = Math.floor(ms / 60000);
  const s  = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  pointer-events: auto;
  font-family: Arial, sans-serif;
}

.panel {
  background: rgba(18, 18, 18, 0.98);
  border: 3px solid #ff5722;
  border-radius: 10px;
  padding: 32px 48px;
  min-width: 560px;
  max-width: 720px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
}

.section-title {
  color: #ff5722;
  font-size: 20px;
  text-transform: uppercase;
  letter-spacing: 3px;
  margin: 0 0 16px;
  text-align: center;
}

.subtitle {
  display: block;
  font-size: 13px;
  color: #aaa;
  letter-spacing: 1px;
  margin-top: 4px;
}

.results-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 15px;
  color: #ddd;
}

.results-table th {
  color: #888;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 6px 8px;
  text-align: left;
  border-bottom: 1px solid #333;
}

.results-table td {
  padding: 8px 8px;
  border-bottom: 1px solid #222;
}

.results-table .pos   { font-weight: bold; color: #ff5722; width: 32px; }
.results-table .pts   { color: #4caf50; font-weight: bold; }
.results-table .total { font-weight: bold; color: #fff; }

.row--player td { color: #fff; background: rgba(255, 87, 34, 0.08); }
.row--dnf   td { color: #666; }

.dnf-badge {
  margin-left: 8px;
  background: #5a1a1a;
  color: #f44;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 1px;
  vertical-align: middle;
}

.divider {
  border: none;
  border-top: 1px solid #333;
  margin: 20px 0;
}

.standings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.standing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 5px;
  color: #bbb;
  font-size: 15px;
}

.standing-row--player {
  background: rgba(255, 87, 34, 0.12);
  color: #fff;
  font-weight: bold;
}

.s-pos  { width: 24px; color: #ff5722; font-weight: bold; }
.s-name { flex: 1; }
.s-pts  { color: #4caf50; font-weight: bold; min-width: 60px; text-align: right; }

.action-btn {
  display: block;
  margin: 0 auto;
  background: linear-gradient(to bottom, #ff5722, #d84315);
  color: #fff;
  border: none;
  padding: 14px 40px;
  font-size: 18px;
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
