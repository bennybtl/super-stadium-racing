<template>
  <div class="w-[min(90vw,480px)] mx-auto px-12 py-10 text-center">
    <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Gameplay</h2>

    <div class="flex flex-col gap-7 items-stretch mb-8">
      <div class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Rubber Band</div>
        <select v-model="rubberBand" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option value="off">Off</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Minimap</div>
        <select v-model="minimap" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option :value="true">On</option>
          <option :value="false">Off</option>
        </select>
      </div>
      <div class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Camera Shake</div>
        <select v-model="cameraShake" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option :value="true">On</option>
          <option :value="false">Off</option>
        </select>
      </div>
      <!-- The starting camera for the *next* race — deliberately not applied to a
           race in progress, so this would silently do nothing there. Cycle the
           live camera with the "Cycle Camera" key instead. -->
      <div v-if="!inRace" class="flex items-center gap-6">
        <div class="grow min-w-[140px] text-right text-xl font-bold italic uppercase text-white pr-4">Preferred View</div>
        <select v-model="preferredView" class="w-[180px] shrink-0 px-6 py-2 rounded-md border border-[#333] bg-[#222] text-white text-lg font-bold uppercase italic tracking-wider outline-none transition-colors focus:border-[#ffd400]">
          <option value="fixed">Fixed</option>
          <option value="isometric">Isometric</option>
          <option value="chase">Chase</option>
          <option value="chase-low">Chase (Low)</option>
        </select>
      </div>
    </div>

    <!-- Progression (unlocks) is a menu-only concern, not something to touch
         mid-race. -->
    <template v-if="!inRace">
      <hr class="my-4 opacity-60">

      <h3 class="text-lg font-extrabold italic uppercase mb-4 text-white">Progression</h3>
      <div class="flex flex-col gap-4 items-stretch mb-2">
        <button class="menu-button menu-button-muted px-10 py-3 text-xl" @click="showResetConfirm = true">Reset Progression</button>
        <div class="flex flex-row items-center gap-3">
          <input
            v-model="cheatCode"
            type="text"
            placeholder="Cheat Code"
            class="min-w-0 flex-1 rounded-md border border-[#333] bg-[#222] px-4 py-2 text-lg font-bold uppercase italic tracking-wider text-white outline-none transition-colors focus:border-[#ffd400]"
            @keyup.enter="redeemCheatCode"
          />
          <button class="menu-button px-6 py-2 text-lg shrink-0" @click="redeemCheatCode">Redeem</button>
        </div>
        <p v-if="cheatMessage" class="text-[#ffd400] text-sm font-bold italic uppercase tracking-wide">{{ cheatMessage }}</p>
      </div>
    </template>

    <hr class="my-4 opacity-60">

    <button class="menu-button menu-button-muted px-10 py-4 text-2xl mt-2" @click="$emit('back')">Back</button>

    <ConfirmDialog
      v-if="showResetConfirm"
      title="RESET PROGRESSION?"
      @confirm="confirmReset"
      @cancel="showResetConfirm = false"
    >
      This locks every truck and track pack back to the start. This can't be undone. Reset anyway?
    </ConfirmDialog>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { loadGameplaySettings, saveGameplaySettings } from '../../settingsStorage.js';
import { useMenuStore } from '../store.js';
import ConfirmDialog from '../ConfirmDialog.vue';

defineProps({
  // True when opened from the in-race pause menu — hides Preferred View and
  // Progression, neither of which applies mid-race.
  inRace: { type: Boolean, default: false },
});

const store = useMenuStore();

const gameplaySettings = loadGameplaySettings();
const rubberBand = ref(gameplaySettings.rubberBand);
const minimap = ref(gameplaySettings.minimap);
const cameraShake = ref(gameplaySettings.cameraShake);
const preferredView = ref(gameplaySettings.preferredView);

watch([rubberBand, minimap, cameraShake, preferredView], () => {
  saveGameplaySettings({
    rubberBand: rubberBand.value,
    minimap: minimap.value,
    cameraShake: cameraShake.value,
    preferredView: preferredView.value,
  });
});

const showResetConfirm = ref(false);
function confirmReset() {
  showResetConfirm.value = false;
  cheatMessage.value = '';
  store.resetProgression();
}

const CHEAT_CODE = 'unlockall';
const cheatCode = ref('');
const cheatMessage = ref('');
function redeemCheatCode() {
  const code = cheatCode.value.trim().toLowerCase();
  cheatCode.value = '';
  if (!code) return;
  if (code === CHEAT_CODE) {
    store.unlockAllContent();
    cheatMessage.value = 'All trucks and tracks unlocked!';
  } else {
    cheatMessage.value = 'Invalid code.';
  }
}
</script>
