<template>
  <!-- Reusable modal shell: dimmed full-screen backdrop with a centered panel.
       Content goes in the default slot. Emits `close` on backdrop click when
       `dismissable` is set. -->
  <Transition name="modal-fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[2000] flex items-center justify-center pointer-events-auto bg-black/60 backdrop-blur-sm"
      @mousedown.self="dismissable && $emit('close')"
    >
      <div class="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-black/75 px-8 py-6 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
        <slot />
      </div>
    </div>
  </Transition>
</template>

<script setup>
defineProps({
  open: { type: Boolean, default: true },
  dismissable: { type: Boolean, default: false },
});
defineEmits(['close']);
</script>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active { transition: opacity 0.2s ease; }
.modal-fade-enter-from,
.modal-fade-leave-to { opacity: 0; }
</style>
