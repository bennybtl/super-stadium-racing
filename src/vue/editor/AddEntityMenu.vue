<template>
  <Transition name="add-menu">
    <div
      v-if="editor.addMenuOpen"
      class="add-menu-backdrop"
      @mousedown.self="editor.closeAddMenu()"
    >
      <div class="add-menu" @mousedown.stop>
        <h2 class="add-menu-title">Add Feature</h2>

        <div class="feature-grid">
          <button
            v-for="item in features"
            :key="item.label"
            class="feature-btn"
            @click="item.action(); editor.closeAddMenu()"
          >
            <img v-if="item.img" :src="item.img" :alt="item.label" class="feature-img" />
            <div v-else class="feature-img feature-img--placeholder" />
            <span class="feature-name">{{ item.label }}</span>
          </button>
        </div>

        <button class="cancel-btn" @click="editor.closeAddMenu()">Cancel</button>
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
import imgFlagString  from '../assets/flag_string.feature.png';
import imgTerrain     from '../assets/terrain_region.feature.png';
import imgMeshGrid    from '../assets/mesh_grid.feature.png';
// import imgBezierWall  from '../assets/bezier_wall.feature.png';
import imgTireStack   from '../assets/tire_stack.feature.png';
// import imgActionZone  from '../assets/action_zone.feature.png';
// import imgNormalMap   from '../assets/normal_map_decal.feature.png';

const editor = useEditorStore();

const features = [
  { label: 'Checkpoint',       img: imgCheckpoint,    action: () => editor.addCheckpoint()     },
  { label: 'Poly Wall',        img: imgPolyWall,      action: () => editor.addPolyWall()       },
  // { label: 'Bezier Wall',      img: imgBezierWall,    action: () => editor.addBezierWall()     },
  { label: 'Poly Curb',        img: imgPolyCurb,      action: () => editor.addPolyCurb()       },
  { label: 'Round Hill',       img: imgRoundHill,     action: () => editor.addHill()           },
  { label: 'Square Hill',      img: imgSquareHill,    action: () => editor.addSquareHill()     },
  { label: 'Poly Hill',        img: imgPolyHill,      action: () => editor.addPolyHill()       },
  { label: 'Mesh Grid',        img: imgMeshGrid,      action: () => editor.addMeshGrid()       },
  { label: 'Terrain Region',   img: imgTerrain,       action: () => editor.addTerrain()        },
  { label: 'Normal Map Decal', img: 'imgNormalMap',     action: () => editor.addNormalMapDecal() },
  { label: 'Tire Stack',       img: imgTireStack,     action: () => editor.addTireStack()      },
  { label: 'Track Sign',       img: imgTrackSign,     action: () => editor.addTrackSign()      },
  { label: 'Flag',             img: imgFlags,         action: () => editor.addFlag()           },
  { label: 'Banner String',    img: imgFlagString,    action: () => editor.addBannerString()   },
  { label: 'Action Zone',      img: 'imgActionZone',  action: () => editor.addActionZone()     },
];
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
  border-radius: 12px;
  padding: 24px;
  max-height: 90vh;
  overflow-y: auto;
  max-width: 780px;
  width: 90vw;
}

.add-menu-title {
  color: white;
  margin: 0 0 18px 0;
  font-family: Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  letter-spacing: 1px;
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.feature-btn {
  background: linear-gradient(to bottom, #2a3a55, #1a2535);
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 12px 8px 10px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transition: all 0.15s ease;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
}

.feature-btn:hover {
  background: linear-gradient(to bottom, #3a4e70, #263450);
  border-color: #4a9eff;
  transform: translateY(-3px);
  box-shadow: 0 6px 18px rgba(74, 158, 255, 0.25);
}

.feature-img {
  width: 150px;
  height: 75px;
  object-fit: contain;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}
.feature-img--placeholder {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 6px;
}

.feature-name {
  color: white;
  font-size: 11px;
  font-family: Arial, sans-serif;
  text-align: center;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  line-height: 1.3;
}

.cancel-btn {
  display: block;
  width: 100%;
  padding: 10px;
  margin-top: 4px;
  background: #444;
  color: #ccc;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  font-size: 14px;
  font-family: Arial, sans-serif;
  transition: background 0.12s;
}
.cancel-btn:hover { background: #555; }

/* Transition */
.add-menu-enter-active, .add-menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.add-menu-enter-from, .add-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
