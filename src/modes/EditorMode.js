import { VertexBuffer } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { EditorController } from "../editor/EditorController.js";
import { buildScene } from "./SceneBuilder.js";
import { BaseMode } from "./BaseMode.js";
import { paintTerrainTexture } from "../terrain-utils.js";

/**
 * EditorMode – track editing interface.
 *
 * Builds a scene via SceneBuilder (ground, walls, checkpoints visible for
 * editing), activates EditorController for camera/tool interaction, and
 * exposes terrain-rebuild helpers on `window` for editor tools to call.
 */
export class EditorMode extends BaseMode {
  constructor(controller) {
    super(controller);
    this.editorController = null;
  }

  async setup({ trackKey }) {
    const { engine, menuManager, trackLoader } = this.controller;

    const {
      scene,
      camera,
      currentTrack,
      terrainManager,
      ground,
      groundTex,
      pixelsPerCell,
      compositeNormalMap,
      checkpointManager,
      wallManager,
      shadows,
      flagManager,
    } = await buildScene(engine, trackLoader, trackKey);

    // Dispose runtime FlagManager flags – the EditorController's FlagTool
    // creates its own editor-mode flag meshes (without shadows/physics).
    // Keeping both sets causes duplicate meshes and breaks click-selection.
    flagManager.dispose();

    this.scene = scene;

    // -- Editor controller --
    const editorController = new EditorController(camera, scene);
    editorController.activate(currentTrack, checkpointManager, menuManager);
    this.editorController = editorController;

    // -- Editor globals (used by editor tool UI) --
    window.currentEditorTrack = currentTrack;
    window.currentEditorScene = scene;

    window.rebuildTerrain = () => {
      const positions = ground.getVerticesData(VertexBuffer.PositionKind);
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        positions[i + 1] = currentTrack.getHeightAt(x, z);
      }
      ground.setVerticesData(VertexBuffer.PositionKind, positions);
      ground.createNormals(true);
    };

    // Fast: sync terrainManager.grid from track features (no canvas writes)
    window.rebuildTerrainGrid = () => {
      for (let row = 0; row < terrainManager.cellsPerSide; row++) {
        for (let col = 0; col < terrainManager.cellsPerSide; col++) {
          const worldX =
            (col - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
          const worldZ =
            (row - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
          const terrainType = currentTrack.getTerrainTypeAt(worldX, worldZ);
          terrainManager.grid[row * terrainManager.cellsPerSide + col] =
            terrainType || TERRAIN_TYPES.PACKED_DIRT;
        }
      }
    };

    // Slow: paint the canvas texture from terrainManager.grid (call on deselect)
    const _rebuildTerrainTextureNow = () => {
      window.rebuildTerrainGrid();
      const ctx = groundTex.getContext();
      paintTerrainTexture(ctx, terrainManager, pixelsPerCell);
      groundTex.update();
    };
    let _rebuildTerrainTimer = null;
    window.rebuildTerrainTexture = (immediate = false) => {
      if (immediate) { clearTimeout(_rebuildTerrainTimer); _rebuildTerrainTimer = null; _rebuildTerrainTextureNow(); return; }
      clearTimeout(_rebuildTerrainTimer);
      _rebuildTerrainTimer = setTimeout(_rebuildTerrainTextureNow, 300);
    };

    // Rebuild composite normal map from normal map decal features
    const _rebuildNormalMapNow = async () => {
      const normalMapDecals = currentTrack.features.filter(f => f.type === 'normalMapDecal');
      const { updateCompositeNormalMap } = await import('../shaders/ground-shader.js');
      await updateCompositeNormalMap(compositeNormalMap, scene, normalMapDecals, terrainManager, 160);
    };
    let _rebuildNormalMapTimer = null;
    window.rebuildNormalMap = (immediate = false) => {
      if (immediate) { clearTimeout(_rebuildNormalMapTimer); _rebuildNormalMapTimer = null; _rebuildNormalMapNow(); return; }
      clearTimeout(_rebuildNormalMapTimer);
      _rebuildNormalMapTimer = setTimeout(_rebuildNormalMapNow, 300);
    };

    // Rebuild a specific polyWall (or all polyWalls if feature is null)
    window.rebuildPolyWall = (targetFeature) => {
      wallManager._walls = wallManager._walls.filter(w => {
        if (w._feature && (targetFeature === null || w._feature === targetFeature)) {
          w.dispose?.();
          return false;
        }
        return true;
      });
      for (const f of currentTrack.features) {
        if (f.type === 'polyWall') {
          if (targetFeature === null || f === targetFeature) {
            wallManager.createPolyWall(f);
          }
        }
      }
    };

    // Rebuild a specific bezierWall (or all bezierWalls if feature is null)
    window.rebuildBezierWall = (targetFeature) => {
      wallManager._walls = wallManager._walls.filter(w => {
        if (w._feature && (targetFeature === null || w._feature === targetFeature)) {
          w.dispose?.();
          return false;
        }
        return true;
      });
      for (const f of currentTrack.features) {
        if (f.type === 'bezierWall') {
          if (targetFeature === null || f === targetFeature) {
            wallManager.createBezierWall(f);
          }
        }
      }
    };

    // Poly hills array to track created hills
    const polyHills = [];

    // Rebuild a specific polyHill (or all polyHills if feature is null)
    window.rebuildPolyHill = async (targetFeature) => {
      // Remove hills that match the target feature
      for (let i = polyHills.length - 1; i >= 0; i--) {
        const hill = polyHills[i];
        if (hill._feature && (targetFeature === null || hill._feature === targetFeature)) {
          hill.dispose?.();
          polyHills.splice(i, 1);
        }
      }
      // Create new hills for matching features
      const { PolyHill } = await import('../objects/PolyHill.js');
      for (const f of currentTrack.features) {
        if (f.type === 'polyHill') {
          if (targetFeature === null || f === targetFeature) {
            const hill = new PolyHill(f, currentTrack, scene, shadows);
            polyHills.push(hill);
          }
        }
      }
      // Rebuild terrain mesh after height modifications
      window.rebuildTerrain?.();
    };

    // Hide racing HUD while in editor (it starts hidden; only UIManager.showRaceStatusPanel shows it)

    console.log("[Editor] Track editor mode active");

    // -- Menu callbacks --
    menuManager.onEditorResume = () => menuManager.hideMenu();

    menuManager.onEditorSave = () => {
      if (window.currentEditorTrack) {
        trackLoader.downloadTrack(window.currentEditorTrack);
        trackLoader.saveTrackToStorage(
          menuManager.selectedTrack || "custom",
          window.currentEditorTrack
        );
      }
      menuManager.hideMenu();
    };

    menuManager.onEditorExit = () => {
      menuManager.editorMode = false;
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };

    // Quick-test: hot-swap live track into loader, then switch to race for 1 lap.
    // RaceMode will return here when the player exits.
    window.quickTestTrack = () => {
      const testKey = '__quicktest__';
      trackLoader.tracks.set(testKey, currentTrack);
      this.controller.goToTest({ trackKey: testKey, returnToEditor: trackKey });
    };

    // -- Game loop --
    scene.onBeforeRenderObservable.add(() => {
      if (menuManager.isMenuActive() || document.hidden) return;
      const dt = engine.getDeltaTime() / 1000;
      editorController.update(dt);
    });

    return scene;
  }

  teardown() {
    if (this.editorController) {
      this.editorController.dispose?.();
      this.editorController = null;
    }

    // Clean up editor globals
    delete window.currentEditorTrack;
    delete window.currentEditorScene;
    delete window.rebuildTerrain;
    delete window.rebuildTerrainTexture;
    delete window.rebuildNormalMap;
    delete window.rebuildPolyWall;
    delete window.rebuildPolyHill;
    delete window.rebuildBezierWall;
    delete window.quickTestTrack;

    // (race HUD visibility is managed by UIManager / Pinia — nothing to restore here)

    super.teardown();
  }
}
