import { useDebugStore } from '../vue/store.js';

/**
 * DebugManager – owns the debug overlay lifecycle.
 *
 * Toggled by the \ key via InputManager.onToggleDebug.
 * When the panel is hidden, update() is a no-op so there is zero per-frame
 * cost from slope sampling or store writes.
 */
export class DebugManager {
  constructor() {
    this._store = useDebugStore();
  }

  get isEnabled() { return this._store.visible; }

  toggle() { this._store.visible = !this._store.visible; }
  show()   { this._store.visible = true; }
  hide()   { this._store.visible = false; }

  /**
   * Update all debug fields. Skips entirely when the panel is hidden.
   *
   * @param {object} debugInfo     - return value from truck.update()
   * @param {object} terrainManager
   * @param {Track}  track
   * @param {Truck}  truck         - player truck instance
   */
  update(debugInfo, terrainManager, track, truck) {
    if (!this._store.visible || !debugInfo) return;

    const slopeDeg = track
      ? track.getTerrainSlopeAt(
          truck.mesh.position.x,
          truck.mesh.position.z,
          truck.state.heading,
          1, 4
        )
      : null;

    const d = this._store.data;
    d.compression  = (debugInfo.compression        ?? 0).toFixed(2);
    d.groundedness = (debugInfo.groundedness        ?? 0).toFixed(2);
    d.penetration  = (debugInfo.penetration         ?? 0).toFixed(3);
    d.vvel         = (debugInfo.verticalVelocity    ?? 0).toFixed(2);
    d.speed        = (debugInfo.speed               ?? 0).toFixed(2);
    d.grip         = (debugInfo.effectiveGrip       ?? 0).toFixed(3);
    d.slip         = ((debugInfo.slipAngle ?? 0) * 180 / Math.PI).toFixed(1) + '°';
    d.terrain      = terrainManager?.getTerrainAt(truck.mesh.position)?.name ?? 'dirt';
    d.slope        = slopeDeg !== null ? slopeDeg.toFixed(1) + '°' : '-';
    d.x            = truck.mesh.position.x.toFixed(2);
    d.y            = truck.mesh.position.y.toFixed(2);
    d.z            = truck.mesh.position.z.toFixed(2);
  }
}
