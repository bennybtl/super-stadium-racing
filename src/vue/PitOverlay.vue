<template>
  <div v-if="store.pitData" class="overlay">
    <div class="panel">

      <div class="pit-header">
        🔧 PIT LANE
        <span class="pit-sub">Race {{ store.pitData.raceNumber }} of {{ store.pitData.totalRaces }}</span>
      </div>

      <template v-if="!store.pitData.isSeasonComplete">
        <div class="next-race">
          Next track: <strong>{{ store.pitData.nextTrackKey }}</strong>
        </div>

        <div class="upgrade-placeholder">
          <span class="placeholder-label">[ Upgrades ]</span>
          <span class="coming-soon">coming soon</span>
        </div>

        <div class="btn-group">
          <button class="action-btn" @click="store.continueSeason()">
            Continue to Race {{ store.pitData.nextRaceNumber }}
          </button>
          <button class="action-btn action-btn--retire" @click="store.retireFromSeason()">
            Retire from Season
          </button>
        </div>
      </template>

      <template v-else>
        <!-- Season is complete — show final standings teaser -->
        <div class="season-done">Season complete!</div>
        <button class="action-btn" @click="store.continueSeason()">
          Final Standings →
        </button>
      </template>

    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';
const store = useMenuStore();
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
  padding: 36px 52px;
  min-width: 380px;
  max-width: 520px;
  text-align: center;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.7);
}

.pit-header {
  color: #ff5722;
  font-size: 28px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 4px;
  margin-bottom: 6px;
}

.pit-sub {
  display: block;
  font-size: 14px;
  color: #888;
  letter-spacing: 2px;
  margin-top: 4px;
  text-transform: none;
}

.next-race {
  color: #ccc;
  font-size: 16px;
  margin: 20px 0;
}

.next-race strong {
  color: #fff;
}

.upgrade-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #333;
  border-radius: 6px;
  padding: 18px 24px;
  margin-bottom: 28px;
}

.placeholder-label {
  color: #555;
  font-size: 16px;
  letter-spacing: 1px;
}

.coming-soon {
  color: #444;
  font-size: 12px;
  font-style: italic;
}

.btn-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.action-btn {
  background: linear-gradient(to bottom, #ff5722, #d84315);
  color: #fff;
  border: none;
  padding: 14px 32px;
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

.action-btn--retire {
  background: linear-gradient(to bottom, #555, #333);
  font-size: 14px;
  padding: 10px 24px;
}

.action-btn--retire:hover {
  background: linear-gradient(to bottom, #777, #555);
}

.season-done {
  color: #4caf50;
  font-size: 22px;
  font-weight: bold;
  margin: 20px 0;
  letter-spacing: 2px;
}
</style>
