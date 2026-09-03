import { Color3 } from "@babylonjs/core";

/**
 * Coerce a colour in any of the shapes the codebase stores them in — a Color3,
 * an `[r,g,b]` array (0..1), a `"#rrggbb"` / `"rrggbb"` hex string, a `{r,g,b}`
 * object, or a `{ diffuse: { r,g,b } }` material-ish object — into a fresh
 * Color3. Returns `null` when the value isn't a recognisable colour; callers
 * supply their own fallback with `?? …`.
 */
export function parseColorValue(value) {
  if (value instanceof Color3) return value.clone();

  if (Array.isArray(value) && value.length >= 3) {
    return new Color3(value[0], value[1], value[2]);
  }

  if (typeof value === "string") {
    const hex = value.trim().replace(/^#/, "");
    if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
      const n = parseInt(hex, 16);
      return new Color3(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
    }
    return null;
  }

  if (value && typeof value === "object") {
    if (value.diffuse && value.diffuse.r != null) {
      return new Color3(value.diffuse.r, value.diffuse.g, value.diffuse.b);
    }
    if (value.r != null) return new Color3(value.r, value.g, value.b);
  }

  return null;
}
