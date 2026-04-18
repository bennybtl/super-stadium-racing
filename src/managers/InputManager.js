import { Vector3 } from "@babylonjs/core";

/**
 * InputManager - Handles all keyboard input
 */
export class InputManager {
  constructor(truck, cameraController) {
    this.truck = truck;
    this.cameraController = cameraController;
    this._disposed = false;
    
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
    if (e.code === "KeyW" || e.code === "ArrowUp") this.input.forward = true;
    if (e.code === "KeyS" || e.code === "ShiftLeft" || e.code === "ArrowDown") this.input.back = true;
    if (e.code === "KeyA" || e.code === "ArrowLeft") this.input.left = true;
    if (e.code === "KeyD" || e.code === "ArrowRight") this.input.right = true;
    
    // Nitro boost
    if (e.code === "KeyQ") {
      if (this.onBoostCallback) {
        this.onBoostCallback();
      }
    }
    
    // Reset
    if (e.code === "KeyR") {
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
    
    // Toggle debug panel
    if (e.code === "Backslash") {
      if (this.onToggleDebugCallback) this.onToggleDebugCallback();
    }

    // Camera mode toggle
    if (e.code === "KeyC") {
      this.cameraController.toggleMode();
    }

    // Zoom controls
    if (e.code === "Equal" || e.code === "NumpadAdd") {
      this.cameraController.zoomIn();
    }
    if (e.code === "Minus" || e.code === "NumpadSubtract") {
      this.cameraController.zoomOut();
    }
  }

  handleKeyUp(e) {
    if (e.code === "KeyW" || e.code === "ArrowUp") this.input.forward = false;
    if (e.code === "KeyS" || e.code === "ShiftLeft" || e.code === "ArrowDown") this.input.back = false;
    if (e.code === "KeyA" || e.code === "ArrowLeft") this.input.left = false;
    if (e.code === "KeyD" || e.code === "ArrowRight") this.input.right = false;
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

  onPause(callback) {
    this.onPauseCallback = callback;
  }

  onToggleDebug(callback) {
    this.onToggleDebugCallback = callback;
  }
}
