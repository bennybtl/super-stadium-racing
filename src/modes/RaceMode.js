import { Vector3, Color3 } from "@babylonjs/core";
import { AIDriver } from "../ai/AIDriver.js";
import { Truck } from "../truck/truck.js";
import { GameState } from "../managers/GameState.js";
import { InputManager } from "../managers/InputManager.js";
import { UIManager } from "../managers/UIManager.js";
import { DebugManager } from "../managers/DebugManager.js";
import { TruckCollisionManager } from "../managers/TruckCollisionManager.js";
import { StaticBodyCollisionManager } from "../managers/StaticBodyCollisionManager.js";
import { buildScene } from "./SceneBuilder.js";
import { TRUCK_HALF_HEIGHT } from "../constants.js";
import { BaseMode } from "./BaseMode.js";
import { UPGRADES } from "../managers/SeasonManager.js";
import { TelemetryRecorder } from "../managers/TelemetryRecorder.js";
import { setupAIDrivers } from "./setupAIDrivers.js";

/**
 * RaceMode – full racing gameplay.
 *
 * Owns the Babylon scene, truck(s), input, UI, checkpoint/lap tracking
 * and the game loop. Delegates scene construction to SceneBuilder.
 */
export class RaceMode extends BaseMode {
  constructor(controller) {
    super(controller);
    this.inputManager = null;
    this._countdownTimeouts = [];
    this._dnfTimer = null;
    this.debugManager = null;
    this.telemetryRecorder = null;
  }

  async setup({ trackKey, laps, season = false, vehicleKey = 'default_truck' }) {
    const { engine, menuManager, trackLoader, seasonManager } = this.controller;
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
      flagManager,
      pickupManager,
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
    let countdownActive = false;

    // -- Finish / DNF tracking (season mode) --
    const DNF_GRACE_MS = 45_000;
    const finishOrder  = [];   // truckData entries in finish order
    let dnfTimer       = null; // started when the first driver begins their last lap
    let raceEnded      = false;

    // Keep a reference on `this` so teardown() can cancel an in-flight timer
    const setDnfTimer = (t) => { dnfTimer = t; this._dnfTimer = t; };
    const clearDnfTimer = () => { clearTimeout(dnfTimer); dnfTimer = null; this._dnfTimer = null; };

    const triggerRaceEnd = () => {
      if (raceEnded) return;
      raceEnded = true;
      if (dnfTimer) { clearDnfTimer(); }

      // Freeze trucks that DNF'd (still moving with no path to finish)
      trucks.forEach(td => {
        if (!td.gameState.raceFinished) {
          td.truck.state.velocity = Vector3.Zero();
          td.truck.state.velocity.y = 0;
        }
      });

      if (season && seasonManager) {
        // Build results — finishOrder first, then DNFs in truck-array order
        const finishedIds = new Set(finishOrder.map(td => td.id));
        const dnfTrucks   = trucks.filter(td => !finishedIds.has(td.id));

        const resultsArray = [
          ...finishOrder.map((td, idx) => ({
            id:               td.id,
            finishPosition:   idx + 1,
            totalRaceTimeMs:  td.gameState.totalRaceTime,
            fastestLapMs:     td.gameState.fastestLap,
          })),
          ...dnfTrucks.map((td, idx) => ({
            id:               td.id,
            finishPosition:   finishOrder.length + idx + 1,
            totalRaceTimeMs:  null,
            fastestLapMs:     null,
            dnf:              true,
          })),
        ];

        const postRaceData = seasonManager.recordRaceResult(resultsArray);
        console.log('[RaceMode] Season race recorded. Showing post-race screen.');
        menuManager.showPostRace(postRaceData);
      } else {
        // Non-season: show a simple post-race results screen
        const finishedIds = new Set(finishOrder.map(td => td.id));
        const dnfTrucks   = trucks.filter(td => !finishedIds.has(td.id));
        const rows = [
          ...finishOrder.map((td, idx) => ({
            id:              td.id,
            name:            td.name,
            isPlayer:        td.isPlayer,
            finishPosition:  idx + 1,
            totalRaceTimeMs: td.gameState.totalRaceTime,
            fastestLapMs:    td.gameState.fastestLap,
            dnf:             false,
          })),
          ...dnfTrucks.map((td, idx) => ({
            id:              td.id,
            name:            td.name,
            isPlayer:        td.isPlayer,
            finishPosition:  finishOrder.length + idx + 1,
            totalRaceTimeMs: null,
            fastestLapMs:    null,
            dnf:             true,
          })),
        ];
        menuManager.showSingleRaceResults({ trackKey, rows });
      }
    };

    const handleDNF = () => {
      // Any truck that hasn't finished yet is DNF'd in truck-array order
      trucks
        .filter(td => !td.gameState.raceFinished)
        .forEach(td => {
          td.gameState.finishRace(null); // mark finished without a time
          finishOrder.push(td);
          console.log(`[RaceMode] DNF: ${td.name}`);
        });
      triggerRaceEnd();
    };

    // -- Trucks --
    const spawn0 = getGridSpawn(0);

    const playerVehicleDef = window.vehicleLoader?.getVehicle(vehicleKey) ?? null;
    const playerTruck = new Truck(scene, shadows, null, null, playerVehicleDef);
    playerTruck.mesh.position.copyFrom(spawn0.pos);
    playerTruck.state.heading = spawn0.heading;
    playerTruck.mesh.rotation.y = spawn0.heading;

    // Apply season upgrades to the player truck's base stats
    if (season && seasonManager) {
      const purchased = seasonManager.getPlayerUpgrades();
      for (const upgrade of UPGRADES) {
        const level = purchased[upgrade.id] ?? 0;
        if (level === 0) continue;
        if (upgrade.id === 'suspension') {
          // Suspension upgrades both spring strength and damping
          playerTruck.state.springStrength += 20 * level;
          playerTruck.state.damping        += 1.5 * level;
        } else if (upgrade.statKey) {
          playerTruck.state[upgrade.statKey] += upgrade.statDelta * level;
        }
      }
      // Apply persistent nitro pool (carries over between races)
      playerTruck.state.boostCount = purchased.nitroCount ?? playerTruck.state.boostCount;
      playerTruck.state.maxBoosts  = purchased.nitroCount ?? playerTruck.state.maxBoosts;
    }

    // ── Telemetry ────────────────────────────────────────────────────────────
    const telemetryRecorder = new TelemetryRecorder(trackKey, /* checkpoints resolved below */ []);
    this.telemetryRecorder = telemetryRecorder;

    // ── AI drivers ───────────────────────────────────────────────────────────
    // Season driver info helpers — passed into setupAIDrivers so it can name/id each slot
    const seasonAIDrivers = season && seasonManager ? seasonManager.getAIDrivers() : null;
    const getAIName  = (i) => seasonAIDrivers ? seasonAIDrivers[i].name : `AI ${i + 1}`;
    const getAIId    = (i) => seasonAIDrivers ? seasonAIDrivers[i].id   : `ai${i + 1}`;
    const getAISkill = (i) => seasonAIDrivers ? seasonAIDrivers[i].skillConfig : {};

    const AI_COUNT = 3; // change this to add more AI competitors
    const { aiTruckDataList, aiDrivers } = setupAIDrivers({
      count: AI_COUNT,
      scene,
      shadows,
      currentTrack,
      checkpointManager,
      wallManager,
      vehicleDef: playerVehicleDef,
      playerTruck,
      getGridSpawn,
      getAIName,
      getAIId,
      getAISkill,
      trackKey,
      telemetryCheckpoints: null, // resolved below
    });

    // Grab the canonical checkpoint list from the first AI driver (already sorted)
    const telemetryCheckpoints = aiDrivers[0]?.checkpoints ?? [];
    // Patch the recorder's checkpoint list now that we have it
    telemetryRecorder._checkpoints = telemetryCheckpoints;

    // If saved telemetry exists, load it into all AI drivers
    const savedTelemetry = window._telemetryStore?.[trackKey] ?? null;
    if (savedTelemetry && telemetryCheckpoints.length) {
      const { TelemetryPlayer } = await import("../managers/TelemetryPlayer.js");
      const tp = new TelemetryPlayer(trackKey, telemetryCheckpoints);
      if (tp.loadFromObject(savedTelemetry)) {
        const waypoints = tp.buildWaypoints();
        aiDrivers.forEach(d => d.loadTelemetry(waypoints));
      }
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
      ...aiTruckDataList,
    ];

    const playerTruckData = trucks[0];
    // Prime lastCheckpointPassed so trucks are ready to cross the start/finish line first
    trucks.forEach(td => {
      td.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
    });

    // -- UI --
    const uiManager = new UIManager();
    this.uiManager = uiManager;
    // Register telemetry recorder with the Vue store so RaceHUD buttons can control it
    uiManager.setTelemetryRecorder(telemetryRecorder);
    // uiManager.showDebugPanel();
    uiManager.showRaceStatusPanel();
    uiManager.updateLaps(0, totalLaps);

    const debugManager = new DebugManager(scene);
    this.debugManager = debugManager;

    // -- Truck collision --
    const truckCollisionManager = new TruckCollisionManager();
    const staticBodyCollisionManager = new StaticBodyCollisionManager(scene);

    // -- Input --
    const inputManager = new InputManager(playerTruckData.truck, cameraController);
    this.inputManager = inputManager;

    inputManager.onPause(() => menuManager.togglePause());
    this.setupDebugToggle(inputManager, debugManager);

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

    // -- Pickup collection --
    pickupManager.spawn(6); // Scatter pickups specifically for the race
    pickupManager.onPickupCollected = (type, truckData) => {
      if (type === 'boost' && truckData.gameState) {
        truckData.gameState.boostCount++;
        if (truckData.isPlayer) {
          uiManager.updateBoosts(truckData.gameState.boostCount);
        }
      }
    };

    // -- Respawn --
    const respawnPlayer = () => {
      const truck = playerTruckData.truck;
      const lastPassed = playerTruckData.gameState.lastCheckpointPassed;

      // Spawn at the last passed checkpoint centre.
      // lastPassed === 0 means the player just crossed the start/finish line and
      // hasn't reached any mid-track checkpoint yet, so use the start/finish (maxCheckpointNumber).
      const cpNumberToFind = lastPassed === 0 ? maxCheckpointNumber : lastPassed;
      const lastCp = currentTrack.features.find(
        (f) => f.type === 'checkpoint' && f.checkpointNumber === cpNumberToFind
      );
      let spawnX = lastCp ? lastCp.centerX : truck.mesh.position.x;
      let spawnZ = lastCp ? lastCp.centerZ : truck.mesh.position.z;

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
      truck.state.velocity.y = 0;
      truck.state.boostActive = false;
      truck.state.boostTimer = 0;

      const body = truck.physics?.body;
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
        truckData.truck.state.velocity.y = 0;
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
          trucks.forEach(t => t.lapStartTime = Date.now());
          uiManager.showRaceTimer();
        }
      }, 3000));
      this._countdownTimeouts.push(setTimeout(() => uiManager.hideCountdown(), 3800));
    };

    // -- Full race reset --
    const resetGame = () => {
      raceStarted = false;
      raceStartTime = null;
      trucks.forEach(t => t.lapStartTime = null);
      raceEnded = false;
      finishOrder.length = 0;
      if (dnfTimer) { clearDnfTimer(); }
      uiManager.hideRaceTimer();

      trucks.forEach((truckData, index) => {
        const { pos, heading } = getGridSpawn(index);
        truckData.truck.mesh.position = pos;
        truckData.truck.state.heading = heading;
        truckData.truck.mesh.rotation.y = heading;
        truckData.truck.state.velocity = Vector3.Zero();
        truckData.truck.state.velocity.y = 0;
        truckData.truck.state.boostActive = false;
        truckData.truck.state.boostTimer = 0;
        truckData.gameState.reset();
        truckData.gameState.lastCheckpointPassed = maxCheckpointNumber > 0 ? maxCheckpointNumber - 1 : 0;
        truckData.hasStarted = false;
      });

      checkpointManager.rebuild();
      wallManager.rebuild();
      tireStackManager.rebuild();
      pickupManager.rebuild();

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

    // Pre-filter 'slowZone' action zones for per-frame position checks
    const slowZones = currentTrack.features.filter(
      f => f.type === 'actionZone' && f.zoneType === 'slowZone'
    );

    // Setup visibility handler to prevent physics accumulation
    this.setupVisibilityHandler(scene, trucks);

    // -- Game loop --
    scene.onBeforeRenderObservable.add(() => {
      if (menuManager.isMenuActive() || document.hidden) return;

      // Use 50ms cap for race mode (more generous than default 20ms)
      const dt = this.getClampedDeltaTime(engine, 0.05);

      if (raceStarted && raceStartTime !== null) {
        uiManager.updateTimer(Date.now() - raceStartTime);
      }

      const input = countdownActive
        ? { forward: false, back: false, left: false, right: false }
        : inputManager.getMovementInput();

      truckCollisionManager.preUpdate(trucks, dt);

      let playerDebugInfo = null;
      trucks.forEach((truckData) => {
        // Finished trucks still get physics updates (zero input) so they coast to a stop
        const isCoasting = truckData.gameState.raceFinished;
        const truckInput = (isCoasting || !truckData.isPlayer)
          ? { forward: false, back: false, left: false, right: false }
          : input;
        const debugInfo = truckData.truck.update(truckInput, dt, terrainManager, currentTrack);
        if (truckData.isPlayer) {
          playerDebugInfo = debugInfo;
        }
      });

      staticBodyCollisionManager.update(trucks);

      // Clamp speed for any truck inside a 'slowZone' action zone
      if (slowZones.length > 0) {
        trucks.forEach(({ truck }) => {
          const pos = truck.mesh.position;
          const inSlow = slowZones.some(z => {
            const dx = pos.x - z.x, dz = pos.z - z.z;
            return (dx * dx + dz * dz) < z.radius * z.radius;
          });
          truck.state.slowZoneActive = inSlow;
          if (inSlow) {
            const limit = truck.state.slowZoneMaxSpeed;
            if (truck.state.velocity.length() > limit) {
              truck.state.velocity.normalize().scaleInPlace(limit);
            }
          }
        });
      }

      truckCollisionManager.update(trucks);
      tireStackManager.update(trucks);
      flagManager.update(trucks, dt);
      pickupManager.update(trucks, dt);

      debugManager.update(playerDebugInfo, terrainManager, currentTrack, playerTruckData.truck);
      uiManager.setBoostActive(playerTruckData.truck.state.boostActive);

      // Feed telemetry recorder each frame for the player truck
      if (telemetryRecorder.recording && raceStarted) {
        const pt = playerTruckData.truck;
        const fwdVec = new Vector3(Math.sin(pt.state.heading), 0, Math.cos(pt.state.heading));
        const fwdSpd = pt.state.velocity.dot(fwdVec);
        const currentGrip = playerDebugInfo?.terrainGripMultiplier ?? 1;
        telemetryRecorder.update(
          { x: pt.mesh.position.x, z: pt.mesh.position.z },
          fwdSpd,
          dt * 1000,
          currentGrip
        );
      }

      // Keep each AI truck's last-known terrain grip updated so the telemetry
      // speed-target scaling in AIDriver can access it without a terrainManager ref.
      trucks.forEach(td => {
        if (!td.isPlayer && td.truck.driver) {
          const terrain = terrainManager.getTerrainAt(td.truck.mesh.position);
          td.truck._lastTerrainGrip = terrain.gripMultiplier;
        }
      });

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
            uiManager.showRaceTimer();
            console.log("Race started!");
          }
          
          truckData.lapStartTime = Date.now();
          truckData.gameState.lastCheckpointPassed = 0;
          truckData.gameState.checkpointCount = 0;
          checkpointManager.resetForTruck(truckData.id);
          if (truckData.isPlayer) {
            uiManager.updateCheckpoints(0);
            // Auto-start telemetry recording when player crosses the start line
            if (telemetryRecorder.recording) {
              telemetryRecorder.onCheckpointPassed(
                maxCheckpointNumber,
                { x: truckData.truck.mesh.position.x, z: truckData.truck.mesh.position.z },
                truckData.truck.state.velocity.dot(new Vector3(Math.sin(truckData.truck.state.heading), 0, Math.cos(truckData.truck.state.heading))),
                playerDebugInfo?.terrainGripMultiplier ?? 1
              );
            }
          }
          // Notify AI driver so it recalculates path toward checkpoint #1
          if (!truckData.isPlayer && truckData.truck.driver) {
            truckData.truck.driver.onCheckpointPassed(maxCheckpointNumber, {
              x: truckData.truck.mesh.position.x,
              z: truckData.truck.mesh.position.z,
            });
          }
          return;
        }

        const newCount = truckData.gameState.incrementCheckpoint(
          checkpointIndex
        );

        if (!truckData.isPlayer && truckData.truck.driver) {
          truckData.truck.driver.onCheckpointPassed(checkpointResult.index, {
            x: truckData.truck.mesh.position.x,
            z: truckData.truck.mesh.position.z,
          });
        }

        // Feed mid-lap checkpoint events into the telemetry recorder
        if (truckData.isPlayer && telemetryRecorder.recording) {
          const fwdVec = new Vector3(Math.sin(truckData.truck.state.heading), 0, Math.cos(truckData.truck.state.heading));
          telemetryRecorder.onCheckpointPassed(
            checkpointResult.index,
            { x: truckData.truck.mesh.position.x, z: truckData.truck.mesh.position.z },
            truckData.truck.state.velocity.dot(fwdVec),
            playerDebugInfo?.terrainGripMultiplier ?? 1
          );
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
          const lapTime = truckData.lapStartTime ? currentTime - truckData.lapStartTime : 0;
          truckData.lapStartTime = currentTime;
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

          // Start the DNF countdown when the LAST driver begins their final lap
          if (lapCount === totalLaps - 1 && dnfTimer === null && !raceEnded) {
            const driversOnFinalLap = trucks.filter(
              td => !td.gameState.raceFinished && td.gameState.lapCount >= totalLaps - 1
            ).length;
            if (driversOnFinalLap === trucks.length - finishOrder.length) {
              console.log(`[RaceMode] All remaining drivers on final lap — DNF timer started (${DNF_GRACE_MS / 1000}s)`);
              setDnfTimer(setTimeout(handleDNF, DNF_GRACE_MS));
            }
          }

          if (lapCount >= totalLaps) {
            const totalTime = currentTime - raceStartTime;
            truckData.gameState.finishRace(totalTime);
            finishOrder.push(truckData);

            // Stop AI driver from issuing further steering inputs
            if (!truckData.isPlayer && truckData.truck.driver) {
              truckData.truck.driver.paused = true;
            }

            // For 1-lap races the "start final lap" trigger never fires, so start
            // the DNF timer here on first finish instead.
            if (dnfTimer === null && !raceEnded) {
              console.log(`[RaceMode] ${truckData.name} finished — DNF timer started (${DNF_GRACE_MS / 1000}s)`);
              setDnfTimer(setTimeout(handleDNF, DNF_GRACE_MS));
            }

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

            // All drivers finished — end race immediately
            if (finishOrder.length === trucks.length) {
              triggerRaceEnd();
            }
          }
        }
      });

      cameraController.update(playerTruckData.truck.mesh.position, playerTruckData.truck.state.heading, dt);
    });

    // Start the pre-race countdown
    cameraController.update(playerTruckData.truck.mesh.position, playerTruckData.truck.state.heading); // pre-snap before first frame
    startCountdown();

    return scene;
  }

  teardown() {
    this._countdownTimeouts.forEach(clearTimeout);
    this._countdownTimeouts = [];
    if (this._dnfTimer) { clearTimeout(this._dnfTimer); this._dnfTimer = null; }
    if (this.inputManager) {
      this.inputManager.dispose();
      this.inputManager = null;
    }
    if (this.uiManager) {
      this.uiManager.hideAll();
      this.uiManager = null;
    }
    if (this.debugManager) {
      this.debugManager.hide();
      this.debugManager = null;
    }
    super.teardown();
  }
}
