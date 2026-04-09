<template>
  <Transition name="add-menu">
    <div
      v-if="editor.addMenuOpen"
      class="add-menu-backdrop"
      @mousedown.self="editor.closeAddMenu()"
    >
      <div class="add-menu" @mousedown.stop>
        <h2 class="add-menu-title">Add Feature</h2>

        <button class="add-btn" @click="editor.addCheckpoint()">Checkpoint</button>
        <button class="add-btn" @click="editor.addHill()">Round Hill</button>
        <button class="add-btn" @click="editor.addSquareHill()">Square Hill</button>
        <button class="add-btn" @click="editor.addTerrainRect()">Terrain Region</button>
        <button class="add-btn" @click="editor.addMeshGrid()">Mesh Grid</button>
        <button class="add-btn" @click="editor.addPolyWall()">Poly Wall</button>
        <button class="add-btn" @click="editor.addPolyHill()">Poly Hill</button>
        <button class="add-btn" @click="editor.addBezierWall()">Bezier Wall</button>
        <button class="add-btn" @click="editor.addNormalMapDecal()">Normal Map Decal</button>
        <button class="add-btn" @click="editor.addTireStack()">Tire Stack</button>
        <button class="add-btn" @click="editor.addTrackSign()">Track Sign</button>
        <button class="add-btn" @click="editor.addFlag()">Flag</button>

        <button class="add-btn add-btn--cancel" @click="editor.closeAddMenu()">Cancel</button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useEditorStore } from '../store.js';
const editor = useEditorStore();
</script>

<style scoped>
.add-menu-backdrop {
  position: fixed;
  inset: 0;
  pointer-events: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.add-menu {
  background: rgba(0, 0, 0, 0.92);
  border: 2px solid #4a9eff;
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 240px;
}

.add-menu-title {
  color: white;
  margin: 0 0 14px 0;
  font-family: Arial, sans-serif;
  font-size: 18px;
  text-align: center;
}

.add-btn {
  display: block;
  width: 100%;
  padding: 10px;
  margin: 5px 0;
  background: #4a9eff;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  font-size: 15px;
  font-family: Arial, sans-serif;
  transition: filter 0.12s;
}
.add-btn:hover { filter: brightness(1.2); }
.add-btn--cancel { background: #666; margin-top: 10px; }

/* Transition */
.add-menu-enter-active, .add-menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.add-menu-enter-from, .add-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
