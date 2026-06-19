import { MeshBuilder, Vector3, Color3, StandardMaterial } from '@babylonjs/core';
import { useDebugStore } from '../vue/store.js';
import { DEFAULT_HANDLING, resolveHandling } from '../truck/DriftTuning.js';

// Handling knobs and direct params surfaced in the vehicle debug overlay.
const VEHICLE_KNOB_KEYS  = ['driftEnter', 'driftMaintain', 'lateralBias', 'driftExit'];
const VEHICLE_PARAM_KEYS = ['grip', 'turnSpeed', 'weightTransfer'];

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
 *            penetration, vvel, groundedness, speed, slope,
 *            surfaceId, surfaceType, surfaceKind, surfaceLevel
 */
export class DebugManager {
  /** @param {import('@babylonjs/core').Scene} scene */
  constructor(scene = null) {
    this._store = useDebugStore();
    this._store.setBridge(this);
    this._scene = scene;
    this._normalArrow  = null;  // Lines mesh — created on first show, disposed on hide
    this._trackedTruck = null;  // truck whose physics box we toggled visible
    this._truck        = null;  // current player truck (for the vehicle overlay)
    this._colliderDebugMat = null;
    this._colliderDebugState = new Map(); // mesh.uniqueId -> { mesh, isVisible, visibility, material }
    this._bridgeDriveDebugEnabled = false;
    this._bridgeDriveDebugMat = null;
    this._bridgeDriveDebugState = new Map(); // mesh.uniqueId -> { mesh, isVisible, visibility, material }

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

  setBridgeDriveSurfaceDebug(enabled) {
    this._bridgeDriveDebugEnabled = enabled === true;
    if (!this._bridgeDriveDebugEnabled) {
      this._restoreBridgeDriveDebugMeshes();
    }
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
  // Vehicle handling overlay (called via store bridge from VehicleDebugOverlay)
  // ---------------------------------------------------------------------------

  /** Toggle the handling overlay; on open, seed the sliders from the live truck. */
  toggleVehicleOverlay() {
    const next = !this._store.vehicleVisible;
    this._store.vehicleVisible = next;
    if (next) this._syncVehicleStoreFromTruck();
  }

  hideVehicleOverlay() { this._store.vehicleVisible = false; }

  /** Copy the current state's handling + key params into the store sliders. */
  _syncVehicleStoreFromTruck() {
    const truck = this._truck;
    if (!truck?.state) return;
    const v = this._store.vehicle;
    const handling = { ...DEFAULT_HANDLING, ...(truck.state.handling ?? {}) };
    for (const k of VEHICLE_KNOB_KEYS) v[k] = handling[k];
    for (const k of VEHICLE_PARAM_KEYS) v[k] = truck.state[k];
    v.name = truck.vehicleDef?.name ?? truck.vehicleDef?.id ?? 'Vehicle';
    v.resolved = resolveHandling(handling);
  }

  /** Re-resolve the 4 knobs and push the low-level drift params onto the truck. */
  applyVehicleHandling() {
    const truck = this._truck;
    if (!truck?.state) return;
    const v = this._store.vehicle;
    const handling = {
      driftEnter: v.driftEnter,
      driftMaintain: v.driftMaintain,
      lateralBias: v.lateralBias,
      driftExit: v.driftExit,
    };
    const resolved = resolveHandling(handling);
    truck.state.handling = handling;
    Object.assign(truck.state, resolved);
    v.resolved = resolved;
  }

  /** Write a direct handling param (grip/turnSpeed/weightTransfer) onto the truck. */
  applyVehicleParam(key, val) {
    const truck = this._truck;
    if (!truck?.state || !VEHICLE_PARAM_KEYS.includes(key)) return;
    truck.state[key] = val;
  }

  /** Restore the overlay (and truck) to the vehicle definition's saved values. */
  resetVehicleHandling() {
    const truck = this._truck;
    if (!truck?.state) return;
    const handling = { ...DEFAULT_HANDLING, ...(truck.vehicleDef?.handling ?? {}) };
    const params = truck.vehicleDef?.params ?? {};
    for (const k of VEHICLE_PARAM_KEYS) {
      if (params[k] !== undefined) truck.state[k] = params[k];
    }
    truck.state.handling = handling;
    Object.assign(truck.state, resolveHandling(handling));
    this._syncVehicleStoreFromTruck();
  }

  /** Copy a paste-ready vehicle JSON snippet (handling + tuned params) to clipboard. */
  copyVehicleJson() {
    const v = this._store.vehicle;
    const round = (n, p = 3) => Math.round(n * 10 ** p) / 10 ** p;
    const snippet = {
      handling: {
        driftEnter: round(v.driftEnter, 2),
        driftMaintain: round(v.driftMaintain, 2),
        lateralBias: round(v.lateralBias, 2),
        driftExit: round(v.driftExit, 2),
      },
      params: {
        grip: round(v.grip, 3),
        turnSpeed: round(v.turnSpeed, 2),
        weightTransfer: round(v.weightTransfer, 2),
      },
    };
    const text = JSON.stringify(snippet, null, 2);
    navigator.clipboard?.writeText(text).catch(() => {});
    console.log('[DebugManager] Vehicle handling JSON:\n' + text);
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
      // this._trackedTruck.body?.setVisible(true);
      this._trackedTruck = null;
    }

    // Restore collision debug meshes to their original state.
    for (const saved of this._colliderDebugState.values()) {
      const mesh = saved.mesh;
      if (!mesh || mesh.isDisposed()) continue;
      mesh.isVisible = saved.isVisible;
      mesh.visibility = saved.visibility;
      mesh.material = saved.material;
    }
    this._colliderDebugState.clear();
    this._colliderDebugMat?.dispose();
    this._colliderDebugMat = null;

    this._store.showBridgeDriveSurfaces = false;
    this._bridgeDriveDebugEnabled = false;
    this._restoreBridgeDriveDebugMeshes();
    this._bridgeDriveDebugMat?.dispose();
    this._bridgeDriveDebugMat = null;
  }

  _ensureColliderDebugMaterial() {
    if (this._colliderDebugMat || !this._scene) return;
    const mat = new StandardMaterial('dbgTruckColliderMat', this._scene);
    mat.diffuseColor = new Color3(1.0, 0.15, 0.75);
    mat.emissiveColor = new Color3(0.9, 0.1, 0.65);
    mat.alpha = 0.35;
    mat.wireframe = false;
    mat.backFaceCulling = false;
    this._colliderDebugMat = mat;
  }

  _updateCollisionDebugMeshes() {
    if (!this._scene) return;
    this._ensureColliderDebugMaterial();

    const colliders = this._scene.meshes.filter(mesh =>
      mesh?.metadata?.truckCollider === true &&
      !mesh.isDisposed() &&
      mesh.isEnabled()
    );

    // Add / refresh currently active colliders.
    for (const mesh of colliders) {
      if (!this._colliderDebugState.has(mesh.uniqueId)) {
        this._colliderDebugState.set(mesh.uniqueId, {
          mesh,
          isVisible: mesh.isVisible,
          visibility: mesh.visibility,
          material: mesh.material,
        });
      }

      mesh.isVisible = true;
      mesh.visibility = 1;
      mesh.material = this._colliderDebugMat;
    }

    // Restore meshes that are no longer truck colliders.
    for (const [id, saved] of this._colliderDebugState.entries()) {
      const mesh = saved.mesh;
      if (!mesh || mesh.isDisposed()) {
        this._colliderDebugState.delete(id);
        continue;
      }
      if (mesh.metadata?.truckCollider === true) continue;

      mesh.isVisible = saved.isVisible;
      mesh.visibility = saved.visibility;
      mesh.material = saved.material;
      this._colliderDebugState.delete(id);
    }
  }

  _ensureBridgeDriveDebugMaterial() {
    if (this._bridgeDriveDebugMat || !this._scene) return;
    const mat = new StandardMaterial('dbgBridgeDriveSurfaceMat', this._scene);
    mat.diffuseColor = new Color3(0.1, 0.9, 1.0);
    mat.emissiveColor = new Color3(0.1, 0.5, 0.7);
    mat.alpha = 0.45;
    mat.backFaceCulling = false;
    this._bridgeDriveDebugMat = mat;
  }

  _restoreBridgeDriveDebugMeshes() {
    for (const [id, saved] of this._bridgeDriveDebugState.entries()) {
      const mesh = saved.mesh;
      if (!mesh || mesh.isDisposed()) {
        this._bridgeDriveDebugState.delete(id);
        continue;
      }
      mesh.isVisible = saved.isVisible;
      mesh.visibility = saved.visibility;
      mesh.material = saved.material;
      this._bridgeDriveDebugState.delete(id);
    }
  }

  _updateBridgeDriveDebugMeshes() {
    if (!this._scene) return;
    if (!this._bridgeDriveDebugEnabled) {
      this._restoreBridgeDriveDebugMeshes();
      return;
    }

    this._ensureBridgeDriveDebugMaterial();

    const driveMeshes = this._scene.meshes.filter(mesh =>
      !mesh.isDisposed() &&
      mesh.isEnabled() &&
      typeof mesh.name === 'string' &&
      mesh.name.startsWith('bridge_drive_')
    );

    for (const mesh of driveMeshes) {
      if (!this._bridgeDriveDebugState.has(mesh.uniqueId)) {
        this._bridgeDriveDebugState.set(mesh.uniqueId, {
          mesh,
          isVisible: mesh.isVisible,
          visibility: mesh.visibility,
          material: mesh.material,
        });
      }

      mesh.isVisible = true;
      mesh.visibility = 1;
      mesh.material = this._bridgeDriveDebugMat;
    }

    for (const [id, saved] of this._bridgeDriveDebugState.entries()) {
      const mesh = saved.mesh;
      if (!mesh || mesh.isDisposed()) {
        this._bridgeDriveDebugState.delete(id);
        continue;
      }
      if (typeof mesh.name === 'string' && mesh.name.startsWith('bridge_drive_')) continue;

      mesh.isVisible = saved.isVisible;
      mesh.visibility = saved.visibility;
      mesh.material = saved.material;
      this._bridgeDriveDebugState.delete(id);
    }
  }

  /**
   * Editor-mode helper: update only static collision debug geometry.
   * Useful when no Truck/debugInfo is available.
   */
  updateCollisionDebugOnly() {
    if (!this._store.visible) return;
    this._updateCollisionDebugMeshes();
    this._updateBridgeDriveDebugMeshes();
    this._updateTopologyDebugFields();
  }

  _updateTopologyDebugFields() {
    const d = this._store.data;
    const topologyGraph = this._scene?.metadata?.surfaceTopologyGraph ?? null;
    const topologyNodes = topologyGraph?.getAllNodes?.() ?? [];
    const topologyConnectors = topologyGraph?.getAllConnectors?.() ?? [];
    const topologyValidation = topologyGraph?.validate?.() ?? { issues: [], valid: true };
    const connectorEndpointNodes = topologyNodes.filter(node => node?.kind === 'bridge-mesh-connector-endpoint');
    const autoLinkedNodeIds = new Set();
    let terrainLinkCount = 0;
    let bridgeLinkCount = 0;
    for (const connector of topologyConnectors) {
      if (connector?.tags?.autoLinked !== true) continue;
      if (Number.isFinite(connector.fromNodeId)) autoLinkedNodeIds.add(connector.fromNodeId);
      if (Number.isFinite(connector.toNodeId)) autoLinkedNodeIds.add(connector.toNodeId);
      const autoLinkMode = String(connector?.tags?.autoLinkMode ?? '');
      if (autoLinkMode.startsWith('terrain-')) {
        terrainLinkCount += 1;
      } else if (autoLinkMode === 'proximity') {
        bridgeLinkCount += 1;
      }
    }
    const linkedEndpointCount = connectorEndpointNodes.reduce((count, node) => (
      autoLinkedNodeIds.has(node.nodeId) ? count + 1 : count
    ), 0);
    const unlinkedEndpointCount = Math.max(0, connectorEndpointNodes.length - linkedEndpointCount);
    const connectorSummary = topologyConnectors.length > 0
      ? Object.entries(topologyConnectors.reduce((counts, connector) => {
          const type = String(connector?.type ?? 'unknown');
          counts[type] = (counts[type] ?? 0) + 1;
          return counts;
        }, {}))
        .map(([type, count]) => `${type}:${count}`)
        .join(' ')
      : '-';
    const issueSummary = topologyValidation.issues.length > 0
      ? Object.entries(topologyValidation.issues.reduce((counts, issue) => {
          const type = String(issue?.type ?? 'unknown');
          counts[type] = (counts[type] ?? 0) + 1;
          return counts;
        }, {}))
        .map(([type, count]) => `${type}:${count}`)
        .join(' ')
      : '-';

    d.topologyNodes = String(topologyNodes.length);
    d.topologyConnectors = String(topologyConnectors.length);
    d.topologyAutoLinked = `${linkedEndpointCount}`;
    d.topologyAutoUnlinked = `${unlinkedEndpointCount}`;
    d.topologyTerrainLinks = `${terrainLinkCount}`;
    d.topologyBridgeLinks = `${bridgeLinkCount}`;
    d.topologySummary = topologyValidation.issues.length > 0
      ? `issues:${topologyValidation.issues.length} ${issueSummary} ${connectorSummary}`
      : connectorSummary;
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
    // Track the player truck even when the terrain debug panel is hidden, so the
    // vehicle handling overlay can tune it independently.
    if (truck) this._truck = truck;

    if (!this._store.visible) return;

    // Keep collider visualisation in sync while debug is enabled.
    this._updateCollisionDebugMeshes();
    this._updateBridgeDriveDebugMeshes();
    this._updateTopologyDebugFields();

    if (!debugInfo) return;

    // ---- 3-D visuals --------------------------------------------------------
    if (truck && truck !== this._trackedTruck) {
      if (this._trackedTruck) {
        this._trackedTruck.mesh.isVisible = false;
        this._trackedTruck.body?._visualRoot && (this._trackedTruck.body._visualRoot.isVisible = true);
        this._trackedTruck.body?._wheelRoot && (this._trackedTruck.body._wheelRoot.isVisible = true);
      }
      truck.mesh.isVisible = true;
      truck.mesh.showBoundingBox = false;
      truck.body?._visualRoot && (truck.body._visualRoot.isVisible = false);
      truck.body?._wheelRoot && (truck.body._wheelRoot.isVisible = false);
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
    d.surfaceId    = String(debugInfo.surfaceId ?? '-');
    d.surfaceType  = String(debugInfo.surfaceType ?? '-');
    d.surfaceKind  = String(debugInfo.surfaceKind ?? '-');
    d.surfaceLevel = String(debugInfo.surfaceLevel ?? '-');

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
        surfaceId:    debugInfo.surfaceId ?? '-',
        surfaceType:  debugInfo.surfaceType ?? '-',
        surfaceKind:  debugInfo.surfaceKind ?? '-',
        surfaceLevel: debugInfo.surfaceLevel ?? '-',
      };

      this._log[this._logPtr] = row;
      this._logPtr = (this._logPtr + 1) % LOG_CAPACITY;
      this._store.frameCount++;
    }
  }
}
