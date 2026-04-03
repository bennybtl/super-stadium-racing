import { Truck } from "./truck.js";
import { PhysicsTruck } from "./PhysicsTruck.js";
import { TruckMode } from "../constants.js";

/**
 * Factory function to create a truck based on the selected mode
 * 
 * @param {string} mode - TruckMode.ARCADE or TruckMode.PHYSICS
 * @param {Scene} scene - Babylon scene
 * @param {ShadowGenerator} shadows - Shadow generator
 * @param {Color3} diffuseColor - Truck body color
 * @param {AIDriver} driver - Optional AI driver
 * @param {Vector3} spawnPos - Optional spawn position
 * @returns {Object} - Wrapped truck instance compatible with updateTruck
 */
export function createTruckForMode(mode, scene, shadows, diffuseColor = null, driver = null, spawnPos = null) {
  const truck = mode === TruckMode.PHYSICS
    ? new PhysicsTruck(scene, shadows, diffuseColor, driver, spawnPos)
    : new Truck(scene, shadows, diffuseColor, driver, spawnPos);
  
  return {
    mesh: truck.mesh,
    state: truck.state,
    particles: truck.particles.driftParticles,
    splashParticles: truck.particles.splashParticles,
    physics: truck.physics,
    aiDriver: truck.driver,
    _truckInstance: truck
  };
}

/**
 * Legacy factory function - creates arcade truck by default
 * Maintains backward compatibility
 */
export function createTruck(scene, shadows, diffuseColor = null, driver = null, spawnPos = null) {
  const truck = new Truck(scene, shadows, diffuseColor, driver, spawnPos);
  return {
    mesh: truck.mesh,
    state: truck.state,
    particles: truck.particles.driftParticles,
    splashParticles: truck.particles.splashParticles,
    physics: truck.physics,
    aiDriver: truck.driver,
    _truckInstance: truck
  };
}

export function updateTruck(truck, input, deltaTime, terrainManager = null, track = null) {
  if (truck._truckInstance) {
    return truck._truckInstance.update(input, deltaTime, terrainManager, track);
  }
  throw new Error("Truck instance not found. Use new Truck class.");
}
