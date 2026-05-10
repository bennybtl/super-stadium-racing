import { Vector3 } from "@babylonjs/core";
import { loadControlsSettings } from "../settingsStorage.js";

const DRIVING_BINDING_KEYS = {
  forward: "Gas",
  back: "Brake/Reverse",
  left: "Steer Left",
  right: "Steer Right",
  boost: "Use Nitro",
  reset: "Reset Truck",
  cycleCamera: "Cycle Camera",
  toggleDebug: "Toggle Debug",
  togglePhotoMode: "Toggle Photo Mode",
  zoomIn: "Zoom In",
  zoomOut: "Zoom Out",
};

const DEFAULT_DRIVING_CODES = {
  forward: "KeyW",
  back: "KeyS",
  left: "KeyA",
  right: "KeyD",
  boost: "KeyQ",
  reset: "KeyR",
  cycleCamera: "KeyC",
  toggleDebug: "Backslash",
  togglePhotoMode: "KeyP",
  zoomIn: "Equal",
  zoomOut: "Minus",
};

function resolveDrivingCodes() {
  const settings = loadControlsSettings();
  const driving = settings?.driving || {};

  const getCode = (action) => {
    const configured = driving[DRIVING_BINDING_KEYS[action]];
    return (typeof configured === "string" && configured.trim()) || DEFAULT_DRIVING_CODES[action];
  };

  return {
    forward: getCode("forward"),
    back: getCode("back"),
    left: getCode("left"),
    right: getCode("right"),
    boost: getCode("boost"),
    reset: getCode("reset"),
    cycleCamera: getCode("cycleCamera"),
    toggleDebug: getCode("toggleDebug"),
    togglePhotoMode: getCode("togglePhotoMode"),
    zoomIn: getCode("zoomIn"),
    zoomOut: getCode("zoomOut"),
  };
}

/**
 * InputManager - Handles all keyboard input
 */
export class InputManager {
  constructor(truck, cameraController) {
    this.truck = truck;
    this.cameraController = cameraController;
    this._disposed = false;
    this.drivingCodes = resolveDrivingCodes();
    
    // Movement input state
    this.input = { 
      forward: false, 
      back: false, 
      left: false, 
      right: false 
    };
    
    // Callbacks for special actions
    this.onResetCallback = null;
    this.onBoostCallback = null;
    this.onPauseCallback = null;
    this.onToggleDebugCallback = null;
    this.onTogglePhotoModeCallback = null;
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    // Store bound functions so we can remove them later
    this.boundKeyDown = (e) => this.handleKeyDown(e);
    this.boundKeyUp = (e) => this.handleKeyUp(e);
    
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
  }

  handleKeyDown(e) {
    if (this._disposed) return;
    // Movement
    if (e.code === this.drivingCodes.forward) this.input.forward = true;
    if (e.code === this.drivingCodes.back) this.input.back = true;
    if (e.code === this.drivingCodes.left) this.input.left = true;
    if (e.code === this.drivingCodes.right) this.input.right = true;
    
    // Nitro boost
    if (e.code === this.drivingCodes.boost) {
      if (this.onBoostCallback) {
        this.onBoostCallback();
      }
    }
    
    // Reset
    if (e.code === this.drivingCodes.reset) {
      if (this.onResetCallback) {
        this.onResetCallback();
      }
    }
    
    // Pause/Menu
    if (e.code === "Escape") {
      if (this.onPauseCallback) {
        this.onPauseCallback();
      }
    }

    // Camera mode toggle
    if (e.code === this.drivingCodes.cycleCamera) {
      this.cameraController.toggleMode();
    }


    // Toggle debug panel
    if (e.code === this.drivingCodes.toggleDebug) {
      if (this.onToggleDebugCallback) this.onToggleDebugCallback();
    }

    // Screenshot camera toggle
    if (e.code === this.drivingCodes.togglePhotoMode) {
      if (this.onTogglePhotoModeCallback) {
        this.onTogglePhotoModeCallback();
      }
    }

    // Zoom controls
    if (e.code === this.drivingCodes.zoomIn) {
      this.cameraController.zoomIn();
    }
    if (e.code === this.drivingCodes.zoomOut) {
      this.cameraController.zoomOut();
    }
  }

  handleKeyUp(e) {
    if (e.code === this.drivingCodes.forward) this.input.forward = false;
    if (e.code === this.drivingCodes.back) this.input.back = false;
    if (e.code === this.drivingCodes.left) this.input.left = false;
    if (e.code === this.drivingCodes.right) this.input.right = false;
  }

  getMovementInput() {
    return this.input;
  }

  onReset(callback) {
    this.onResetCallback = callback;
  }

  onBoost(callback) {
    this.onBoostCallback = callback;
  }

  onTogglePhotoMode(callback) {
    this.onTogglePhotoModeCallback = callback;
  }

  onPause(callback) {
    this.onPauseCallback = callback;
  }

  onToggleDebug(callback) {
    this.onToggleDebugCallback = callback;
  }
}
