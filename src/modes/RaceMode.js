import { Vector3 } from "@babylonjs/core";
import { createTruck, updateTruck } from "../truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { CheckpointArrow } from "../managers/CheckpointArrow.js";
import { buildScene } from "./SceneBuilder.js";
import { TRUCK_HEIGHT } from "../constants.js";

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

    // -- Race state --
    let raceStarted = false;
    let raceStartTime = null;
    let lapStartTime = null;

    // -- Trucks --
    const spawnY = currentTrack.getHeightAt(0, 0) + TRUCK_HEIGHT + 3;
    const playerTruck = createTruck(scene, shadows, null, null, new Vector3(0, spawnY, 0));
    const trucks = [
      {
        truck: playerTruck,
        gameState: new GameState(playerTruck.state.maxBoosts),
        isPlayer: true,
        name: "Player",
        id: "player",
      },
    ];
    const playerTruckData = trucks[0];

    // -- UI --
    const uiManager = new UIManager();
    uiManager.updateLaps(0, totalLaps);

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

      const spawnY = currentTrack.getHeightAt(spawnX, spawnZ) + TRUCK_HEIGHT;
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

    // -- Full race reset --
    const resetGame = () => {
      raceStarted = false;
      raceStartTime = null;
      lapStartTime = null;
      uiManager.hideRaceTimer();

      trucks.forEach((truckData, index) => {
        const rx = index * 3, rz = index * 3;
        truckData.truck.mesh.position = new Vector3(rx, currentTrack.getHeightAt(rx, rz) + TRUCK_HEIGHT, rz);
        truckData.truck.state.velocity = Vector3.Zero();
        truckData.truck.state.verticalVelocity = 0;
        truckData.truck.state.heading = 0;
        truckData.truck.state.boostActive = false;
        truckData.truck.state.boostTimer = 0;
        truckData.gameState.reset();
      });

      checkpointManager.reset();
      wallManager.reset();
      tireStackManager.reset();

      uiManager.updateBoosts(playerTruckData.gameState.boostCount);
      uiManager.updateLaps(0, totalLaps);
      uiManager.updateCheckpoints(0);
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

      const dt = engine.getDeltaTime() / 1000;

      if (raceStarted && raceStartTime !== null) {
        uiManager.updateTimer(Date.now() - raceStartTime);
      }

      const input = inputManager.getMovementInput();

      wallManager.preUpdate(trucks, dt);

      trucks.forEach((truckData) => {
        if (truckData.gameState.raceFinished) return;
        const truckInput = truckData.isPlayer
          ? input
          : { forward: false, back: false, left: false, right: false };
        updateTruck(truckData.truck, truckInput, dt, terrainManager, currentTrack);
      });

      wallManager.update(trucks);
      tireStackManager.update(trucks);

      const slopeDegFront = currentTrack.getTerrainSlopeAt(
        playerTruckData.truck.mesh.position.x,
        playerTruckData.truck.mesh.position.z,
        playerTruckData.truck.state.heading,
        1,
        4
      );
      uiManager.updateDebugPanel(
        playerTruckData.truck.state,
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

        if (!raceStarted && checkpointResult.index === 1) {
          raceStarted = true;
          raceStartTime = Date.now();
          lapStartTime = Date.now();
          uiManager.showRaceTimer();
          console.log("Race started!");
        }

        const newCount = truckData.gameState.incrementCheckpoint(
          checkpointResult.index
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

    return scene;
  }

  teardown() {
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
