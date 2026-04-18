import { Vector3 } from "@babylonjs/core";
import { Truck } from "../truck/truck.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { buildScene } from "./SceneBuilder.js";
import { BaseMode } from "./BaseMode.js";

/**
 * PracticeMode – free-drive mode for testing and practice.
 *
 * No AI trucks, no countdown, no lap/checkpoint tracking.
 * Just select a track and drive around to test handling and physics.
 */
export class PracticeMode extends BaseMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
  }

  async setup({ trackKey, vehicleKey = 'default_truck' }) {
    const { engine, menuManager, trackLoader } = this.controller;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      tireStackManager,
      flagManager,
      pickupManager,
    } = await buildScene(engine, trackLoader, trackKey);
    // Note: Pickups are disabled by default via buildScene. We don't spawn them here.

    this.scene = scene;

    // Spawn just behind the start/finish checkpoint, facing forward
    const checkpointFeatures = currentTrack.features.filter(
      f => f.type === 'checkpoint' && f.checkpointNumber != null
    );
    const maxNum = checkpointFeatures.reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    const startCp = checkpointFeatures.find(f => f.checkpointNumber === maxNum) || null;

    // Create truck first so we can read its height when calculating spawnPos
    const vehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    const playerTruck = new Truck(scene, shadows, null, null, vehicleDef);

    let spawnPos, heading;
    if (startCp) {
      const h = startCp.heading;
      const x = startCp.centerX + Math.sin(h) * -6;
      const z = startCp.centerZ + Math.cos(h) * -6;
      spawnPos = new Vector3(x, currentTrack.getHeightAt(x, z) + playerTruck.height, z);
      heading = h;
    } else {
      spawnPos = new Vector3(0, playerTruck.height, 0);
      heading = 0;
    }

    playerTruck.mesh.position.copyFrom(spawnPos);
    playerTruck.state.heading = heading;
    playerTruck.mesh.rotation.y = heading;

    const trucks = [{ truck: playerTruck }];

    // Reset physics state to prevent gravity accumulation during async scene setup
    this.respawnTruck(playerTruck, spawnPos, heading);

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // Input — ESC opens pause menu
    const inputManager = new InputManager(playerTruck, cameraController);
    this.inputManager = inputManager;
    inputManager.onPause(() => menuManager.showPauseMenu());
    this.setupDebugToggle(inputManager, debugManager);
    inputManager.onReset(() => this.respawnTruck(playerTruck, spawnPos, heading, staticBodyCollisionManager));

    // Wire up pause callbacks
    menuManager.onResume = () => {
      menuManager.hideMenu();
    };

    menuManager.onReset = () => {
      inputManager.onResetCallback();
      menuManager.hideMenu();
    };

    menuManager.onExit = () => {
      this.controller.switchToMode('menu');
    };

    // Pre-filter 'slowZone' action zones for per-frame position checks
    const slowZones = currentTrack.features.filter(
      f => f.type === 'actionZone' && f.zoneType === 'slowZone'
    );

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);

    // Simple game loop
    scene.onBeforeRenderObservable.add(() => {
      if (menuManager.isPaused || document.hidden) return;

      const dt = this.getClampedDeltaTime(engine, 0.05);
      const input = inputManager.getMovementInput();

      const debugInfo = playerTruck.update(input, dt, terrainManager, currentTrack);

      // Clamp speed when inside a 'slowZone' action zone
      if (slowZones.length > 0) {
        const pos = playerTruck.mesh.position;
        const inSlow = slowZones.some(z => {
          const dx = pos.x - z.x, dz = pos.z - z.z;
          return (dx * dx + dz * dz) < z.radius * z.radius;
        });
        playerTruck.state.slowZoneActive = inSlow;
        if (inSlow) {
          const limit = playerTruck.state.slowZoneMaxSpeed;
          if (playerTruck.state.velocity.length() > limit) {
            playerTruck.state.velocity.normalize().scaleInPlace(limit);
          }
        }
      }

      staticBodyCollisionManager.update(trucks);
      tireStackManager.update(trucks, dt);
      flagManager.update(trucks, dt);
      pickupManager.update(trucks, dt);
      cameraController.update(playerTruck.mesh.position, playerTruck.state.heading, dt);
      
      debugManager.update(debugInfo, terrainManager, currentTrack, playerTruck);
    });

    return scene;
  }

  teardown() {
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager = null;
    }
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    super.teardown();
  }
}
