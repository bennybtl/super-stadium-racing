<template>
  <div v-if="store.screen" class="menu-overlay">
    <div class="menu-box" @mousedown.stop>
      <h1 class="menu-title">{{ title }}</h1>
      <div class="btn-group">

        <!-- ── Start ── -->
        <template v-if="store.screen === 'start'">
          <button class="menu-btn" @click="store.showTrackSelect()">Start Race</button>
          <button class="menu-btn" @click="store.showPracticeTrackSelect()">Practice</button>
          <button class="menu-btn" @click="store.showSeasonSetup()">Season</button>
          <button class="menu-btn" @click="store.showEditorTrackSelect()">Track Editor</button>
          <button class="menu-btn" @click="store.settings()">Settings</button>
        </template>

        <!-- ── Track select ── -->
        <template v-else-if="store.screen === 'trackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="menu-btn"
            @click="store.selectTrack(t.key)"
          >{{ t.name }}</button>
          <button class="menu-btn menu-btn--back" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Lap select ── -->
        <template v-else-if="store.screen === 'lapSelect'">
          <button
            v-for="n in [1, 3, 5, 10]"
            :key="n"
            class="menu-btn"
            @click="store.startGame(n)"
          >{{ n }} Lap{{ n > 1 ? 's' : '' }}</button>
          <button class="menu-btn menu-btn--back" @click="store.back('trackSelect')">Back</button>
        </template>

        <!-- ── Practice track select ── -->
        <template v-else-if="store.screen === 'practiceTrackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="menu-btn"
            @click="store.startPractice(t.key)"
          >{{ t.name }}</button>
          <button class="menu-btn menu-btn--back" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Editor track select ── -->
        <template v-else-if="store.screen === 'editorTrackSelect'">
          <button
            v-for="t in store.trackList"
            :key="t.key"
            class="menu-btn"
            @click="store.startEditor(t.key)"
          >{{ t.name }}</button>
          <button class="menu-btn menu-btn--green" @click="store.startEditor('new')">+ New Track</button>
          <button class="menu-btn menu-btn--back" @click="store.back('start')">Back</button>
        </template>

        <!-- ── In-game pause ── -->
        <template v-else-if="store.screen === 'pause'">
          <button class="menu-btn" @click="store.resume()">Resume</button>
          <button class="menu-btn" @click="store.reset()">Reset</button>
          <button class="menu-btn menu-btn--back" @click="store.exit()">Exit</button>
        </template>

        <!-- ── Editor pause ── -->
        <template v-else-if="store.screen === 'editorPause'">
          <button class="menu-btn" @click="store.editorResume()">Resume Editing</button>
          <button class="menu-btn" @click="store.editorSave()">Save Track</button>
          <button class="menu-btn" @click="store.editorLoad()">Load Track</button>
          <button class="menu-btn menu-btn--back" @click="store.editorExit()">Exit to Menu</button>
        </template>

        <!-- ── Settings ── -->
        <template v-else-if="store.screen === 'settings'">
          <button class="menu-btn menu-btn--back" @click="store.back('start')">Back</button>
        </template>

        <!-- ── Season setup ── -->
        <template v-else-if="store.screen === 'seasonSetup'">
          <p class="season-desc">Race on every track. Points awarded each round.<br>Choose laps per race:</p>
          <button
            v-for="n in [1, 3, 5]"
            :key="n"
            class="menu-btn"
            @click="store.startSeason(n)"
          >{{ n }} Lap{{ n > 1 ? 's' : '' }}</button>
          <button class="menu-btn menu-btn--back" @click="store.back('start')">Back</button>
        </template>

      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useMenuStore } from './store.js';

const store = useMenuStore();

const title = computed(() => {
  switch (store.screen) {
    case 'start':             return 'SUPER Off-Road!';
    case 'trackSelect':       return 'Select Track';
    case 'lapSelect':         return 'Select Laps';
    case 'editorTrackSelect': return 'Select Track to Edit';
    case 'seasonSetup':       return 'Season Mode';
    case 'pause':             return 'Paused';
    case 'editorPause':       return 'Track Editor';
    case 'settings':          return 'Settings';
    default:                  return '';
  }
});
</script>

<style scoped>
.menu-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: auto;
  font-family: Arial, sans-serif;
}

.menu-box {
  background: rgba(20, 20, 20, 0.95);
  padding: 40px 60px;
  border-radius: 10px;
  border: 3px solid #ff5722;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  text-align: center;
}

.menu-title {
  color: #ff5722;
  margin: 0 0 30px 0;
  font-size: 48px;
  text-transform: uppercase;
  letter-spacing: 4px;
  text-shadow: 0 0 10px rgba(255, 87, 34, 0.5);
}

.btn-group {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.menu-btn {
  background: linear-gradient(to bottom, #ff5722, #d84315);
  color: white;
  border: none;
  padding: 15px 40px;
  font-size: 20px;
  font-weight: bold;
  border-radius: 5px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 2px;
  transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.1s ease;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  font-family: Arial, sans-serif;
}

.menu-btn:hover {
  background: linear-gradient(to bottom, #ff7043, #ff5722);
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.4);
}

.menu-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.menu-btn--back {
  background: linear-gradient(to bottom, #666, #444);
  margin-top: 5px;
}
.menu-btn--back:hover {
  background: linear-gradient(to bottom, #888, #666);
}

.menu-btn--green {
  background: linear-gradient(to bottom, #4caf50, #388e3c);
}
.menu-btn--green:hover {
  background: linear-gradient(to bottom, #66bb6a, #4caf50);
}

.season-desc {
  color: #ccc;
  font-size: 14px;
  margin: 0 0 10px;
  line-height: 1.5;
}

.settings-section {
  width: 100%;
  margin-bottom: 20px;
}

.settings-label {
  display: block;
  font-size: 16px;
  font-weight: bold;
  color: #fff;
  margin-bottom: 12px;
  text-align: center;
}

.settings-options {
  display: flex;
  gap: 15px;
  justify-content: center;
  margin-bottom: 10px;
}

.settings-option {
  flex: 1;
  max-width: 200px;
  padding: 15px;
  background: rgba(60, 60, 60, 0.8);
  border: 2px solid #555;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #fff;
  font-family: Arial, sans-serif;
}

.settings-option:hover {
  background: rgba(80, 80, 80, 0.9);
  border-color: #ff6347;
  transform: translateY(-2px);
}

.settings-option.active {
  background: linear-gradient(to bottom, #ff6347, #ff4500);
  border-color: #ff6347;
  box-shadow: 0 4px 12px rgba(255, 99, 71, 0.5);
}

.option-title {
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 5px;
}

.option-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
}

.settings-option.active .option-desc {
  color: rgba(255, 255, 255, 1);
}
</style>
