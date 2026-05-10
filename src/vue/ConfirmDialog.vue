<template>
  <div class="confirm-dialog">
    <div class="dialog-panel">
      <h3>{{ title }}</h3>
      <div class="dialog-content">
        <slot />
      </div>
      <div class="dialog-actions">
        <button class="confirm-btn" @click="$emit('confirm')">Confirm</button>
        <button class="cancel-btn" @click="$emit('cancel')">Cancel</button>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({ title: { type: String, default: 'Are you sure?' } });
</script>

<style scoped>
.confirm-dialog {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.dialog-panel {
  background: #222;
  border-radius: 14px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  padding: 2.5rem 2rem;
  min-width: 320px;
  color: #fff;
  text-align: center;
}
.dialog-actions {
  display: flex;
  gap: 2rem;
  justify-content: center;
  margin-top: 2rem;
}
.confirm-btn {
  background: #0af;
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 0.7rem 2.2rem;
  font-size: 1.1rem;
  cursor: pointer;
}
.cancel-btn {
  background: #555;
  color: #fff;
  border: none;
  border-radius: 7px;
  padding: 0.7rem 2.2rem;
  font-size: 1.1rem;
  cursor: pointer;
}
</style>
