import { Vector3 } from "@babylonjs/core";

/**
 * BaseMode - Abstract base class for all game modes.
 * 
 * Provides common functionality:
 * - Visibility change handling to prevent physics accumulation
 * - Physics state reset utilities
 * - Lifecycle management (teardown)
 * 
 * Subclasses must implement:
 * - async setup(config)
 */
export class BaseMode {
  constructor(controller) {
    this.controller = controller;
    this.scene = null;
    this.visibilityHandler = null;
  }

  /**
   * Get deltaTime from engine with clamping to prevent physics explosions.
   * This is critical after tab visibility changes or async operations that
   * cause large time gaps.
   * 
   * @param {Engine} engine - Babylon engine
   * @param {number} maxDt - Maximum allowed deltaTime in seconds (default: 0.020 = 50fps)
   * @returns {number} Clamped deltaTime in seconds
   */
  getClampedDeltaTime(engine, maxDt = 0.05) {
    const dt = engine.getDeltaTime() / 1000;
    return Math.min(dt, maxDt);
  }

  /**
   * Teleport a truck to a position/heading and flush the collision manager's
   * stale prevPos so the swept-AABB broadphase doesn't treat the teleport as
   * a wall-crossing trajectory.
   *
   * Use this for every respawn — initial placement after setup AND R-key resets.
   *
   * @param {Truck} truck
   * @param {Vector3} position
   * @param {number} heading
   * @param {StaticBodyCollisionManager} [staticBodyCollisionManager]
   */
  respawnTruck(truck, position, heading, staticBodyCollisionManager) {
    truck.teleportTo(position, heading);
    staticBodyCollisionManager?.notifyTeleport(truck);
  }

  /** @deprecated Use respawnTruck instead */
  resetTruckPhysics(truck, position, heading = truck.state.heading) {
    this.respawnTruck(truck, position, heading);
  }

  /**
   * Setup visibility change handler to pause physics when tab is hidden.
   * This prevents physics accumulation in the background which causes
   * trucks to "launch" when the tab becomes visible again.
   * 
   * @param {Scene} scene - Babylon scene
   * @param {Array} trucks - Array of truck data objects (with .truck property) or truck instances
   */
  setupVisibilityHandler(scene, trucks) {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden - pause physics to prevent accumulation
        if (scene.physicsEnabled) {
          const engine = scene.getPhysicsEngine();
          engine.setTimeStep(0);
        }
      } else {
        // Tab is visible - resume physics and reset truck state
        if (scene.physicsEnabled) {
          const engine = scene.getPhysicsEngine();
          engine.setTimeStep(1/60);
        }
        
        // CRITICAL: Reset Babylon engine's deltaTime tracking to prevent
        // accumulated time from causing a physics explosion on first frame
        const babylonEngine = scene.getEngine();
        if (babylonEngine && babylonEngine._deltaTime !== undefined) {
          babylonEngine._deltaTime = 16.67; // Reset to ~60fps
        }
        // Reset all truck velocities and positions to prevent launch effect
        trucks.forEach((truckOrData) => {
          const truck = truckOrData.truck || truckOrData;
          const currentPos = truck.mesh.position.clone();
          
          // Reset physics body FIRST before state variables
          const body = truck._truckInstance?.physics?.body ?? truck.physics?.body;
          if (body) {
            // Clear all accumulated forces and velocities in the physics body
            body.setLinearVelocity(Vector3.Zero());
            body.setAngularVelocity(Vector3.Zero());
            // Reset position to clear any drift
            body.transformNode.position.copyFrom(currentPos);
            body.transformNode.rotation.copyFrom(truck.mesh.rotation);
          }
          
          // Reset velocities
          truck.state.velocity.setAll(0);
          truck.state.velocity.y = 0;
          
          // Reset suspension state
          truck.state.suspensionCompression = 0;
          truck.state.suspensionVelocity = 0;
        });
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    this.visibilityHandler = handleVisibilityChange;
  }

  /**
   * Cleanup visibility handler. Called automatically by teardown().
   */
  cleanupVisibilityHandler() {
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  /**
   * Wire the \ key to toggle the debug panel via a DebugManager.
   */
  setupDebugToggle(inputManager, debugManager) {
    inputManager.onToggleDebug(() => debugManager.toggle());
  }

  /**
   * Base teardown - cleans up common resources.
   * Subclasses should call super.teardown() after their own cleanup.
   */
  teardown() {
    this.cleanupVisibilityHandler();
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
    }
  }
}
