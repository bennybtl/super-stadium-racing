import { MeshBuilder, Vector3, Color3 } from '@babylonjs/core';
import { useDebugStore } from '../vue/store.js';

// Maximum frames kept in the ring buffer (~20 s at 60 fps).
const LOG_CAPACITY = 1200;

/**
 * DebugManager – owns the debug overlay lifecycle.
 *
 * Toggled by the \ key via InputManager.onToggleDebug.
 * When the panel is hidden, update() is a no-op so there is zero per-frame
 * cost from slope sampling or store writes.
 *
 * When visible, two extra scene objects are activated on the player truck:
 *   • The normally-invisible physics box mesh becomes visible.
 *   • A coloured line arrow is drawn from the truck centre in the direction of
 *     the resolved floor normal, so flipping/jitter is immediately obvious.
 *
 * LOGGING
 *   startRecording() begins accumulating one row per frame into a ring buffer
 *   (capped at LOG_CAPACITY frames).  dumpLog() prints console.table() and
 *   triggers a CSV download so the data can be pasted into a spreadsheet.
 *   Columns: t, x, y, z, fromY, floorY, rayDepth, nx, ny, nz,
 *            penetration, vvel, groundedness, speed, slope
 */
export class DebugManager {
  /** @param {import('@babylonjs/core').Scene} scene */
  constructor(scene = null) {
    this._store = useDebugStore();
    this._store.setBridge(this);
    this._scene = scene;
    this._normalArrow  = null;  // Lines mesh — created on first show, disposed on hide
    this._trackedTruck = null;  // truck whose physics box we toggled visible

    // ---- Logger state ----
    this._log        = [];     // ring buffer rows
    this._logPtr     = 0;     // next write index (circular)
    this._recording  = false;
    this._recordStart = 0;    // performance.now() at startRecording()
  }

  get isEnabled() { return this._store.visible; }

  toggle() {
    if (this._store.visible) {
      this._store.visible = false;
      this._destroyVisuals();
    } else {
      this._store.visible = true;
    }
  }

  show() { this._store.visible = true; }

  hide() {
    this._store.visible = false;
    this._destroyVisuals();
  }

  // ---------------------------------------------------------------------------
  // Logger public API (called via store bridge from DebugPanel)
  // ---------------------------------------------------------------------------

  startRecording() {
    this._log        = new Array(LOG_CAPACITY);
    this._logPtr     = 0;
    this._recording  = true;
    this._recordStart = performance.now();
    this._store.recording  = true;
    this._store.frameCount = 0;
    console.log('[DebugManager] Recording started.');
  }

  stopRecording() {
    this._recording       = false;
    this._store.recording = false;
    console.log(`[DebugManager] Recording stopped — ${this._store.frameCount} frames captured.`);
  }

  /**
   * Emit the captured frames as console.table() and download a CSV file.
   * Frames are output in chronological order regardless of ring-buffer wrap.
   */
  dumpLog() {
    const total = Math.min(this._store.frameCount, LOG_CAPACITY);
    if (total === 0) { console.warn('[DebugManager] No frames recorded yet.'); return; }

    // Reconstruct chronological order from circular buffer.
    const rows = [];
    const start = this._store.frameCount > LOG_CAPACITY
      ? this._logPtr          // oldest slot after wrap
      : 0;
    for (let i = 0; i < total; i++) {
      const row = this._log[(start + i) % LOG_CAPACITY];
      if (row) rows.push(row);
    }

    console.table(rows);

    // Build CSV and trigger browser download.
    const headers = Object.keys(rows[0]).join(',');
    const lines   = rows.map(r => Object.values(r).join(','));
    const csv     = [headers, ...lines].join('\n');
    const blob    = new Blob([csv], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `terrain_log_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    console.log(`[DebugManager] Dumped ${rows.length} frames.`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _createArrowIfNeeded() {
    if (this._normalArrow || !this._scene) return;
    this._normalArrow = MeshBuilder.CreateLines(
      'dbgNormalArrow',
      { points: [Vector3.Zero(), Vector3.Up().scaleInPlace(3)], updatable: true },
      this._scene
    );
    this._normalArrow.color = new Color3(0, 1, 0.4);
    this._normalArrow.isPickable = false;
  }

  _destroyVisuals() {
    if (this._normalArrow) {
      this._normalArrow.dispose();
      this._normalArrow = null;
    }
    if (this._trackedTruck) {
      this._trackedTruck.mesh.isVisible = false;
      this._trackedTruck.body?.setVisible(true);
      this._trackedTruck = null;
    }
  }

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

    // ---- 3-D visuals --------------------------------------------------------
    if (truck && truck !== this._trackedTruck) {
      if (this._trackedTruck) {
        this._trackedTruck.mesh.isVisible = false;
        this._trackedTruck.body?.setVisible(true);
      }
      truck.mesh.isVisible = true;
      truck.mesh.showBoundingBox = false;
      truck.body?.setVisible(false);
      this._trackedTruck = truck;
    }

    // Normal arrow — draws from truck centre in the direction of the floor normal.
    const normal = truck?.terrainPhysics?.floorNormal;
    if (normal && truck) {
      this._createArrowIfNeeded();
      if (this._normalArrow) {
        const base = truck.mesh.position.clone();
        const tip  = base.add(normal.scale(3));
        MeshBuilder.CreateLines('dbgNormalArrow', {
          points: [base, tip],
          instance: this._normalArrow,
        });
      }
    }

    // ---- HUD data -----------------------------------------------------------
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
    d.nx           = (normal?.x ?? 0).toFixed(3);
    d.ny           = (normal?.y ?? 1).toFixed(3);
    d.nz           = (normal?.z ?? 0).toFixed(3);

    // ---- Ring-buffer logger -------------------------------------------------
    if (this._recording) {
      const floorY  = truck.terrainPhysics?.lastFloorY ?? 0;
      const fromY   = truck.mesh.position.y + 0.1;
      const row = {
        t:            +(performance.now() - this._recordStart).toFixed(1),
        x:            +truck.mesh.position.x.toFixed(3),
        y:            +truck.mesh.position.y.toFixed(3),
        z:            +truck.mesh.position.z.toFixed(3),
        fromY:        +fromY.toFixed(3),
        floorY:       +floorY.toFixed(3),
        rayDepth:     +(fromY - floorY).toFixed(3),
        nx:           +(normal?.x ?? 0).toFixed(4),
        ny:           +(normal?.y ?? 1).toFixed(4),
        nz:           +(normal?.z ?? 0).toFixed(4),
        penetration:  +(debugInfo.penetration      ?? 0).toFixed(4),
        vvel:         +(debugInfo.verticalVelocity ?? 0).toFixed(3),
        groundedness: +(debugInfo.groundedness     ?? 0).toFixed(3),
        speed:        +(debugInfo.speed            ?? 0).toFixed(2),
        slope:        slopeDeg !== null ? +slopeDeg.toFixed(2) : 0,
      };

      this._log[this._logPtr] = row;
      this._logPtr = (this._logPtr + 1) % LOG_CAPACITY;
      this._store.frameCount++;
    }
  }
}
