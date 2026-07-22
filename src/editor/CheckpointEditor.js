import { Vector3 } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';

/**
 * CheckpointEditor – encapsulates all checkpoint editing logic that was
 * previously inline in EditorController.  The parent controller is passed as
 * `editor` so we can access shared helpers (scene, camera, track, snap,
 * snapshots, store, checkpointManager …).
 */
export class CheckpointEditor {
  constructor(editor) {
    /** @type {import('./EditorController.js').EditorController} */
    this.editor = editor;

    // Selection state
    this.selected = null;

    // Materials (set in createMaterials)
    this.highlightMaterial = null;
  }

  /** Create (or recreate) shared materials for the current scene. */
  createMaterials() {
    const m = EditorMaterials.for(this.editor.scene);
    // Same grey click-target handle as the hill gizmos — shares their selected material.
    this.highlightMaterial = m.handleSphereHighlight;
  }

  /** Dispose all gizmo spheres and reset state. */
  dispose() {
    this.deselect();
  }

  /**
   * Rebuild all checkpoint meshes from features after an undo/redo snapshot.
   * The CheckpointManager owns the meshes, so we dispose and recreate via it.
   */
  rebuildFromFeatures() {
    const mgr = this.editor.checkpointManager;
    if (!mgr) return;
    this.deselect();
    mgr.dispose?.();
    for (const feature of this.editor.currentTrack.features) {
      if (feature.type === 'checkpoint') {
        mgr.createSingleCheckpoint(feature);
      }
    }
    mgr.renumberCheckpoints();
  }

  // ── Click test ────────────────────────────────────────────────────────────

  /**
   * Returns the checkpointData if `mesh` is the checkpoint handle.
   */
  findByMesh(mesh) {
    const mgr = this.editor.checkpointManager;
    if (!mgr) return null;
    for (const cpData of mgr.checkpointMeshes) {
      if (mesh === cpData.handle) return cpData;
    }
    return null;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  select(checkpointData) {
    // Deselect previous if any
    this.deselect();

    this.selected = checkpointData;
    this.editor._rawDragPos = { x: checkpointData.feature.centerX, z: checkpointData.feature.centerZ };

    if (!this.highlightMaterial) this.createMaterials();

    // Switch the center handle to the selected material
    if (checkpointData.handle) {
      checkpointData.originalHandleMaterial = checkpointData.handle.material;
      checkpointData.handle.material = this.highlightMaterial;
      checkpointData.handle.isVisible = this.editor.gizmosVisible !== false;
    }

    this.showProperties(checkpointData);

    console.debug('[CheckpointEditor] Selected checkpoint', checkpointData.feature.checkpointNumber);
  }

  deselect() {
    if (this.selected) {
      // Restore the center handle material
      if (this.selected.handle && this.selected.originalHandleMaterial) {
        this.selected.handle.material = this.selected.originalHandleMaterial;
      }

      console.debug('[CheckpointEditor] Deselected checkpoint');
      this.hideProperties();
      this.selected = null;
      this.editor._rawDragPos = null;
    }
  }

  // ── Movement ──────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected) return new Vector3(0, 0, 0);
    if (movement.x === 0 && movement.z === 0) return new Vector3(0, movement.y, 0);
    this.editor.saveSnapshot(true);

    const checkpoint = this.selected;
    const feature = checkpoint.feature;

    if (!this.editor._rawDragPos) this.editor._rawDragPos = { x: feature.centerX, z: feature.centerZ };
    this.editor._rawDragPos.x += movement.x;
    this.editor._rawDragPos.z += movement.z;

    const prevX = feature.centerX;
    const prevZ = feature.centerZ;
    feature.centerX = this.editor._snap(this.editor._rawDragPos.x);
    feature.centerZ = this.editor._snap(this.editor._rawDragPos.z);

    const terrainHeight = this.editor.terrainQuery.heightAt(feature.centerX, feature.centerZ);
    checkpoint.container.position.x = feature.centerX;
    checkpoint.container.position.z = feature.centerZ;
    checkpoint.container.position.y = terrainHeight;

    // Re-drop the barrels onto the terrain at the new center, and rebuild the
    // world-space decal (only when snapped coords actually changed)
    if (feature.centerX !== prevX || feature.centerZ !== prevZ) {
      checkpoint.reseatBarrels();
      checkpoint.updateDecal(feature.checkpointNumber, checkpoint.isFinish);
    }

    return new Vector3(feature.centerX - prevX, 0, feature.centerZ - prevZ);
  }

  // ── Rotation ──────────────────────────────────────────────────────────────

  rotate(angle) {
    if (!this.selected) return;

    const checkpoint = this.selected;
    const feature = checkpoint.feature;

    // Update feature heading
    feature.heading += angle;

    // Simply rotate the container – all children rotate automatically
    checkpoint.container.rotation.y = feature.heading;

    // Rotation moves each barrel over different terrain — re-drop them
    checkpoint.reseatBarrels();

    // Rebuild the world-space decal with the new heading
    checkpoint.updateDecal(feature.checkpointNumber, checkpoint.isFinish);

    // Sync heading back to the UI store (degrees)
    const s = this.editor._editorStore;
    if (s) {
      s.checkpoint.heading = +(feature.heading * 180 / Math.PI).toFixed(1);
    }
  }

  // ── Delete / Duplicate ────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();

    const checkpoint = this.selected;
    const feature = checkpoint.feature;

    // Find and remove from track features
    const featureIndex = this.editor.currentTrack.features.indexOf(feature);
    if (featureIndex > -1) {
      this.editor.currentTrack.features.splice(featureIndex, 1);
    }

    // Deselect before disposing the checkpoint meshes
    this.deselect();

    // Dispose all checkpoint resources (including ground-projected decal)
    checkpoint.dispose();

    // Remove from checkpoint manager
    const mgr = this.editor.checkpointManager;
    const meshIndex = mgr.checkpointMeshes.indexOf(checkpoint);
    if (meshIndex > -1) {
      mgr.checkpointMeshes.splice(meshIndex, 1);
    }

    // Renumber remaining checkpoints
    mgr.renumberCheckpoints();

    console.debug('[CheckpointEditor] Deleted checkpoint');
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    // Assign next checkpoint number
    const maxNum = this.editor.currentTrack.features.filter(f => f.type === 'checkpoint').length;
    const newFeature = { ...src, centerX: src.centerX + 5, centerZ: src.centerZ + 5, checkpointNumber: maxNum + 1 };
    this.editor.currentTrack.features.push(newFeature);
    const cpMesh = this.editor.checkpointManager.createSingleCheckpoint(newFeature);
    this.editor.checkpointManager.renumberCheckpoints();
    this.deselect();
    this.select(cpMesh);
  }

  // ── Add entity ────────────────────────────────────────────────────────────

  addEntity() {
    const { camera, currentTrack } = this.editor;
    const camTarget = camera.getTarget();
    const newX = camTarget.x;
    const newZ = camTarget.z;

    // Get terrain height
    const terrainHeight = this.editor.terrainQuery.heightAt(newX, newZ);

    // Find next checkpoint number
    const checkpointFeatures = currentTrack.features.filter(f => f.type === 'checkpoint');
    const nextNumber = checkpointFeatures.length + 1;

    // Create new checkpoint feature
    const newFeature = {
      type: 'checkpoint',
      centerX: newX,
      centerZ: newZ,
      heading: 0,
      width: 10,
      checkpointNumber: nextNumber,
    };

    // Add to track
    this.editor.saveSnapshot();
    currentTrack.features.push(newFeature);

    // Create visual representation
    const checkpoint = this.editor.checkpointManager.createSingleCheckpoint(newFeature);
    this.editor.checkpointManager.renumberCheckpoints();
    this.select(checkpoint);

    // Hide menu
    this.editor.hideAddMenu();

    console.debug('[CheckpointEditor] Added checkpoint at', newX.toFixed(1), newZ.toFixed(1));
  }

  // ── Properties (Vue store bridge) ─────────────────────────────────────────

  showProperties(checkpointData) {
    const s = this.editor._editorStore;
    if (!s) return;
    const cpFeatures = this.editor.currentTrack.features.filter(f => f.type === 'checkpoint');
    const featureIndex = cpFeatures.indexOf(checkpointData.feature);
    s.checkpoint.width    = checkpointData.feature.width;
    s.checkpoint.orderNum = checkpointData.feature.checkpointNumber ?? 1;
    s.checkpoint.heading  = +(checkpointData.feature.heading * 180 / Math.PI).toFixed(1);
    s.checkpoint.alternative = !!checkpointData.feature.alternative;
    s.checkpoint.canBeAlternative = featureIndex > 0; // first checkpoint has no predecessor
    s.selectedType        = 'checkpoint';
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'checkpoint')
      this.editor._editorStore.selectedType = null;
  }

  // ── Barrel repositioning ──────────────────────────────────────────────────

  /**
   * Move barrel1 and barrel2 to match the current feature.width, re-dropping
   * them onto the terrain (X offset + slope-following Y offset).
   */
  repositionBarrels(checkpointData) {
    checkpointData.reseatBarrels();
  }

  // ── Checkpoint reordering ─────────────────────────────────────────────────

  /**
   * Swap the selected checkpoint's order number with its neighbour.
   * direction: -1 = move earlier (lower number), +1 = move later (higher number)
   */
  shiftOrder(direction) {
    if (!this.selected) return;
    const features = this.editor.currentTrack.features;
    const checkpointFeatures = features.filter(f => f.type === 'checkpoint');
    const currentIndex = checkpointFeatures.indexOf(this.selected.feature);
    if (currentIndex < 0 || checkpointFeatures.length < 2) return;

    let targetIndex = currentIndex + direction;
    if (targetIndex < 0) targetIndex = checkpointFeatures.length - 1;
    if (targetIndex >= checkpointFeatures.length) targetIndex = 0;

    if (targetIndex === currentIndex) return;

    const reorderedCheckpoints = checkpointFeatures.slice();
    [reorderedCheckpoints[currentIndex], reorderedCheckpoints[targetIndex]] = [
      reorderedCheckpoints[targetIndex],
      reorderedCheckpoints[currentIndex],
    ];

    this.editor.saveSnapshot();
    let checkpointIndex = 0;
    for (let i = 0; i < features.length; i++) {
      if (features[i].type === 'checkpoint') {
        features[i] = reorderedCheckpoints[checkpointIndex++];
      }
    }

    this.editor.checkpointManager?.renumberCheckpoints();
    const s = this.editor._editorStore;
    if (s) s.checkpoint.orderNum = this.selected.feature.checkpointNumber;
  }

  /** Re-render the number/finish decal on every checkpoint gate. */
  refreshAllDecals() {
    const mgr = this.editor.checkpointManager;
    if (!mgr) return;
    const maxNum = this.editor.currentTrack.features
      .filter(f => f.type === 'checkpoint' && f.checkpointNumber != null)
      .reduce((m, f) => Math.max(m, f.checkpointNumber), 0);
    for (const cp of mgr.checkpointMeshes) {
      const isFinish = maxNum > 0 && cp.feature.checkpointNumber === maxNum;
      cp.updateDecal(cp.feature.checkpointNumber, isFinish);
    }
  }

  // ── Vue Bridge — called by Pinia store actions ────────────────────────────

  changeWidth(val) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.updateWidth(val);
  }

  changeHeading(degrees) {
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    const rad = degrees * Math.PI / 180;
    const checkpoint = this.selected;
    checkpoint.feature.heading = rad;
    checkpoint.container.rotation.y = rad;
    // Rotation moves each barrel over different terrain — re-drop them
    checkpoint.reseatBarrels();
    // Rebuild the world-space decal with the new heading
    checkpoint.updateDecal(checkpoint.feature.checkpointNumber, checkpoint.isFinish);
  }

  /**
   * Toggle whether this checkpoint shares a step with the previous one (an
   * "alternative" gate — pass either to advance the lap). Renumbering collapses
   * both onto the same step number and refreshes every gate's decal.
   */
  changeAlternative(val) {
    if (!this.selected) return;
    const cpFeatures = this.editor.currentTrack.features.filter(f => f.type === 'checkpoint');
    // The first checkpoint has no predecessor to be an alternative of.
    if (cpFeatures.indexOf(this.selected.feature) <= 0) return;

    this.editor.saveSnapshot();
    this.selected.feature.alternative = !!val;
    this.editor.checkpointManager?.renumberCheckpoints();

    const s = this.editor._editorStore;
    if (s) {
      s.checkpoint.alternative = !!this.selected.feature.alternative;
      s.checkpoint.orderNum = this.selected.feature.checkpointNumber;
    }
  }
}
