<template>
  <MenuBase>
    <div class="main-menu">
      <button class="menu-button" @click="$emit('navigate', 'practice')">Practice</button>
      <button class="menu-button" @click="$emit('navigate', 'singleRace')">Single Race</button>
      <button class="menu-button" @click="$emit('navigate', 'season')">Start Season</button>
      <hr class="my-3 opacity-60">
      <button class="menu-button menu-button-muted" @click="$emit('navigate', 'editor')">Track Editor</button>
      <button class="menu-button menu-button-muted" @click="$emit('navigate', 'settings')">Settings</button>
    </div>
  </MenuBase>
</template>

<script setup>
import MenuBase from './MenuBase.vue';
</script>

<style scoped>
.main-menu {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  align-items: stretch;
  min-width: 340px;
}
.menu-button {
  font-size: 2rem;
  padding: 1.2rem 0;
  font-family: inherit;
  font-style: italic;
  font-weight: bold;
  color: #fff;
  background: none;
  border: none;
  border-radius: 12px;
  outline: none;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  transition: color 0.18s, background 0.18s, transform 0.18s;
  -webkit-text-stroke: 2px #111;
}
.menu-button:hover {
  color: #ffe066;
  background: rgba(255,255,255,0.06);
  transform: scale(1.08);
}
.menu-button-muted {
  color: #999;
  -webkit-text-stroke: 2px #222;
}
</style>
