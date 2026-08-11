import { Vector3 } from "@babylonjs/core";
import { EngineAudio } from "./EngineAudio.js";
import { DEEP_SPLASH_DEPTH } from "../constants.js";
import sliding1Url from "../assets/sounds/sliding1.wav?url";
import sliding2Url from "../assets/sounds/sliding2.wav?url";
import sliding3Url from "../assets/sounds/sliding3.wav?url";
import splashDrivingUrl from "../assets/sounds/splash-driving.wav?url";
import splashLandingUrl from "../assets/sounds/splash-landing.wav?url";
import clunk1Url from "../assets/sounds/clunk1.wav?url";
import clunk2Url from "../assets/sounds/clunk2.wav?url";
import clunk3Url from "../assets/sounds/clunk3.wav?url";
import clunk4Url from "../assets/sounds/clunk4.wav?url";
import hit1Url from "../assets/sounds/hit1.wav?url";
import hit3Url from "../assets/sounds/hit3.wav?url";
import nitro1Url from "../assets/sounds/nitro1.wav?url";
import nitro2Url from "../assets/sounds/nitro2.wav?url";
import nitro3Url from "../assets/sounds/nitro3.wav?url";
import airhorn1Url from "../assets/sounds/airhorn1.wav?url";

const PRESETS = {
  bac: "bac",
  v8: "v8",
};

const MAX_SPEED_FALLBACK = 25;

export class TruckAudioController {
  constructor(audioManager, engineAudio) {
    this._audioManager = audioManager;
    this._engineAudio = engineAudio;
    this._driftAudioActive = false;
    this._driftAudioStarting = false;
    this._splashDriveAudioActive = false;
    this._splashDriveAudioStarting = false;
    this._prevGroundedness = 1;
    this._wasBoostActive = false;
    this._wasInDeepWater = false;
  }

  static async create(audioManager, preset = PRESETS.bac) {
    const engineAudio = await EngineAudio.create(audioManager, preset);
    const controller = new TruckAudioController(audioManager, engineAudio);

    await audioManager.loadSound("sliding1", sliding1Url, {
      loop: true,
      autoplay: false,
      volume: 1,
      loopStart: 0,
      loopEnd: 0,
    });
    await audioManager.loadSound("sliding2", sliding2Url, {
      loop: true,
      autoplay: false,
      volume: 1,
      loopStart: 0,
      loopEnd: 0,
    });
    await audioManager.loadSound("sliding3", sliding3Url, {
      loop: true,
      autoplay: false,
      volume: 1,
      loopStart: 0,
      loopEnd: 0,
    });
    await audioManager.loadSound("splashDriving", splashDrivingUrl, {
      loop: true,
      autoplay: false,
      volume: 1,
      loopStart: 0,
      loopEnd: 0,
    });
    await audioManager.loadSound("splashLanding", splashLandingUrl, {
      loop: false,
      autoplay: false,
      volume: 0.5,
    });
    await audioManager.loadSound("clunk1", clunk1Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("clunk2", clunk2Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("clunk3", clunk3Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("clunk4", clunk4Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("reload", hit1Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("nitroActivation1", nitro1Url, {
      loop: false,
      autoplay: false,
      volume: 0.75,
    });
    await audioManager.loadSound("nitroActivation2", nitro2Url, {
      loop: false,
      autoplay: false,
      volume: 0.75,
    });
    await audioManager.loadSound("nitroActivation3", nitro3Url, {
      loop: false,
      autoplay: false,
      volume: 0.75,
    });
    await audioManager.loadSound("hit3", hit3Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });
    await audioManager.loadSound("airhorn1", airhorn1Url, {
      loop: false,
      autoplay: false,
      volume: 1,
    });

    return controller;
  }

  _setVolume(key, volume) {
    this._audioManager?.setSoundVolume(key, volume);
  }

  _playLoop(key, volume = 1) {
    return this._audioManager?.playLoop(key, { volume, loopStart: 0, loopEnd: 0 });
  }

  _stopLoop(key) {
    this._audioManager?.stopLoop(key);
  }

  _playSound(key, volume = 1) {
    return this._audioManager?.playSound(key, { volume });
  }

  _startDriftAudio() {
    if (!this._audioManager || this._driftAudioActive || this._driftAudioStarting) return;
    this._driftAudioStarting = true;
    Promise.all([
      this._playLoop("sliding1", 0.5),
      this._playLoop("sliding2", 0.5),
      this._playLoop("sliding3", 0.5),
    ]).finally(() => {
      this._driftAudioStarting = false;
      this._driftAudioActive = true;
    });
  }

  _stopDriftAudio() {
    if (!this._audioManager || (!this._driftAudioActive && !this._driftAudioStarting)) return;
    this._stopLoop("sliding1");
    this._stopLoop("sliding2");
    this._stopLoop("sliding3");
    this._driftAudioActive = false;
    this._driftAudioStarting = false;
  }

  _startSplashDriveAudio() {
    if (!this._audioManager || this._splashDriveAudioActive || this._splashDriveAudioStarting) return;
    this._splashDriveAudioStarting = true;
    this._playLoop("splashDriving", 1).finally(() => {
      this._splashDriveAudioStarting = false;
      this._splashDriveAudioActive = true;
    });
  }

  _stopSplashDriveAudio() {
    if (!this._audioManager || (!this._splashDriveAudioActive && !this._splashDriveAudioStarting)) return;
    this._stopLoop("splashDriving");
    this._splashDriveAudioActive = false;
    this._splashDriveAudioStarting = false;
  }

  _playLandingClunk() {
    if (!this._audioManager) return;
    const select = Math.random();
    if (select < 0.25) {
      this._playSound("clunk1", 0.8);
    } else if (select < 0.5) {
      this._playSound("clunk2", 0.8);
    } else if (select < 0.75) {
      this._playSound("clunk3", 0.8);
    } else {
      this._playSound("clunk4", 0.8);
    }
  }

  _playSplashLanding() {
    if (!this._audioManager) return;
    this._playSound("splashLanding", 0.5);
  }

  /**
   * How deep the water is under the truck, 0 on dry ground.
   *
   * Reads the scene's shared water-depth query — the same bodies that are drawn.
   * This used to walk the feature list re-deriving hill and squareHill heights
   * itself, which meant it missed polyHill pools entirely and judged depth by an
   * absolute world height, so a lake dug into a hill never registered.
   */
  _waterDepthUnder(mesh) {
    const depthAt = mesh?.getScene?.()?.metadata?.waterDepthAt;
    if (!depthAt) return 0;
    return depthAt(mesh.position.x, mesh.position.z);
  }

  update({ state, speed, hSpeed, groundedness, deltaTime, maxSpeed = MAX_SPEED_FALLBACK, mesh, track, currentTerrain, input }) {
    const isGrounded = groundedness > 0.5;
    const previousGroundedness = this._prevGroundedness;
    const terrainName = currentTerrain?.name ?? "default";

    this._engineAudio?.update(hSpeed ?? speed, !!input?.forward, deltaTime, maxSpeed);

    const driftIntensity = Math.max(0, (state.slipAngle ?? 0) - (state.driftThreshold ?? 0.3));
    if (speed > 0.5 && driftIntensity > 0.02) {
      const spinoutBoost = state.isSpinningOut ? 2.0 : 1.0;
      this._startDriftAudio();
      const driftAudioLevel = Math.max(0, Math.min(1, driftIntensity * 4.0 * spinoutBoost));
      const low = Math.max(0, 1 - driftAudioLevel * 1.15);
      const mid = Math.max(0, 1 - Math.abs(driftAudioLevel - 0.5) * 1.8);
      const high = Math.max(0, (driftAudioLevel - 0.22) * 1.45);
      const master = Math.max(0.65, 1.0);

      this._setVolume("sliding1", low * master);
      this._setVolume("sliding2", mid * master);
      this._setVolume("sliding3", high * master);
    } else {
      this._stopDriftAudio();
    }

    // `currentTerrain` is only set when the truck is actually riding the painted
    // ground — it is null while airborne or on a bridge deck above it. The depth
    // query is XZ-only and knows nothing about what the truck is standing on, so
    // without this gate the truck splashes while jumping over a lake or crossing
    // a bridge above one.
    const onPaintedGround = !!currentTerrain;
    const inDeepWater = onPaintedGround && isGrounded
      && this._waterDepthUnder(mesh) >= DEEP_SPLASH_DEPTH;
    if (inDeepWater && isGrounded && speed > 1) {
      this._startSplashDriveAudio();
      const splashDriveLevel = Math.max(0, Math.min(1, (speed - 1.0) / 10.0));
      this._setVolume("splashDriving", Math.max(0.15, splashDriveLevel) * 0.95);
    } else {
      this._stopSplashDriveAudio();
    }

    if (inDeepWater && !this._wasInDeepWater) {
      this._playSplashLanding();
    }

    const rapidLanding = previousGroundedness <= 0.05 && groundedness > 0.5;
    if (rapidLanding) {
      this._playLandingClunk();
      if (inDeepWater) {
        this._playSplashLanding();
      }
    }

    const boosting = state.boostActive || state.speedBoostActive;
    const boostJustStarted = boosting && !this._wasBoostActive;
    if (boostJustStarted) {
      this.playNitroActivation();
    }

    this._prevGroundedness = groundedness;
    this._wasBoostActive = boosting;
    this._wasInDeepWater = inDeepWater;
  }

  playNitroActivation() {
    const variant = 1 + Math.floor(Math.random() * 3);
    this._playSound(`nitroActivation${variant}`, 1);
  }

  playLastLapAirhorn() {
    this._playSound("airhorn1", 1);
  }

  playReload() {
    this._playSound("reload", 1);
  }

  stop() {
    this._stopDriftAudio();
    this._stopSplashDriveAudio();
    this._engineAudio?.stop();
  }
}