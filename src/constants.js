import { Color3 } from "@babylonjs/core";

export const TRUCK_HEIGHT = 0.8; // full box height (0.8)
export const TRUCK_HALF_HEIGHT = TRUCK_HEIGHT / 2; // half of box height (0.8)
export const TRUCK_WIDTH = 1.5; // full box width (1.5)
export const TRUCK_DEPTH = 3.0; // full box depth (3.0)
export const TRUCK_RADIUS = Math.sqrt((TRUCK_WIDTH/2)**2 + (TRUCK_DEPTH/2)**2); // half-diagonal of 1.5×3.0 box, for collision purposes

export const basicColors = {
  black: { diffuse: new Color3(0.04, 0.04, 0.04), emissive: new Color3(0.0, 0.0, 0.0) },  // X
  gray: { diffuse: new Color3(0.45, 0.45, 0.45), emissive: new Color3(0.1, 0.1, 0.1) },  // X
  white: { diffuse: new Color3(0.95, 0.95, 0.95), emissive: new Color3(0.04, 0.04, 0.04) }, // X
  red: { diffuse: new Color3(1.0, 0.35, 0.35), emissive: new Color3(0.55, 0.12, 0.12) },  // X
  blue: { diffuse: new Color3(0.2, 0.6, 0.9), emissive: new Color3(0.05, 0.15, 0.3) },  // X
  yellow: { diffuse: new Color3(1.0, 1.0, 0.2), emissive: new Color3(0.6, 0.6, 0.0) },  // X
  cyan: { diffuse: new Color3(0.0, 1.0, 1.0), emissive: new Color3(0.0, 0.5, 0.5) },  // X
  teal: { diffuse: new Color3(0.2, 1.0, 0.9), emissive: new Color3(0.05, 0.40, 0.35) }, // X
  magenta: { diffuse: new Color3(1.0, 0.5, 1.0), emissive: new Color3(0.4, 0.2, 0.4) }, // X
  orange: { diffuse: new Color3(0.9, 0.5, 0.2), emissive: new Color3(0.3, 0.15, 0.05) },
  green: { diffuse: new Color3(0.6, 0.8, 0.3), emissive: new Color3(.2, 0.3, 0.1) },  // X
  purple: { diffuse: new Color3(0.8, 0.4, 0.9), emissive: new Color3(0.15, 0.08, 0.18) }, // X
  pink: { diffuse: new Color3(1.0, 0.20, 0.60), emissive: new Color3(0.25, 0.04, 0.15) }, // X
  brown: { diffuse: new Color3(0.28, 0.22, 0.16), emissive: new Color3(0.08, 0.08, 0.08) },
};

export const TERRAIN_COLORS = {
  asphalt: new Color3(0.2, 0.2, 0.25),
  packed_dirt: new Color3(0.54, 0.28, 0.08),
  loose_dirt: new Color3(0.60, 0.34, 0.14),
  mud: new Color3(0.34, 0.18, 0.08),
  water: new Color3(0.34, 0.18, 0.08),
  rocky: new Color3(0.42, 0.30, 0.22),
  grass: new Color3(0.05, 0.4, 0.1),
};

export const TRACK_SIGN_BRANDS = [
  { value: 'energizer-racing.png', label: 'Energizer Racing' },
  { value: 'turbo-king.png', label: 'Turbo King' },
  { value: 'ultra-grip.png', label: 'Ultra Grip' },
  { value: 'luck-dice.png', label: 'Luck Dice' },
  { value: 'phoenix-auto.png', label: 'Phoenix Auto' },
  { value: 'power-lube.png', label: 'Power Lube' },
  { value: 'rally-master.png', label: 'Rally Master' },
  { value: 'rocket-gasoline.png', label: 'Rocket Gasoline' },
  { value: 'roll-fast.png', label: 'Roll Fast' },
  { value: 'turbo-blend.png', label: 'Turbo Blend' },
];
