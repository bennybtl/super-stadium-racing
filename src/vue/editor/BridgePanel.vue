<template>
  <EditorPanel
    v-if="editor.selectedType === 'bridge'"
    title="Bridge"
    @close="editor.closeBridge()"
  >
    <!-- Width -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Width</span>
      <span>{{ editor.bridge.width.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="60" step="0.5"
      :value="editor.bridge.width"
      @input="editor.setBridgeWidth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Depth -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Depth</span>
      <span>{{ editor.bridge.depth.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="2" max="30" step="0.5"
      :value="editor.bridge.depth"
      @input="editor.setBridgeDepth(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Height above terrain -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Height</span>
      <span>{{ editor.bridge.height.toFixed(1) }}</span>
    </div>
    <input
      type="range" min="0.5" max="20" step="0.25"
      :value="editor.bridge.height"
      @input="editor.setBridgeHeight(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Thickness -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Thickness</span>
      <span>{{ editor.bridge.thickness.toFixed(2) }}</span>
    </div>
    <input
      type="range" min="0.1" max="2.0" step="0.05"
      :value="editor.bridge.thickness"
      @input="editor.setBridgeThickness(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Angle -->
    <div class="flex justify-between mb-1 text-[12px]">
      <span>Angle</span>
      <span>{{ Math.round(editor.bridge.angle) }}°</span>
    </div>
    <input
      type="range" min="-180" max="180" step="1"
      :value="editor.bridge.angle"
      @input="editor.setBridgeAngle(+$event.target.value)"
      class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
    />

    <!-- Surface Material -->
    <div class="text-[12px] mb-1">Surface</div>
    <select
      class="w-full px-2 py-1 bg-slate-800 text-white border border-slate-700 rounded text-[12px] mb-3"
      :value="editor.bridge.materialType"
      @change="editor.setBridgeMaterialType($event.target.value)"
    >
      <option value="packed_dirt">Packed Dirt</option>
      <option value="loose_dirt">Loose Dirt</option>
      <option value="asphalt">Asphalt</option>
      <option value="mud">Mud</option>
      <option value="water">Water</option>
      <option value="rocky">Rocky</option>
      <option value="grass">Grass</option>
    </select>

    <!-- Bridge transitions -->
    <div class="flex justify-between mb-1 text-[12px]">
      <label class="flex items-center gap-2">
        <span>Enable Transitions</span>
        <input
          type="checkbox"
          :checked="editor.bridge.transitionEnabled"
          @change="editor.setBridgeTransitionEnabled($event.target.checked)"
        />
      </label>
    </div>

    <template v-if="editor.bridge.transitionEnabled">
      <div class="flex justify-between mb-1 text-[12px]">
        <span>Transition Depth</span>
        <span>{{ editor.bridge.transitionDepth.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="4" max="30" step="0.5"
        :value="editor.bridge.transitionDepth"
        @input="editor.setBridgeTransitionDepth(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />
    </template>

    <div class="text-[10px] text-slate-400 mb-3">Collision end caps</div>
    <div class="flex justify-between mb-1 text-[12px]">
      <label class="flex items-center gap-2">
        <span>Enable End Caps</span>
        <input
          type="checkbox"
          :checked="editor.bridge.collisionEndCaps"
          @change="editor.setBridgeCollisionEndCaps($event.target.checked)"
        />
      </label>
    </div>

    <template v-if="editor.bridge.collisionEndCaps">
      <div class="flex justify-between mb-1 text-[12px]">
        <label class="flex items-center gap-2">
          <span>Caps On Depth Ends</span>
          <input
            type="checkbox"
            :checked="editor.bridge.collisionEndCapsOnDepth"
            @change="editor.setBridgeCollisionEndCapsOnDepth($event.target.checked)"
          />
        </label>
      </div>
      <div class="flex justify-between mb-1 text-[12px]">
        <label class="flex items-center gap-2">
          <span>Caps On Width Sides</span>
          <input
            type="checkbox"
            :checked="editor.bridge.collisionEndCapsOnWidth"
            @change="editor.setBridgeCollisionEndCapsOnWidth($event.target.checked)"
          />
        </label>
      </div>
      <div class="flex justify-between mb-1 text-[12px]">
        <span>End Cap Thickness</span>
        <span>{{ editor.bridge.collisionEndCapThickness.toFixed(2) }}</span>
      </div>
      <input
        type="range" min="0.5" max="6.0" step="0.5"
        :value="editor.bridge.collisionEndCapThickness"
        @input="editor.setBridgeCollisionEndCapThickness(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

      <div class="flex justify-between mb-1 text-[12px]">
        <span>End Cap Drop</span>
        <span>{{ editor.bridge.collisionEndCapDrop.toFixed(1) }}</span>
      </div>
      <input
        type="range" min="2" max="80" step="2"
        :value="editor.bridge.collisionEndCapDrop"
        @input="editor.setBridgeCollisionEndCapDrop(+$event.target.value)"
        class="w-full accent-[var(--accent)] mb-3 cursor-pointer"
      />

    </template>

    <!-- Hint -->
    <div class="text-[10px] text-slate-400 mb-3">WASD to move · Q/E to rotate · Del to delete</div>

    <!-- Actions -->
    <button class="w-full rounded-md bg-sky-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-sky-500" @click="editor.duplicateBridge()">Duplicate Bridge</button>
    <button class="w-full rounded-md bg-rose-600 text-white py-2 text-[13px] font-sans mb-2 hover:bg-rose-500" @click="editor.deleteBridge()">Delete Bridge</button>
  </EditorPanel>
</template>

<script setup>
import { useEditorStore } from '../store.js';
import EditorPanel from './EditorPanel.vue';

const editor = useEditorStore();
</script>
