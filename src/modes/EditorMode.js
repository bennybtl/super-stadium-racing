import { VertexBuffer } from "@babylonjs/core";
import { EditorController } from "../editor/EditorController.js";
import { DebugManager } from "../managers/DebugManager.js";
import { buildScene } from "./SceneBuilder.js";
import { BaseMode } from "./BaseMode.js";
import {
  updateTerrainIdTexture,
  applySteepGrassTerrainRemap,
} from "../terrain-utils.js";

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
    this.debugManager = null;
    this._onEditorDebugKeyDown = null;
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
      specularTex,
      rebakeTerrainTexture,
      terrainIdTex,
      pixelsPerCell,
      compositeNormalMap,
      checkpointManager,
      wallManager,
      shadows,
      flagManager,
      obstacleManager,
      trackSignManager,
      bannerStringManager,
      bridgeManager,
      steepSlopeColliderManager,
      surfaceDecalManager,
    } = await buildScene(engine, trackLoader, trackKey);

    // // --- FAST FLAT COLOR TERRAIN FOR EDITOR ---
    // // Replace the complex terrain material with a simple StandardMaterial
    // // for much faster terrain rebuilds in editor mode.
    // const { StandardMaterial, Color3 } = await import("@babylonjs/core");
    // const editorGroundMat = new StandardMaterial("editorGroundMat", scene);
    // editorGroundMat.diffuseColor = new Color3(0.45, 0.45, 0.45); // Neutral gray
    // editorGroundMat.specularColor = new Color3(0.1, 0.1, 0.1);
    // ground.material = editorGroundMat;

    // Dispose runtime FlagManager flags – the EditorController's FlagTool
    // creates its own editor-mode flag meshes (without shadows/physics).
    // Keeping both sets causes duplicate meshes and breaks click-selection.
    flagManager.dispose();

    // Dispose runtime ObstacleManager stacks – the ObstacleEditor creates
    // its own pickable gizmo cylinders. The real Obstacle objects have
    // physics bodies and disc meshes that are pickable by default, which
    // intercept raycasts and make existing stacks impossible to select.
    obstacleManager.dispose();

    // Dispose runtime TrackSignManager signs for the same reason — the
    // TrackSignEditor creates its own copies that are tracked for selection.
    trackSignManager.dispose();

    // Dispose runtime BannerStringManager banners — BannerStringEditor creates its own.
    bannerStringManager.dispose();

    this.scene = scene;

    // -- Debug manager (collision geometry + panel in editor mode) --
    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    this._onEditorDebugKeyDown = (event) => {
      if (event.code !== 'Backslash' || event.repeat) return;
      debugManager.toggle();
      event.preventDefault();
    };
    window.addEventListener('keydown', this._onEditorDebugKeyDown);

    // -- Editor controller --
    const editorController = new EditorController(camera, scene);
    editorController.activate(currentTrack, checkpointManager, menuManager);
    editorController.setSurfaceDecalManager(surfaceDecalManager);
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
      steepSlopeColliderManager.rebuild();
    };

    // Fast: sync terrainManager.grid from track features (no canvas writes)
    window.rebuildTerrainGrid = () => {
      for (let row = 0; row < terrainManager.cellsPerSide; row++) {
        for (let col = 0; col < terrainManager.cellsPerSide; col++) {
          const worldX =
            (col - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
          const worldZ =
            (row - terrainManager.cellsPerSide / 2 + 0.5) * terrainManager.cellSize;
          terrainManager.grid[row * terrainManager.cellsPerSide + col] =
            currentTrack.getTerrainTypeAt(worldX, worldZ);
        }
      }
      applySteepGrassTerrainRemap(terrainManager, currentTrack);
    };

    // Rebuild terrain texture buffers from terrainManager.grid (call on deselect)
    const _rebuildTerrainTextureNow = () => {
      console.debug('[EditorMode] rebuildTerrainTexture: syncing grid...');
      window.rebuildTerrainGrid();
      console.debug('[EditorMode] rebuildTerrainTexture: updating id texture and re-baking...');
      updateTerrainIdTexture(terrainIdTex, terrainManager);
      rebakeTerrainTexture();
      window.rebuildNormalMap?.(true);
      console.debug('[EditorMode] rebuildTerrainTexture: done');
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
      await updateCompositeNormalMap(compositeNormalMap, scene, normalMapDecals, terrainManager, currentTrack, terrainManager.gridSize);
    };
    let _rebuildNormalMapTimer = null;
    window.rebuildNormalMap = (immediate = false) => {
      if (immediate) { clearTimeout(_rebuildNormalMapTimer); _rebuildNormalMapTimer = null; _rebuildNormalMapNow(); return; }
      clearTimeout(_rebuildNormalMapTimer);
      _rebuildNormalMapTimer = setTimeout(_rebuildNormalMapNow, 300);
    };

    // Rebuild hill water meshes so water level/position changes are visible immediately.
    window.rebuildHillWater = async () => {
      for (const mesh of scene.meshes.slice()) {
        if (mesh?.name?.startsWith('water_')) mesh.dispose();
      }
      const { createHill } = await import('../objects/Hill.js');
      for (const feature of currentTrack.features) {
        if (feature.type === 'hill' || feature.type === 'squareHill') {
          createHill(feature, currentTrack, scene);
        }
      }
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

    // Rebuild a specific polyCurb (or all polyCurbs if feature is null)
    window.rebuildPolyCurb = (targetFeature) => {
      wallManager._curbs = wallManager._curbs.filter(c => {
        if (c._feature && (targetFeature === null || c._feature === targetFeature)) {
          c.dispose?.();
          return false;
        }
        return true;
      });
      for (const f of currentTrack.features) {
        if (f.type === 'polyCurb') {
          if (targetFeature === null || f === targetFeature) {
            wallManager.createPolyCurb(f);
          }
        }
      }
    };

    // Rebuild a specific bridge (or all bridges if feature is null)
    window.rebuildBridge = (targetFeature = null) => {
      bridgeManager.rebuildBridge(targetFeature);
    };

    // Poly hills array to track created hills
    const polyHills = [];
    window.polyHills = polyHills; // exposed so PolyHillEditor can toggle mesh visibility

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
            // Restore visibility if this feature is the currently active hill
            if (hill.mesh && window.polyHillActiveFeature === f) {
              hill.mesh.isVisible = true;
            }
            polyHills.push(hill);
          }
        }
      }
      // Rebuild terrain mesh after height modifications
      window.rebuildTerrain?.();
    };

    // Hide racing HUD while in editor (it starts hidden; only UIManager.showRaceStatusPanel shows it)
    console.debug("[Editor] Track editor mode active");

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
      debugManager.updateCollisionDebugOnly();
    });

    return scene;
  }

  teardown() {
    if (this._onEditorDebugKeyDown) {
      window.removeEventListener('keydown', this._onEditorDebugKeyDown);
      this._onEditorDebugKeyDown = null;
    }
    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager = null;
    }
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
    delete window.rebuildHillWater;
    delete window.rebuildPolyWall;
    delete window.rebuildPolyHill;
    delete window.polyHills;
    delete window.polyHillActiveFeature;
    delete window.rebuildBezierWall;
    delete window.rebuildPolyCurb;
    delete window.quickTestTrack;

    // (race HUD visibility is managed by UIManager / Pinia — nothing to restore here)

    super.teardown();
  }
}
