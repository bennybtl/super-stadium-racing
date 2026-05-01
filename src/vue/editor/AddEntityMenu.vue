<template>
  <Transition name="add-menu">
    <div
      v-if="editor.addMenuOpen"
      class="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 pointer-events-auto"
      @mousedown.self="editor.closeAddMenu()"
    >
      <div class="w-[min(780px,90vw)] max-h-[90vh] overflow-y-auto rounded-[1rem] border-2 border-sky-500 bg-slate-950/95 p-6 shadow-xl shadow-black/40" @mousedown.stop>
        <h2 class="mb-5 text-center text-xl font-bold uppercase tracking-[0.22em] text-white">Add Feature</h2>

        <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="item in features"
            :key="item.label"
            class="flex flex-col items-center gap-3 rounded-2xl border-2 border-transparent bg-gradient-to-b from-slate-800 to-slate-900 px-2 py-2 text-white shadow-[0_3px_10px_rgba(0,0,0,0.4)] transition-all duration-150 hover:border-sky-500 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(74,158,255,0.25)]"
            @click="item.action(); editor.closeAddMenu()"
          >
            <img v-if="item.img" :src="item.img" :alt="item.label" class="h-[75px] w-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
            <div v-else class="h-[75px] w-full rounded-xl bg-white/5" />
            <span class="text-[11px] uppercase tracking-[0.05em] text-center text-white leading-5">{{ item.label }}</span>
          </button>
        </div>

        <button class="mt-4 w-full rounded-xl bg-slate-800 px-4 py-2 text-sm font-sans text-slate-200 transition hover:bg-slate-700" @click="editor.closeAddMenu()">
          Cancel
        </button>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { useEditorStore } from '../store.js';

import imgPolyWall    from '../assets/poly_wall.feature.png';
import imgPolyHill    from '../assets/poly_hill.feature.png';
import imgPolyCurb    from '../assets/poly_curb.feature.png';
import imgRoundHill   from '../assets/round_hill.feature.png';
import imgSquareHill  from '../assets/square_hill.feature.png';
import imgCheckpoint  from '../assets/checkpoint.feature.png';
import imgFlags       from '../assets/flags.feature.png';
import imgTrackSign   from '../assets/track_sign.feature.png';
import imgTerrain     from '../assets/terrain_region.feature.png';
import imgMeshGrid    from '../assets/mesh_grid.feature.png';
import imgObstacle    from '../assets/tire_stack.feature.png';
import imgActionZone  from '../assets/action_zone.feature.png';
import imgBridge      from '../assets/bridge.feature.png';
import imgAiPath      from '../assets/ai_path.feature.png';

// import imgNormalMap   from '../assets/normal_map_decal.feature.png';

const editor = useEditorStore();

const features = [
  { label: 'Checkpoint',       img: imgCheckpoint,    action: () => editor.addCheckpoint()     },
  { label: 'Poly Wall',        img: imgPolyWall,      action: () => editor.addPolyWall()       },
  { label: 'Poly Curb',        img: imgPolyCurb,      action: () => editor.addPolyCurb()       },
  { label: 'Round Hill',       img: imgRoundHill,     action: () => editor.addHill()           },
  { label: 'Square Hill',      img: imgSquareHill,    action: () => editor.addSquareHill()     },
  { label: 'Poly Hill',        img: imgPolyHill,      action: () => editor.addPolyHill()       },
  { label: 'Mesh Grid',        img: imgMeshGrid,      action: () => editor.addMeshGrid()       },
  { label: 'Terrain Region',   img: imgTerrain,       action: () => editor.addTerrain()        },
  { label: 'Obstacle',         img: imgObstacle,      action: () => editor.addObstacle()      },
  { label: 'Track Sign',       img: imgTrackSign,     action: () => editor.addTrackSign()      },
  { label: 'Decoration',       img: imgFlags,         action: () => editor.addDecoration()     },
  { label: 'Action Zone',      img: imgActionZone,     action: () => editor.addActionZone()     },
  { label: 'Bridge',           img: imgBridge,             action: () => editor.addBridge()         },
  { label: 'AI Path',          img: imgAiPath,             action: () => editor.openAiPath()              },
  { label: 'Terrain Path',     img: imgTerrain,            action: () => editor.addTerrainPath()          },
  { label: 'Surface Decal',   img: null,                  action: () => editor.openSurfaceDecalStamp()   },
];
</script>

<style scoped>
.add-menu-enter-active, .add-menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.add-menu-enter-from, .add-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
