<template>
  <div>
    <div v-if="screen === ''" class="settings-menu">
      <button class="menu-button px-10 py-4 text-2xl" @click="screen = 'controls'">Controls</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="screen = 'sound'">Sound</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="screen = 'display'">Display</button>
      <button class="menu-button px-10 py-4 text-2xl" @click="screen = 'tracks'">Manage Tracks</button>
      <hr class="my-3 opacity-60">
      <button class="menu-button menu-button-muted px-10 py-4 text-2xl" @click="$emit('back')">Back</button>
    </div>
    <div v-else-if="screen === 'controls'">
      <ControlsSettings @back="screen = ''" />
    </div>
    <div v-else-if="screen === 'sound'">
      <SoundSettings @back="screen = ''" />
    </div>
    <div v-else-if="screen === 'display'">
      <DisplaySettings @back="screen = ''" />
    </div>
    <div v-else-if="screen === 'tracks'">
      <ManageTracksSettings @back="screen = ''" />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import ControlsSettings from './settings/ControlsSettings.vue';
import SoundSettings from './settings/SoundSettings.vue';
import DisplaySettings from './settings/DisplaySettings.vue';
import ManageTracksSettings from './settings/ManageTracksSettings.vue';

const screen = ref('');
</script>

<style scoped>
.settings-menu {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: stretch;
  min-width: 320px;
}
</style>
