<template>
  <Transition name="add-menu">
    <div
      v-if="editor.addMenuOpen"
      class="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-auto"
      @mousedown.self="editor.closeAddMenu()"
    >
      <div 
        class="w-[min(780px,90vw)] max-h-[90vh] overflow-y-auto rounded-[1rem] p-4 shadow-xl shadow-black/80" 
        :style="panelStyle"
        @mousedown.stop>
        <h2 class="mb-5 text-center text-xl font-bold uppercase tracking-[0.22em] text-white">Add Feature</h2>

        <div class="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <button
            v-for="item in features"
            :key="item.label"
            class="max-w-[180px] p-2 rounded-xl transition border-2 border-transparent hover:border-amber-400"
            @click="item.action(); editor.closeAddMenu()"
          >
            <img v-if="item.img" :src="item.img" :alt="item.label" class="h-[75px] w-full object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]" />
            <div v-else class="h-[75px] w-full rounded-xl bg-white/5" />
            <span class="text-[11px] uppercase tracking-[0.05em] text-center text-white leading-5">{{ item.label }}</span>
          </button>
        </div>

        <button class="menu-button pointer-events-auto px-10 py-4 text-2xl w-full text-center" @click="editor.closeAddMenu()">
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
import imgDriveBox    from '../assets/drive_box.feature.png';
import imgAiPath      from '../assets/ai_path.feature.png';
import imgDecal       from '../assets/decals.feature.png';
import imgTerrainPath from '../assets/terrain_path.feature.png';

const editor = useEditorStore();

const features = [
  { label: 'Checkpoint',       img: imgCheckpoint,    action: () => editor.featureAction('addCheckpoint')           },
  { label: 'Poly Wall',        img: imgPolyWall,      action: () => editor.featureAction('addPolyWallEntity')       },
  { label: 'Poly Curb',        img: imgPolyCurb,      action: () => editor.featureAction('addPolyCurbEntity')       },
  { label: 'Round Hill',       img: imgRoundHill,     action: () => editor.featureAction('addHillEntity')           },
  { label: 'Square Hill',      img: imgSquareHill,    action: () => editor.featureAction('addSquareHillEntity')     },
  { label: 'Poly Hill',        img: imgPolyHill,      action: () => editor.featureAction('addPolyHillEntity')       },
  { label: 'Mesh Grid',        img: imgMeshGrid,      action: () => editor.featureAction('addMeshGridEntity')       },
  { label: 'Bridge Mesh',      img: imgBridge,        action: () => editor.featureAction('addBridgeMeshEntity')     },
  { label: 'Drive Box',        img: imgDriveBox,      action: () => editor.featureAction('addDriveBoxEntity')       },
  { label: 'Terrain Shape',   img: imgTerrain,       action: () => editor.featureAction('addTerrainEntity')         },
  { label: 'Obstacle',         img: imgObstacle,      action: () => editor.featureAction('addObstacleEntity')       },
  { label: 'Track Sign',       img: imgTrackSign,     action: () => editor.featureAction('addTrackSignEntity')      },
  { label: 'Decoration',       img: imgFlags,         action: () => editor.featureAction('addDecorationEntity')     },
  { label: 'Action Zone',      img: imgActionZone,    action: () => editor.featureAction('addActionZoneEntity')     },
  { label: 'AI Path',          img: imgAiPath,        action: () => editor.openAiPath()                             },
  { label: 'Terrain Path',     img: imgTerrainPath,       action: () => editor.featureAction('addTerrainPathEntity')},
  { label: 'Surface Decal',    img: imgDecal,         action: () => editor.featureAction('openSurfaceDecalStamp')   },
];

const panelStyle = {
  backgroundImage: `url(${new URL('../../assets/checker-black.png', import.meta.url).href})`,
  backgroundRepeat: 'repeat',
  backgroundSize: '220px 220px',
  backgroundColor: 'rgba(0,0,0,0.4)'
};

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
