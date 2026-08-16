<template>
  <!-- out-in so the panel resizes to one page at a time; a full-viewport slide
       would just be clipped by the panel, so these hop a short distance. -->
  <Transition :name="slideName" mode="out-in">
    <div :key="screen">
    <div v-if="screen === ''" class="flex flex-col">
      <h2 class="text-3xl font-extrabold italic uppercase mb-8 text-white">Settings</h2>
      <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="open('controls')">Controls</button>
      <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="open('sound')">Sound</button>
      <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="open('display')">Display</button>
      <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="open('gameplay')">Gameplay</button>
      <button class="menu-button pointer-events-auto px-10 py-4 text-2xl" @click="open('tracks')">Manage Tracks</button>
      <hr class="my-2 opacity-60">
      <button class="menu-button menu-button-muted pointer-events-auto px-10 py-4 text-2xl" @click="$emit('back')">Back</button>
    </div>
    <div v-else-if="screen === 'controls'">
      <ControlsSettings @back="close" />
    </div>
    <div v-else-if="screen === 'sound'">
      <SoundSettings @back="close" />
    </div>
    <div v-else-if="screen === 'display'">
      <DisplaySettings @back="close" />
    </div>
    <div v-else-if="screen === 'gameplay'">
      <GameplaySettings @back="close" />
    </div>
    <div v-else-if="screen === 'tracks'">
      <ManageTracksSettings @back="close" />
    </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed, ref } from 'vue';
import ControlsSettings from './settings/ControlsSettings.vue';
import SoundSettings from './settings/SoundSettings.vue';
import DisplaySettings from './settings/DisplaySettings.vue';
import GameplaySettings from './settings/GameplaySettings.vue';
import ManageTracksSettings from './settings/ManageTracksSettings.vue';

// Declared so the listener doesn't fall through onto the root <Transition>.
defineEmits(['back']);

const screen = ref('');

// Sub-pages slide the same way as top-level menus: down going in, up coming back.
const dir = ref('forward');
const slideName = computed(() =>
  dir.value === 'back' ? 'menu-slide-inner-back' : 'menu-slide-inner'
);
function open(next) { dir.value = 'forward'; screen.value = next; }
function close()    { dir.value = 'back';    screen.value = ''; }
</script>

