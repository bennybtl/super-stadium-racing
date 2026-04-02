import { Vector3, Color3 } from "@babylonjs/core";
import { AIDriver } from "../ai/AIDriver.js";
import { createTruck, updateTruck } from "../truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { CheckpointArrow } from "../managers/CheckpointArrow.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { buildScene } from "./SceneBuilder.js";
import { TRUCK_HEIGHT, TRUCK_HALF_HEIGHT } from "../constants.js";

/**
 * RaceMode – full racing gameplay.
 *
 * Owns the Babylon scene, truck(s), input, UI, checkpoint/lap tracking
 * and the game loop. Delegates scene construction to SceneBuilder.
 */
export class RaceMode {
  constructor(controller) {
    this.controller = controller;
    this.scene = null;
    this.inputManager = null;
    this._countdownTimeouts = [];
  }

  async setup({ trackKey, laps }) {
    const { engine, menuManager, trackLoader } = this.controller;
    const totalLaps = laps || 3;

    const {
      scene,
      cameraController,
      shadows,
      currentTrack,
      terrainManager,
      checkpointManager,
      wallManager,
      tireStackManager,
    } = await buildScene(engine, trackLoader, trackKey);

    this.scene = scene;

    // -- Starting grid (based on the last/finish checkpoint) --
    const checkpointFeatures = currentTrack.features.filter(
      f => f.type === 'checkpoint' && f.checkpointNumber != null
    );
    const maxCheckpointNumber = checkpointFeatures.reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    const startFinishCp = checkpointFeatures.find(f => f.checkpointNumber === maxCheckpointNumber) || null;

    const getGridSpawn = (index) => {
      if (!startFinishCp) {
        const x = (index % 2) * 3, z = Math.floor(index / 2) * 3;
        return { pos: new Vector3(x, currentTrack.getHeightAt(x, z) + TRUCK_HALF_HEIGHT, z), heading: 0 };
      }
      const h = startFinishCp.heading;
      const fwdX = Math.sin(h), fwdZ = Math.cos(h);
      const rightX = Math.cos(h), rightZ = -Math.sin(h);
      const col = index % 2, row = Math.floor(index / 2);
      const lateralSign = col === 0 ? -1 : 1;
      const x = startFinishCp.centerX + rightX * (lateralSign * 2) + fwdX * -(3 + row * 7);
      const z = startFinishCp.centerZ + rightZ * (lateralSign * 2) + fwdZ * -(3 + row * 7);
      return { pos: new Vector3(x, currentTrack.getHeightAt(x, z) + TRUCK_HALF_HEIGHT, z), heading: h };
    };

    // -- Race state --
    let raceStarted = false;
    let raceStartTime = null;
    let lapStartTime = null;
    let countdownActive = false;

    // -- Trucks --
    const aiDriver1 = new AIDriver(currentTrack, checkpointManager, wallManager, scene);
    const aiDriver2 = new AIDriver(currentTrack, checkpointManager, wallManager, scene);
    const aiDriver3 = new AIDriver(currentTrack, checkpointManager, wallManager, scene);

    const spawn0 = getGridSpawn(0);
    const spawn1 = getGridSpawn(1);
    const spawn2 = getGridSpawn(2);
    const spawn3 = getGridSpawn(3);

    const playerTruck = createTruck(scene, shadows, null, null, spawn0.pos);
    playerTruck.state.heading = spawn0.heading;
    playerTruck.mesh.rotation.y = spawn0.heading;

    const aiTruck1 = createTruck(scene, shadows, new Color3(0.2, 0.2, 0.8), aiDriver1);
    aiTruck1.mesh.position.copyFrom(spawn1.pos);
    aiTruck1.state.heading = spawn1.heading;
    aiTruck1.mesh.rotation.y = spawn1.heading;

    const aiTruck2 = createTruck(scene, shadows, new Color3(0.9, 0.9, 0.9), aiDriver2);
    aiTruck2.mesh.position.copyFrom(spawn2.pos);
    aiTruck2.state.heading = spawn2.heading;
    aiTruck2.mesh.rotation.y = spawn2.heading;

    const aiTruck3 = createTruck(scene, shadows, new Color3(0.5, 0.5, 0.5), aiDriver3);
    aiTruck3.mesh.position.copyFrom(spawn3.pos);
    aiTruck3.state.heading = spawn3.heading;
    aiTruck3.mesh.rotation.y = spawn3.heading;

    // Set truck reference for AI respawn capability
    aiDriver1.setTruck(aiTruck1);
    aiDriver2.setTruck(aiTruck2);
    aiDriver3.setTruck(aiTruck3);

    // Re-initialize AI paths to target the start/finish gate (checkpoint N) from grid spawns
    if (maxCheckpointNumber > 0) {
      const initAI = (driver, spawnPos) => {
        driver.lastCheckpointPassed = maxCheckpointNumber - 1;
        driver.calculatePathToNextCheckpoint({ x: spawnPos.x, z: spawnPos.z });
      };
      initAI(aiDriver1, spawn1.pos);
      initAI(aiDriver2, spawn2.pos);
      initAI(aiDriver3, spawn3.pos);
    }

    const trucks = [
      {
        truck: playerTruck,
        gameState: new GameState(playerTruck.state.maxBoosts),
        isPlayer: true,
        name: "Player",
        id: "player",
        hasStarted: false,
      },
      {
        truck: aiTruck1,
        gameState: new GameState(0),
        isPlayer: false,
        name: 'AI 1',
        id: 'ai1',
        hasStarted: false,
      },
      {
        truck: aiTruck2,
        gameState: new GameState(0),
        isPlayer: false,
        name: 'AI 2',
        id: 'ai2',
        hasStarted: false,
      },
      {
        truck: aiTruck3,
        gameState: new GameState(0),
        isPlayer: false,
        name: 'AI 3',
        id: 'ai3',
        hasStarted: false,
      }
    ];

    const playerTruckData = trucks[0];
    // Prime lastCheckpointPassed so trucks are ready to cross the start/finish line first
    trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    });

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    uiManager.showDebugPanel();
    uiManager.showRaceStatusPanel();
    uiManager.updateLaps(0, totalLaps);

    // -- Truck collision --
    const truckCollisionManager = new TruckCollisionManager();

    // -- Input --
    const inputManager = new InputManager(playerTruckData.truck, cameraController);
    this.inputManager = inputManager;

    inputManager.onPause(() => menuManager.togglePause());

    inputManager.onBoost(() => {
      if (
        playerTruckData.gameState.useBoost() &&
        !playerTruckData.truck.state.boostActive
      ) {
        playerTruckData.truck.state.boostActive = true;
        playerTruckData.truck.state.boostTimer =
          playerTruckData.truck.state.boostDuration;
        uiManager.updateBoosts(playerTruckData.gameState.boostCount);
      }
    });

    inputManager.onReset(() => respawnPlayer());

    // -- Checkpoint arrow --
    const checkpointArrow = new CheckpointArrow(scene);

    // -- Respawn --
    const respawnPlayer = () => {
      const truck = playerTruckData.truck;
      const lastPassed = playerTruckData.gameState.lastCheckpointPassed;
      let spawnX = truck.mesh.position.x;
      let spawnZ = truck.mesh.position.z;

      const wallSegs = wallManager.getWallSegments();
      const isNearWall = (cx, cz) => {
        for (const seg of wallSegs) {
          const dx = cx - seg.x;
          const dz = cz - seg.z;
          const cosH = Math.cos(seg.heading);
          const sinH = Math.sin(seg.heading);
          const along = dx * sinH + dz * cosH;
          const perp = Math.abs(dx * cosH - dz * sinH);
          if (Math.abs(along) <= seg.halfLength + 1 && perp <= 1.5) return true;
        }
        return false;
      };

      if (isNearWall(spawnX, spawnZ)) {
        outer: for (let radius = 2; radius <= 12; radius += 2) {
          for (let a = 0; a < 16; a++) {
            const angle = (a / 16) * Math.PI * 2;
            const cx = spawnX + Math.cos(angle) * radius;
            const cz = spawnZ + Math.sin(angle) * radius;
            if (!isNearWall(cx, cz)) {
              spawnX = cx;
              spawnZ = cz;
              break outer;
            }
          }
        }
      }

      const nextFeature = currentTrack.features.find(
        (f) =>
          f.type === "checkpoint" && f.checkpointNumber === lastPassed + 1
      );
      let spawnHeading = truck.state.heading;
      if (nextFeature) {
        spawnHeading = Math.atan2(
          nextFeature.centerX - spawnX,
          nextFeature.centerZ - spawnZ
        );
      }

      const spawnY = currentTrack.getHeightAt(spawnX, spawnZ) + TRUCK_HALF_HEIGHT;
      truck.mesh.position.set(spawnX, spawnY, spawnZ);
      truck.state.heading = spawnHeading;
      truck.mesh.rotation.y = spawnHeading;
      truck.state.velocity.set(0, 0, 0);
      truck.state.verticalVelocity = 0;
      truck.state.boostActive = false;
      truck.state.boostTimer = 0;

      const body = truck._truckInstance?.physics?.body ?? truck.physics?.body;
      if (body) {
        body.setLinearVelocity(Vector3.Zero());
        body.setAngularVelocity(Vector3.Zero());
      }

      console.log(
        `[Player] Respawned at (${spawnX.toFixed(1)}, ${spawnZ.toFixed(1)}) ` +
          `facing ${(spawnHeading * 180 / Math.PI).toFixed(1)}° ` +
          `(after checkpoint ${lastPassed})`
      );
    };

    // -- Countdown --
    const aiDrivers = [aiDriver1, aiDriver2, aiDriver3];

    const startCountdown = () => {
      this._countdownTimeouts.forEach(clearTimeout);
      this._countdownTimeouts = [];
      countdownActive = true;
      aiDrivers.forEach(d => { d.paused = true; });

      // Re-snap all trucks to their grid positions with zeroed physics state.
      // This neutralises any drift from the large first-frame dt that accumulates
      // during async scene setup, so trucks are clean when the player sees "3".
      trucks.forEach((truckData, index) => {
        const { pos, heading } = getGridSpawn(index);
        truckData.truck.mesh.position.copyFrom(pos);
        truckData.truck.state.heading = heading;
        truckData.truck.mesh.rotation.y = heading;
        truckData.truck.state.velocity = Vector3.Zero();
        truckData.truck.state.verticalVelocity = 0;
        truckData.truck.state.suspensionCompression = 0;
      });

      uiManager.showCountdown('3');
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('2'), 1000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.showCountdown('1'), 2000));
      this._countdownTimeouts.push(setTimeout(() => {
        uiManager.showCountdown('GO!');
        countdownActive = false;
        aiDrivers.forEach(d => { d.paused = false; });
        if (maxCheckpointNumber === 0 && !raceStarted) {
          raceStarted = true;
          raceStartTime = Date.now();
          lapStartTime = Date.now();
          uiManager.showRaceTimer();
        }
      }, 3000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.hideCountdown(), 3800));
    };

    // -- Full race reset --
    const resetGame = () => {
      raceStarted = false;
      raceStartTime = null;
      lapStartTime = null;
      uiManager.hideRaceTimer();

      trucks.forEach((truckData, index) => {
        const { pos, heading } = getGridSpawn(index);
        truckData.truck.mesh.position = pos;
        truckData.truck.state.heading = heading;
        truckData.truck.mesh.rotation.y = heading;
        truckData.truck.state.velocity = Vector3.Zero();
        truckData.truck.state.verticalVelocity = 0;
        truckData.truck.state.boostActive = false;
        truckData.truck.state.boostTimer = 0;
        truckData.gameState.reset();
        truckData.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
        truckData.hasStarted = false;
      });

      checkpointManager.rebuild();
      wallManager.rebuild();
      tireStackManager.rebuild();

      uiManager.updateBoosts(playerTruckData.gameState.boostCount);
      uiManager.updateLaps(0, totalLaps);
      uiManager.updateCheckpoints(0);

      startCountdown();
    };

    // -- Menu callbacks --
    menuManager.onResume = () => menuManager.hideMenu();
    menuManager.onReset = () => {
      resetGame();
      menuManager.hideMenu();
    };

    menuManager.onExit = () => {
      resetGame();
      menuManager.gameStarted = false;
      menuManager.hideMenu();
      this.controller.exit();
    };

    // -- Game loop --
    scene.onBeforeRenderObservable.add(() => {
      if (menuManager.isMenuActive()) return;

      // Cap dt to 50 ms so a long async-setup pause can't explode the physics
      const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);

      if (raceStarted && raceStartTime !== null) {
        uiManager.updateTimer(Date.now() - raceStartTime);
      }

      const input = countdownActive
        ? { forward: false, back: false, left: false, right: false }
        : inputManager.getMovementInput();

      wallManager.preUpdate(trucks, dt);
      truckCollisionManager.preUpdate(trucks, dt);

      let playerDebugInfo = null;
      trucks.forEach((truckData) => {
        if (truckData.gameState.raceFinished) return;
        const truckInput = truckData.isPlayer
          ? input
          : { forward: false, back: false, left: false, right: false };
        const debugInfo = updateTruck(truckData.truck, truckInput, dt, terrainManager, currentTrack);
        if (truckData.isPlayer) {
          playerDebugInfo = debugInfo;
        }
      });

      wallManager.update(trucks);
      truckCollisionManager.update(trucks);
      tireStackManager.update(trucks);

      const slopeDegFront = currentTrack.getTerrainSlopeAt(
        playerTruckData.truck.mesh.position.x,
        playerTruckData.truck.mesh.position.z,
        playerTruckData.truck.state.heading,
        1,
        4
      );
      uiManager.updateDebugPanel(
        playerDebugInfo,
        terrainManager.getTerrainAt(playerTruckData.truck.mesh.position),
        slopeDegFront
      );
      uiManager.updatePosition(playerTruckData.truck.mesh.position);
      uiManager.setBoostActive(playerTruckData.truck.state.boostActive);

      checkpointArrow.update(
        playerTruckData.truck.mesh.position,
        checkpointManager,
        playerTruckData.gameState.lastCheckpointPassed
      );

      trucks.forEach((truckData) => {
        if (truckData.gameState.raceFinished) return;

        const checkpointResult = checkpointManager.update(
          truckData.truck.mesh.position,
          truckData.truck.state.velocity,
          truckData.gameState.lastCheckpointPassed,
          truckData.id
        );

        if (!checkpointResult?.passed) return;

        const checkpointIndex = checkpointResult.index;

        // Start/finish crossing: start race timer and reset sequence so lap flow begins at CP 1
        if (checkpointIndex === maxCheckpointNumber && !truckData.hasStarted) {
          truckData.hasStarted = true;
          if (!raceStarted) {
            raceStarted = true;
            raceStartTime = Date.now();
            lapStartTime = Date.now();
            uiManager.showRaceTimer();
            console.log("Race started!");
          }
          truckData.gameState.lastCheckpointPassed = 0;
          truckData.gameState.checkpointCount = 0;
          checkpointManager.resetForTruck(truckData.id);
          if (truckData.isPlayer) uiManager.updateCheckpoints(0);
          // Notify AI driver so it recalculates path toward checkpoint #1
          if (!truckData.isPlayer && truckData.truck.aiDriver) {
            truckData.truck.aiDriver.onCheckpointPassed(maxCheckpointNumber, {
              x: truckData.truck.mesh.position.x,
              z: truckData.truck.mesh.position.z,
            });
          }
          return;
        }

        const newCount = truckData.gameState.incrementCheckpoint(
          checkpointIndex
        );

        if (!truckData.isPlayer && truckData.truck.aiDriver) {
          truckData.truck.aiDriver.onCheckpointPassed(checkpointResult.index, {
            x: truckData.truck.mesh.position.x,
            z: truckData.truck.mesh.position.z,
          });
        }

        if (truckData.isPlayer) {
          uiManager.updateCheckpoints(newCount);
        } else {
          console.log(
            `[${truckData.name}] Passed checkpoint ${checkpointResult.index}, ` +
              `count: ${newCount}/${checkpointManager.getTotalCheckpoints()}`
          );
        }

        if (newCount === checkpointManager.getTotalCheckpoints()) {
          const currentTime = Date.now();
          const lapTime = lapStartTime ? currentTime - lapStartTime : 0;
          lapStartTime = currentTime;
          const lapCount = truckData.gameState.completeLap(lapTime);
          checkpointManager.resetForTruck(truckData.id);

          if (truckData.isPlayer) {
            uiManager.updateLaps(lapCount, totalLaps);
            uiManager.updateCheckpoints(0);
            console.log(`Lap ${lapCount} completed in ${(lapTime / 1000).toFixed(2)}s`);
          } else {
            console.log(
              `[${truckData.name}] Completed lap ${lapCount} in ${(lapTime / 1000).toFixed(2)}s!`
            );
          }

          if (lapCount >= totalLaps) {
            const totalTime = currentTime - raceStartTime;
            truckData.gameState.finishRace(totalTime);
            truckData.truck.state.velocity = Vector3.Zero();
            truckData.truck.state.verticalVelocity = 0;

            if (truckData.isPlayer) {
              console.log("\n=== RACE FINISHED ===");
              console.log(`Total Time: ${(totalTime / 1000).toFixed(2)}s`);
              console.log("Lap Times:");
              truckData.gameState.lapTimes.forEach((time, i) => {
                console.log(`  Lap ${i + 1}: ${(time / 1000).toFixed(2)}s`);
              });
            } else {
              console.log(
                `[${truckData.name}] Finished race! Total time: ${(totalTime / 1000).toFixed(2)}s`
              );
            }
          }
        }
      });

      cameraController.update(playerTruckData.truck.mesh.position);
    });

    // Start the pre-race countdown
    startCountdown();

    return scene;
  }

  teardown() {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [];
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
  }
}
