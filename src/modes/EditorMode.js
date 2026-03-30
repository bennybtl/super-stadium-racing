import { VertexBuffer } from "@babylonjs/core";
import { TERRAIN_TYPES } from "../terrain.js";
import { EditorController } from "../managers/EditorController.js";
import { buildScene } from "./SceneBuilder.js";

/**
 * EditorMode – track editing interface.
 *
 * Builds a scene via SceneBuilder (ground, walls, checkpoints visible for
 * editing), activates EditorController for camera/tool interaction, and
 * exposes terrain-rebuild helpers on `window` for editor tools to call.
 */
export class EditorMode {
  constructor(controller) {
    this.controller = controller;
    this.scene = null;
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
      checkpointManager,
    } = await buildScene(engine, trackLoader, trackKey);

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
    window.rebuildTerrainTexture = () => {
      window.rebuildTerrainGrid();
      const ctx = groundTex.getContext();
      for (let row = 0; row < terrainManager.cellsPerSide; row++) {
        for (let col = 0; col < terrainManager.cellsPerSide; col++) {
          const index = row * terrainManager.cellsPerSide + col;
          const color = terrainManager.grid[index].color;
          const baseR = Math.floor(color.r * 255);
          const baseG = Math.floor(color.g * 255);
          const baseB = Math.floor(color.b * 255);
          const px = Math.ceil(pixelsPerCell);
          const x0 = Math.floor(col * pixelsPerCell);
          const y0 = Math.floor(row * pixelsPerCell);
          for (let py = 0; py < px; py++) {
            for (let pxx = 0; pxx < px; pxx++) {
              const n = (Math.random() - 0.5) * 18;
              const r = Math.max(0, Math.min(255, baseR + n));
              const g = Math.max(0, Math.min(255, baseG + n * 0.9));
              const b = Math.max(0, Math.min(255, baseB + n * 0.8));
              ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
              ctx.fillRect(x0 + pxx, y0 + py, 1, 1);
            }
          }
        }
      }
      groundTex.update();
    };

    // Hide racing HUD elements while in editor
    document.getElementById("checkpoint-display").style.display = "none";
    document.getElementById("lap-display").style.display = "none";
    document.getElementById("boost-display").style.display = "none";

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
      if (menuManager.isMenuActive()) return;
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
    delete window.quickTestTrack;

    // Restore racing HUD
    document.getElementById("checkpoint-display").style.display = "";
    document.getElementById("lap-display").style.display = "";
    document.getElementById("boost-display").style.display = "";

    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
