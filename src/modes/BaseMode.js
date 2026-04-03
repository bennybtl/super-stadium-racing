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
   * Reset a truck's physics state to prevent gravity accumulation.
   * Call this after truck creation to neutralize any forces accumulated
   * during async scene setup.
   */
  resetTruckPhysics(truck, position) {
    truck.mesh.position.copyFrom(position);
    truck.state.velocity.setAll(0);
    truck.state.verticalVelocity = 0;
    
    // Reset physics body (works for both arcade and physics trucks)
    const body = truck._truckInstance?.physics?.body ?? truck.physics?.body;
    if (body) {
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
  }

  /**
   * Setup visibility change handler to pause physics when tab is hidden.
   * This prevents physics accumulation in the background which causes
   * trucks to "launch" when the tab becomes visible again.
   */
  setupVisibilityHandler(scene, trucks) {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is hidden - pause physics to prevent accumulation
        if (scene.physicsEnabled) {
          scene.getPhysicsEngine().setTimeStep(0);
        }
      } else {
        // Tab is visible - resume physics
        if (scene.physicsEnabled) {
          scene.getPhysicsEngine().setTimeStep(1/60);
        }
        // Reset all truck velocities to prevent launch effect
        const truckArray = Array.isArray(trucks) ? trucks : [trucks];
        truckArray.forEach((truckOrData) => {
          const truck = truckOrData.truck || truckOrData;
          truck.state.velocity.setAll(0);
          truck.state.verticalVelocity = 0;
          const body = truck._truckInstance?.physics?.body ?? truck.physics?.body;
          if (body) {
            body.setLinearVelocity(Vector3.Zero());
            body.setAngularVelocity(Vector3.Zero());
          }
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
