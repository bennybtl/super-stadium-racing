<template>
  <div v-if="menu.loadingVisible" class="loading-overlay">
    <div class="loading-card">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loading-text">{{ menu.loadingMessage || 'Loading…' }}</div>
    </div>
  </div>
</template>

<script setup>
import { useMenuStore } from './store.js';

const menu = useMenuStore();
</script>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  background: rgba(18, 14, 12, 0.45);
  backdrop-filter: blur(2px);
}

.loading-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.spinner {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 3px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  color: #fff;
  font-size: 14px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  user-select: none;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
