export const TRUCK_HEIGHT = 0.8; // full box height (0.8)
export const TRUCK_HALF_HEIGHT = TRUCK_HEIGHT / 2; // half of box height (0.8)
export const TRUCK_WIDTH = 1.5; // full box width (1.5)
export const TRUCK_DEPTH = 3.0; // full box depth (3.0)
export const TRUCK_RADIUS = Math.sqrt((TRUCK_WIDTH/2)**2 + (TRUCK_DEPTH/2)**2); // half-diagonal of 1.5×3.0 box, for collision purposes

// Truck modes
export const TruckMode = {
  ARCADE: 'arcade',
  PHYSICS: 'physics'
};
