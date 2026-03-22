/**
 * Truck module - refactored into class-based structure
 * 
 * This file maintains backward compatibility by re-exporting
 * the factory functions from the new Truck class.
 */

export { Truck } from "./truck/truck.js";
export { createTruck, updateTruck } from "./truck/truck.js";
