import { createBillboardTextPlane, drawCenteredText } from "./billboardText.js";

// Transient world-space popups (e.g. "+$500" when a coin is grabbed). Each is a
// camera-facing plane textured with the text that rises and fades, then self-
// disposes. Same billboard + DynamicTexture approach as RacePositionLabels, but
// short-lived and animated rather than pinned to a truck.

const TEX_W = 256;
const TEX_H = 128;
const PLANE_W = 3.0;
const PLANE_H = 1.5;
const RISE_SPEED = 0.5;        // world units / sec upward drift
const LIFETIME = 3.0;          // seconds until fully faded/disposed
const START_Y_OFFSET = 3.2;    // spawn height above the given position

export class FloatingTextManager {
  constructor(scene) {
    this.scene = scene;
    this._items = [];
  }

  /** Spawn a rising, fading text popup at (world) `position`. */
  spawn(text, position, color = '#EFEFEF') {
    const { plane, tex, mat } = createBillboardTextPlane(this.scene, {
      name: 'floatText',
      width: PLANE_W,
      height: PLANE_H,
      texWidth: TEX_W,
      texHeight: TEX_H,
    });
    plane.position.set(position.x, position.y + START_Y_OFFSET, position.z);

    drawCenteredText(tex, text, {
      color,
      font: `bold ${Math.round(TEX_H * 0.5)}px sans-serif`,
      // Dark outline keeps it legible over any terrain colour.
      outline: { width: Math.round(TEX_H * 0.09), color: 'rgba(0,0,0,0.85)' },
    });

    this._items.push({ plane, tex, mat, age: 0 });
  }

  /** Advance the drift/fade of active popups; dispose any that have expired. */
  update(dt) {
    if (this._items.length === 0) return;
    const alive = [];
    for (const it of this._items) {
      it.age += dt;
      if (it.age >= LIFETIME) {
        this._disposeItem(it);
        continue;
      }
      it.plane.position.y += RISE_SPEED * dt;
      it.mat.alpha = 1 - it.age / LIFETIME; // linear fade to transparent
      alive.push(it);
    }
    this._items = alive;
  }

  _disposeItem(it) {
    it.mat.dispose();
    it.tex.dispose();
    it.plane.dispose();
  }

  clearAll() {
    for (const it of this._items) this._disposeItem(it);
    this._items = [];
  }

  dispose() {
    this.clearAll();
  }
}
