import { Vector3 } from "@babylonjs/core";
import { createTruck, updateTruck } from "../truck.js";
import { InputManager } from "../managers/InputManager.js";
import { buildScene } from "./SceneBuilder.js";
import { TRUCK_HEIGHT } from "../constants.js";

/**
 * TestMode – lightweight free-drive for testing a track in the editor.
 *
 * No AI trucks, no countdown, no lap/checkpoint tracking.
 * ESC or the on-screen button returns straight to EditorMode.
 */
export class TestMode {
  constructor(controller) {
    this.controller = controller;
    this.scene = null;
    this.inputManager = null;
    this._backBtn = null;
  }

  async setup({ trackKey, returnToEditor }) {
    const { engine, trackLoader } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      wallManager,
      tireStackManager,
    } = await buildScene(engine, trackLoader, trackKey);

    this.scene = scene;

    // Spawn just behind the start/finish checkpoint, facing forward
    const checkpointFeatures = currentTrack.features.filter(
      f => f.type === 'checkpoint' && f.checkpointNumber != null
    );
    const maxNum = checkpointFeatures.reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    const startCp = checkpointFeatures.find(f => f.checkpointNumber === maxNum) || null;

    let spawnPos, heading;
    if (startCp) {
      const h = startCp.heading;
      const x = startCp.centerX + Math.sin(h) * -6;
      const z = startCp.centerZ + Math.cos(h) * -6;
      spawnPos = new Vector3(x, currentTrack.getHeightAt(x, z) + TRUCK_HEIGHT, z);
      heading = h;
    } else {
      spawnPos = new Vector3(0, TRUCK_HEIGHT, 0);
      heading = 0;
    }

    const playerTruck = createTruck(scene, shadows, null, null, spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    // Input — ESC goes straight back to editor
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => this._exitToEditor(returnToEditor));
    inputManager.onReset(() => {
      playerTruck.mesh.position.copyFrom(spawnPos);
      playerTruck.state.heading = heading;
      playerTruck.mesh.rotation.y = heading;
      playerTruck.state.velocity.setAll(0);
      playerTruck.state.verticalVelocity = 0;
    });

    // Back button (top-left)
    this._createBackButton(returnToEditor);

    // Simple game loop
    const trucks = [{ truck: playerTruck }];
    scene.onBeforeRenderObservable.add(() => {
      const dt = engine.getDeltaTime() / 1000;
      const input = inputManager.getMovementInput();
      wallManager.preUpdate(trucks, dt);
      updateTruck(playerTruck, input, dt, terrainManager, currentTrack);
      wallManager.update(trucks);
      tireStackManager.update(trucks);
      cameraController.update(playerTruck.mesh.position);
    });

    return scene;
  }

  _exitToEditor(trackKey) {
    this.controller.goToEditor({ trackKey });
  }

  _createBackButton(trackKey) {
    const btn = document.createElement('button');
    btn.textContent = '← Back to Editor';
    btn.style.cssText = `
      position: fixed; top: 16px; left: 16px;
      background: rgba(0,0,0,0.78); color: white;
      border: 1px solid #555; border-radius: 8px;
      padding: 8px 18px; font-size: 13px; font-family: Arial;
      cursor: pointer; z-index: 999;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
    `;
    btn.addEventListener('click', () => this._exitToEditor(trackKey));
    btn.addEventListener('mouseover', () => { btn.style.background = 'rgba(39,174,96,0.9)'; btn.style.borderColor = '#2ecc71'; });
    btn.addEventListener('mouseout',  () => { btn.style.background = 'rgba(0,0,0,0.78)';   btn.style.borderColor = '#555';    });
    document.body.appendChild(btn);
    this._backBtn = btn;
  }

  teardown() {
    if (this._backBtn) {
      this._backBtn.remove();
      this._backBtn = null;
    }
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
