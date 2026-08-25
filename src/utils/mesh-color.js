import { Color3 } from "@babylonjs/core";

/** Parse a colour value: [r,g,b] (0..1) or a "#rrggbb"/"rrggbb" hex string. Returns null if invalid. */
export function parseColorValue(value) {
  if (Array.isArray(value) && value.length === 3) {
    return new Color3(value[0], value[1], value[2]);
  }
  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
      const n = parseInt(hex, 16);
      return new Color3(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
    }
  }
  return null;
}
