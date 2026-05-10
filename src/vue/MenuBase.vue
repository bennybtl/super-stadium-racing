<template>
  <div class="menu-base">
    <div class="menu-panel">
      <slot />
    </div>
  </div>
</template>

<script setup>
// No logic needed, just a shell for styling
</script>

<style scoped>
.menu-base {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 5vh 0;
}
.menu-panel {
  background: url('../assets/checker-black.png');
  background-repeat: repeat;
  background-size: 220px 220px;
  border-radius: 18px;
  box-shadow: 0 12px 48px rgba(0,0,0,0.7);
  padding: 3rem 2.5rem;
  min-width: 340px;
  max-width: 480px;
  margin: 0 5vw;
}
</style>
