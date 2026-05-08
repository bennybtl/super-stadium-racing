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
      obstacleManager,
      flagManager,
    } = await this.buildDriveScene(trackKey);

    this.scene = scene;
    const frameProfiler = this.initFrameProfiler('TestMode');

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
    let frameRenderStartMs = 0;

    scene.onAfterRenderObservable.add(() => {
      if (frameRenderStartMs > 0) {
        frameProfiler.addDuration('render.pipeline', performance.now() - frameRenderStartMs);
        frameRenderStartMs = 0;
      }
      frameProfiler.endFrame();
    });

    scene.onBeforeRenderObservable.add(() => {
      if (document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.05);
      frameProfiler.beginFrame(dt);
      const input = frameProfiler.measure('input', () => inputManager.getMovementInput());
      const debugInfo = frameProfiler.measure(
        'truck.update',
        () => playerTruck.update(input, dt, terrainManager, currentTrack, true, null, frameProfiler)
      );

      frameProfiler.measure('zones.oob', () => this.updateOutOfBoundsCountdown({
        truckId: 'player',
        truck: playerTruck,
        outOfBoundsZones,
        track: currentTrack,
        dt,
        durationSec: 5,
        onTimeout: () => {
          this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager);
        },
      }));

      frameProfiler.measure('collision.staticBodies', () => staticBodyCollisionManager.update(trucks));
      frameProfiler.measure('obstacles.update', () => obstacleManager.update(trucks));
      frameProfiler.measure('flags.update', () => flagManager.update(trucks, dt));
      frameProfiler.measure('camera.update', () => cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt));
      frameProfiler.measure('debug.update', () => this.debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck));
      frameRenderStartMs = performance.now();
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
