import { Vector3 } from "@babylonjs/core";

/**
 * InputManager - Handles all keyboard input
 */
export class InputManager {
  constructor(truck, cameraController) {
    this.truck = truck;
    this.cameraController = cameraController;
    
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
    
    this.setupEventListeners();
  }

  setupEventListeners() {
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));
    window.addEventListener("keyup", (e) => this.handleKeyUp(e));
  }

  handleKeyDown(e) {
    // Movement
    if (e.code === "KeyW" || e.code === "ArrowUp") this.input.forward = true;
    if (e.code === "KeyS" || e.code === "ArrowDown") this.input.back = true;
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
    
    // Zoom controls
    if (e.code === "Minus" || e.code === "NumpadSubtract") {
      this.cameraController.zoomOut();
    }
    if (e.code === "Equal" || e.code === "NumpadAdd") {
      this.cameraController.zoomIn();
    }
  }

  handleKeyUp(e) {
    if (e.code === "KeyW" || e.code === "ArrowUp") this.input.forward = false;
    if (e.code === "KeyS" || e.code === "ArrowDown") this.input.back = false;
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
}
