<template>
  <EditorPanel
    v-if="editor.selectedType === 'aiPath'"
    title="AI Path"
    @close="editor.closeAiPath"
  >
    <div class="mb-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
      <div class="text-slate-200 text-sm font-medium mb-1">AI path editing mode</div>
      <div class="text-slate-400 text-[11px]">Click terrain to add a waypoint. Click an existing waypoint to select it.</div>
    </div>

    <button
      class="w-full rounded-md bg-slate-800 text-white py-2 text-[13px] font-sans mb-3 hover:bg-slate-700"
      @click="editor.deleteAiWaypoint()"
    >
      Delete selected waypoint
    </button>

    <button
      class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-3 hover:bg-rose-500"
      @click="editor.clearAiPath()"
    >
      Clear AI path
    </button>

    <div class="text-[10px] text-slate-400">
      Click terrain to add waypoints. Select a node to edit it. Press <kbd>Esc</kbd> to close the panel.
    </div>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
