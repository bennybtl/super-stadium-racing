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

        <div class="balance-box">
          <span class="balance-label">Budget</span>
          <span class="balance-amount">${{ store.pitData.playerBalance.toLocaleString() }}</span>
        </div>

        <div class="upgrades">
          <div
            v-for="u in store.pitData.upgrades"
            :key="u.id"
            class="upgrade-row"
            :class="{ 'upgrade-row--maxed': u.level >= u.maxLevel }"
          >
            <div class="upgrade-info">
              <span class="upgrade-label">{{ u.label }}</span>
              <span class="upgrade-desc">{{ u.description }}</span>
            </div>
            <div class="upgrade-level">
              <span
                v-for="i in u.maxLevel"
                :key="i"
                class="pip"
                :class="{ 'pip--filled': i <= u.level }"
              />
            </div>
            <button
              class="buy-btn"
              :disabled="u.level >= u.maxLevel || !u.affordable"
              @click="store.purchaseUpgrade(u.id)"
            >
              <template v-if="u.level >= u.maxLevel">MAX</template>
              <template v-else>${{ u.cost.toLocaleString() }}</template>
            </button>
          </div>
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
  padding: 28px 40px;
  min-width: 420px;
  max-width: 560px;
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
  font-size: 15px;
  margin: 12px 0 0;
}
.next-race strong { color: #fff; }
.balance-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: rgba(76, 175, 80, 0.08);
  border: 1px solid #4caf50;
  border-radius: 6px;
  padding: 10px 24px;
  margin: 14px 0 10px;
}
.balance-label {
  color: #888;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 2px;
}
.balance-amount {
  color: #4caf50;
  font-size: 30px;
  font-weight: bold;
  letter-spacing: 2px;
}
.upgrades {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 18px;
}
.upgrade-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid #333;
  border-radius: 6px;
  padding: 9px 12px;
  text-align: left;
}
.upgrade-row--maxed {
  border-color: #ff5722;
  background: rgba(255, 87, 34, 0.06);
}
.upgrade-info { flex: 1; min-width: 0; }
.upgrade-label {
  display: block;
  color: #fff;
  font-size: 14px;
  font-weight: bold;
}
.upgrade-desc {
  display: block;
  color: #777;
  font-size: 11px;
  margin-top: 1px;
}
.upgrade-level { display: flex; gap: 4px; align-items: center; }
.pip {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #333;
  border: 1px solid #555;
}
.pip--filled { background: #ff5722; border-color: #ff7043; }
.upgrade-row--maxed .pip--filled { background: #4caf50; border-color: #66bb6a; }
.buy-btn {
  min-width: 72px;
  padding: 6px 10px;
  background: linear-gradient(to bottom, #ff5722, #d84315);
  color: #fff;
  border: none;
  border-radius: 5px;
  font-size: 13px;
  font-weight: bold;
  cursor: pointer;
  letter-spacing: 1px;
  white-space: nowrap;
  transition: background 0.12s;
}
.buy-btn:hover:not(:disabled) { background: linear-gradient(to bottom, #ff7043, #ff5722); }
.buy-btn:disabled { background: #333; color: #666; cursor: not-allowed; }
.btn-group { display: flex; flex-direction: column; gap: 10px; }
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
.action-btn--retire:hover { background: linear-gradient(to bottom, #777, #555); }
.season-done {
  color: #4caf50;
  font-size: 22px;
  font-weight: bold;
  margin: 20px 0;
  letter-spacing: 2px;
}
</style>
