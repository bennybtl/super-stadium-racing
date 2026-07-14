import { VertexBuffer } from "@babylonjs/core";
import { EditorController } from "../editor/EditorController.js";
import { DebugManager } from "../managers/DebugManager.js";
import { buildScene } from "./SceneBuilder.js";
import { BaseMode } from "./BaseMode.js";
import rebuild, { reset as resetRebuild } from "../editor/editor-rebuild.js";
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
    this._clearSlopeColliderTimer = null;
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
      bridgeMeshManager,
      steepSlopeColliderManager,
      surfaceDecalManager,
    } = await buildScene(engine, trackLoader, trackKey);

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
    rebuild.currentTrack = currentTrack;
    rebuild.currentScene = scene;

    // Steep-slope colliders are consumed only by physics/collision, which does
    // not run in the editor. Rebuilding them (thousands of getHeightAt samples +
    // mesh churn) on every slider tick is wasted work, so debounce them off the
    // drag; the fresh race/test scene rebuilds its own colliders regardless.
    let _slopeColliderTimer = null;
    this._clearSlopeColliderTimer = () => { clearTimeout(_slopeColliderTimer); _slopeColliderTimer = null; };
    const rebuildSlopeCollidersDebounced = () => {
      clearTimeout(_slopeColliderTimer);
      _slopeColliderTimer = setTimeout(() => {
        _slopeColliderTimer = null;
        steepSlopeColliderManager.rebuild();
      }, 300);
    };

    // Dirty-region terrain updates: when the caller names the one feature that
    // changed, only vertices inside the union of its bounds at the previous
    // rebuild and now are re-queried (a slider drag touches a local patch, not
    // all ~4k vertices). The first rebuild for a feature is always full — we
    // have no record of where it reached before the mutation — which also
    // makes stale recorded bounds after undo/paste/load harmless.
    const _lastPatchBounds = new WeakMap();
    rebuild.terrain = (dirtyFeature = null) => {
      let region = null;
      if (dirtyFeature) {
        const bounds = currentTrack.getFeatureHeightBounds(dirtyFeature);
        const prev = _lastPatchBounds.get(dirtyFeature);
        if (bounds) _lastPatchBounds.set(dirtyFeature, bounds);
        if (bounds && prev) {
          region = {
            minX: Math.min(prev.minX, bounds.minX),
            maxX: Math.max(prev.maxX, bounds.maxX),
            minZ: Math.min(prev.minZ, bounds.minZ),
            maxZ: Math.max(prev.maxZ, bounds.maxZ),
          };
        }
      }
      const positions = ground.getVerticesData(VertexBuffer.PositionKind);
      for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        if (region && (x < region.minX || x > region.maxX ||
                       z < region.minZ || z > region.maxZ)) continue;
        positions[i + 1] = currentTrack.getHeightAt(x, z);
      }
      ground.setVerticesData(VertexBuffer.PositionKind, positions);
      ground.createNormals(true);
      rebuildSlopeCollidersDebounced();
    };

    // Fast: sync terrainManager.grid from track features (no canvas writes)
    rebuild.terrainGrid = () => {
      const worldWidth = terrainManager.worldWidth ?? terrainManager.gridSize;
      const worldDepth = terrainManager.worldDepth ?? terrainManager.gridSize;
      for (let row = 0; row < terrainManager.cellsPerSide; row++) {
        for (let col = 0; col < terrainManager.cellsPerSide; col++) {
          const worldX = ((col + 0.5) / terrainManager.cellsPerSide) * worldWidth - worldWidth / 2;
          const worldZ = ((row + 0.5) / terrainManager.cellsPerSide) * worldDepth - worldDepth / 2;
          terrainManager.grid[row * terrainManager.cellsPerSide + col] =
            currentTrack.getTerrainTypeAt(worldX, worldZ);
        }
      }
      applySteepGrassTerrainRemap(terrainManager, currentTrack);
    };

    // Rebuild terrain texture buffers from terrainManager.grid (call on deselect).
    // Callers that know their edit can't affect a pass may opt out of it via
    // `opts` — e.g. terrain-type edits skip the (expensive, type-independent)
    // wear bake, and aiPath/wear edits skip the grid/overlay resync. Flags from
    // calls that land in the same debounce window are unioned, so a broader
    // request is never dropped by a narrower one.
    const _pendingTexFlags = { grid: false, wear: false, overlays: false, normals: false };
    const _rebuildTerrainTextureNow = () => {
      const flags = { ..._pendingTexFlags };
      _pendingTexFlags.grid = _pendingTexFlags.wear = _pendingTexFlags.overlays = _pendingTexFlags.normals = false;
      console.debug('[EditorMode] rebuildTerrainTexture: re-baking...', flags);
      if (flags.grid) {
        rebuild.terrainGrid();
        updateTerrainIdTexture(terrainIdTex, terrainManager);
      }
      rebakeTerrainTexture({ wear: flags.wear, overlays: flags.overlays });
      if (flags.normals) rebuild.normalMap?.(true);
      console.debug('[EditorMode] rebuildTerrainTexture: done');
    };
    let _rebuildTerrainTimer = null;
    rebuild.terrainTexture = (immediate = false, opts = null) => {
      _pendingTexFlags.grid ||= opts?.grid ?? true;
      _pendingTexFlags.wear ||= opts?.wear ?? true;
      _pendingTexFlags.overlays ||= opts?.overlays ?? true;
      _pendingTexFlags.normals ||= opts?.normals ?? true;
      if (immediate) { clearTimeout(_rebuildTerrainTimer); _rebuildTerrainTimer = null; _rebuildTerrainTextureNow(); return; }
      clearTimeout(_rebuildTerrainTimer);
      _rebuildTerrainTimer = setTimeout(_rebuildTerrainTextureNow, 300);
    };

    // Rebuild composite normal map from normal map decal features
    const _rebuildNormalMapNow = async () => {
      const normalMapDecals = currentTrack.features.filter(f => f.type === 'normalMapDecal');
      const { updateCompositeNormalMap } = await import('../shaders/ground-shader.js');
      const worldWidth = terrainManager.worldWidth ?? terrainManager.gridSize;
      const worldDepth = terrainManager.worldDepth ?? terrainManager.gridSize;
      await updateCompositeNormalMap(compositeNormalMap, scene, normalMapDecals, terrainManager, currentTrack, worldWidth, worldDepth);
    };
    let _rebuildNormalMapTimer = null;
    rebuild.normalMap = (immediate = false) => {
      if (immediate) { clearTimeout(_rebuildNormalMapTimer); _rebuildNormalMapTimer = null; _rebuildNormalMapNow(); return; }
      clearTimeout(_rebuildNormalMapTimer);
      _rebuildNormalMapTimer = setTimeout(_rebuildNormalMapNow, 300);
    };

    // Rebuild hill water meshes so water level/position changes are visible
    // immediately. Pass a feature to rebuild only that one's water (much cheaper
    // on tracks with many water features); omit it to rebuild all of them.
    rebuild.hillWater = async (targetFeature = null) => {
      for (const mesh of scene.meshes.slice()) {
        if (!mesh?.name?.startsWith('water_')) continue;
        if (targetFeature === null || mesh._sourceFeature === targetFeature) mesh.dispose();
      }
      const { createHill } = await import('../objects/Hill.js');
      for (const feature of currentTrack.features) {
        if (feature.type !== 'hill' && feature.type !== 'squareHill' && feature.type !== 'polyHill') continue;
        if (targetFeature !== null && feature !== targetFeature) continue;
        createHill(feature, currentTrack, scene);
      }
    };

    // Rebuild a specific polyWall (or all polyWalls if feature is null)
    rebuild.polyWall = (targetFeature) => {
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

    // Rebuild a specific polyCurb (or all polyCurbs if feature is null)
    rebuild.polyCurb = (targetFeature) => {
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

    // Rebuild a specific bridgeMesh (or all bridgeMesh features if null)
    rebuild.bridgeMesh = (targetFeature = null) => {
      bridgeMeshManager.rebuild(currentTrack.features, targetFeature);
    };

    // Rebuild a specific polyHill (or all polyHills if feature is null)
    rebuild.polyHill = (targetFeature = null) => {
      // PolyHill preview ribbon is disabled in editor mode.
      // Rebuild terrain mesh after height modifications
      rebuild.terrain?.(targetFeature);
    };

    // Hide racing HUD while in editor (it starts hidden; only UIManager.showRaceStatusPanel shows it)
    console.debug("[Editor] Track editor mode active");

    // -- Menu callbacks --
    menuManager.onEditorResume = () => menuManager.hideMenu();

    menuManager.onEditorSave = () => {
      if (rebuild.currentTrack) {
        trackLoader.downloadTrack(rebuild.currentTrack);
        const saveKey = (menuManager.selectedTrack && menuManager.selectedTrack !== 'new')
          ? menuManager.selectedTrack
          : rebuild.currentTrack.id || 'custom';
        trackLoader.saveTrackToStorage(saveKey, rebuild.currentTrack);
        menuManager.selectedTrack = saveKey;
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
    rebuild.quickTestTrack = () => {
      const testKey = '__quicktest__';
      trackLoader.tracks.set(testKey, currentTrack);
      this.controller.goToTest({ trackKey: testKey, returnToEditor: trackKey });
    };

    rebuild.editorScene = () => {
      const liveKey = '__editor_live__';
      trackLoader.tracks.set(liveKey, currentTrack);
      this.controller.goToEditor({ trackKey: liveKey, originalTrackKey: trackKey });
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
    // Cancel any pending deferred steep-slope collider rebuild so it can't fire
    // against the scene being disposed.
    this._clearSlopeColliderTimer?.();
    this._clearSlopeColliderTimer = null;
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

    resetRebuild();

    // (race HUD visibility is managed by UIManager / Pinia — nothing to restore here)

    super.teardown();
  }
}
