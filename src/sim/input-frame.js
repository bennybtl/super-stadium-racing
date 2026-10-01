/**
 * The network input frame — `{ s: steer -1..1, g: throttle -1..1, b: boost
 * held, r: respawn held }` — and its mapping onto the truck's controls. Shared
 * by the server (server/lobby/inputs.js) and a predicting client
 * (src/net/Prediction.js): both must turn a frame into exactly the same truck
 * input, or prediction drifts.
 */

// Analog → the truck's digital controls (throttle is on/off in the sim today).
const THROTTLE_DEADZONE = 0.1;
const STEER_DEADZONE = 0.1;

export const NEUTRAL_FRAME = Object.freeze({ s: 0, g: 0, b: false, r: false });

/** The truck-input object Truck.updateSim expects, from a frame. */
export function toTruckInput(frame) {
  return {
    forward: frame.g > THROTTLE_DEADZONE,
    back: frame.g < -THROTTLE_DEADZONE,
    left: frame.s < -STEER_DEADZONE,
    right: frame.s > STEER_DEADZONE,
    steer: Math.abs(frame.s) > STEER_DEADZONE ? frame.s : 0,
  };
}
