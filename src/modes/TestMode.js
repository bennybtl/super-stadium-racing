import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { DriveMode } from "./DriveMode.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";

/**
 * TestMode – lightweight free-drive for testing a track in the editor.
 *
 * No AI trucks, no countdown, no lap/checkpoint tracking.
 * ESC or the on-screen button returns straight to EditorMode.
 */
export class TestMode extends DriveMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this._backBtn = null;
    this.debugManager = null;
  }

  async setup({ trackKey, returnToEditor }) {
    const { engine } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      tireStackManager,
      flagManager,
    } = await this.buildDriveScene(trackKey);

    this.scene = scene;

    // Spawn just behind the start/finish checkpoint, facing forward
    const { startFinishCp: startCp } = this.getStartFinishInfo(currentTrack);

    const playerTruck = new Truck(scene, shadows);

    const spawn = this.getSpawnBehindCheckpoint(currentTrack, startCp, playerTruck.height, 6);
    const spawnPos = spawn.pos;
    const heading = spawn.heading;

    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    // Reset physics state to prevent gravity accumulation during async scene setup
    this.respawnTruck(playerTruck, spawnPos, heading);

    // Input — ESC goes straight back to editor
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => this._exitToEditor(returnToEditor));
    this.debugManager = new DebugManager();
    this.setupDebugToggle(inputManager, this.debugManager);
    inputManager.onReset(() => this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager));

    // Back button (top-left)
    this._createBackButton(returnToEditor);

    // Simple game loop
    const trucks = [{ truck: playerTruck }];
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);
    const outOfBoundsZones = this.getOutOfBoundsZones(currentTrack);
    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.05);
      const input = inputManager.getMovementInput();
      const debugInfo = playerTruck.update(input, dt, terrainManager, currentTrack);

      this.updateOutOfBoundsCountdown({
        truckId: 'player',
        truck: playerTruck,
        outOfBoundsZones,
        dt,
        durationSec: 5,
        onTimeout: () => {
          this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
        },
      });

      staticBodyCollisionManager.update(trucks);
      tireStackManager.update(trucks);
      flagManager.update(trucks, dt);
      cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt);
      this.debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck);
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
    super.teardown();
  }
}
