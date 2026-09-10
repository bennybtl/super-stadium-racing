import { Vector3, MeshBuilder, TransformNode } from "@babylonjs/core";
import { EditorMaterials } from './EditorMaterials.js';
import { removeAttachedDecals, copyAttachedDecals } from './attached-decal-lifecycle.js';
import { Obstacle, getObstacleSpec, normalizeObstacleType, clampObstacleCount, getDefaultMass } from "../objects/Obstacle.js";
import { MeshMaterialResolver } from "../utils/mesh-materials.js";
import { unitSizeOf } from "../utils/mesh-bounds.js";
import { GIZMO_CLEARANCE } from './gizmo-height.js';

export class ObstacleEditor {
  constructor(editor) {
    this.editor = editor;
    this.meshes   = [];
    this.selected = null;
    this.material          = null;
    this.highlightMaterial = null;
  }

  get scene() { return this.editor.scene; }

  // ── Materials ──────────────────────────────────────────────────────────────

  createMaterials() {
    const m = EditorMaterials.for(this.scene);
    // Same grey click-target handle as the checkpoint / hill gizmos.
    this.material          = m.handleSphere;
    this.highlightMaterial = m.handleSphereHighlight;
  }

  /** Called when editor mode activates — creates materials and initial visuals. */
  activate(scene, track) {
    this.createMaterials();
    this.createVisualsForTrack(track);
  }

  /** Dispose all gizmo meshes and reset state, keeping materials alive (used on snapshot restore). */
  clearMeshes() {
    for (const d of this.meshes) {
      d.node.dispose();
      d.mesh.dispose();
      d.decalAnchor?.dispose();
      d.matRes?.dispose();
    }
    this.meshes = [];
    this.selected = null;
  }

  // ── Visual creation ────────────────────────────────────────────────────────

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'obstacle') this.createVisual(feature);
    }
  }

  _featureObstacleType(feature) {
    return normalizeObstacleType(feature.obstacleType);
  }

  _ensureObstacleDefaults(feature) {
    const type = this._featureObstacleType(feature);
    const spec = getObstacleSpec(type);
    if (feature.type === 'obstacle') {
      // Migration: earlier editor builds defaulted obstacles to 0.1, which is too tiny.
      if (feature.scale === 0.1) feature.scale = 1;
      if (feature.scale == null) feature.scale = 1;
      // Stackable obstacles (e.g. tireStack) keep a unit count; non-stackable
      // ones just report 1 (clampObstacleCount handles both).
      feature.count = clampObstacleCount(feature.count, spec);
      if (feature.weight == null) feature.weight = getDefaultMass(spec, feature.count);
      if (feature.angle == null) feature.angle = 0;
      if (feature.color == null) feature.color = 'yellow';
    }
    return { type, spec };
  }

  _computeHandleYOffset(feature, spec) {
    const scale = Math.max(0.05, Number(feature.scale) || 1);
    const count = spec.stack ? clampObstacleCount(feature.count, spec) : 1;
    const baseHeight = Math.max(0.25, (spec.halfExtents?.y ?? 0.6) * count);
    // Keep handle height proportional to obstacle size so it stays above the
    // mesh at larger scales, with a small capped clearance for readability.
    const scaledHalfHeight = baseHeight * scale;
    const clearance = Math.min(2.2, 1.0 + scale * 0.25);
    return scaledHalfHeight + clearance;
  }

  _maxVisualY(node) {
    const meshes = node?.getChildMeshes?.() ?? [];
    let maxY = -Infinity;
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo?.()?.boundingBox;
      if (!bb) continue;
      if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y;
    }
    return Number.isFinite(maxY) ? maxY : null;
  }

  _syncHandleYOffsetFromVisual(stackData, spec, terrainH) {
    const fallback = this._computeHandleYOffset(stackData.feature, spec);
    const maxVisualY = this._maxVisualY(stackData.node);
    if (maxVisualY == null) {
      stackData.handleYOffset = fallback;
      return fallback;
    }

    const visualTopOffset = Math.max(0, maxVisualY - terrainH);
    const offset = Math.max(fallback, visualTopOffset + GIZMO_CLEARANCE);
    stackData.handleYOffset = offset;
    return offset;
  }

  _cloneVisualMeshes(stackData, type, spec) {
    const { feature, node } = stackData;
    // One resolver per node instance: meshes pinned by the def's
    // meshColors/colorableMeshes/baked-mtl stay fixed, everything else takes
    // the feature's paint colour (same rule as the runtime Obstacle).
    stackData.matRes?.dispose();
    const matRes = new MeshMaterialResolver(spec, this.scene, `edObstacle_${type}_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`);
    matRes.setColor(feature.color ?? 'yellow');
    stackData.matRes = matRes;

    Obstacle._getSourceMeshes(this.scene, type)
      .then(sourceMeshes => {
        // A rebuild (type/scale/color change) may have disposed this node while
        // the OBJ was still loading. Cloning onto a disposed parent strands an
        // orphan mesh at the world origin — bail if the node is gone.
        if (node.isDisposed()) return;
        // A stackable obstacle (spec.stack, e.g. the tire pile) clones the unit
        // `count` times along Y, using the model's own bounding-box height as
        // the repeat pitch — same technique as the decorations' scaffold arch.
        const repeats = spec.stack ? clampObstacleCount(feature.count, spec) : 1;
        const unit = spec.stack ? unitSizeOf(sourceMeshes) : null;
        stackData.visualMeshes = [];
        for (let i = 0; i < repeats; i++) {
          const yOffset = unit ? i * unit.y - unit.minY : 0;
          for (const src of sourceMeshes) {
            const m = src.clone('obstacleEditorMesh', node);
            m.position.y = yOffset;
            m.isVisible = true;
            m.isPickable = false; // the floating sphere stays the click/drag target
            // Non-pickable, but the decal editor's pick predicate matches on this
            // tag (like ground / walls) so a decal can be stamped onto the obstacle.
            m.metadata = { ...(m.metadata ?? {}), decalTarget: true };
            m.material = matRes.materialFor(src.name);
            stackData.visualMeshes.push(m);
          }
        }
        stackData.decalMeshes = stackData.visualMeshes;
        const terrainNow = this.editor.terrainQuery.heightAt(feature.x, feature.z);
        const offset = this._syncHandleYOffsetFromVisual(stackData, spec, terrainNow);
        if (stackData.mesh) stackData.mesh.position.y = terrainNow + offset;
        this._syncDecalAnchor(stackData, spec, terrainNow);
        this.editor.decalManager?.rebuildAttachedTo?.(feature.id);
      })
      .catch(err => console.warn(`[ObstacleEditor] Failed to clone obstacle '${type}':`, err));
  }

  _syncStoreFromFeature(feature) {
    const s = this.editor._editorStore;
    if (!s) return;
    const { type, spec } = this._ensureObstacleDefaults(feature);
    s.obstacle.type = type;
    s.obstacle.scale = feature.scale ?? 1;
    s.obstacle.rotation = ((feature.angle ?? 0) * 180) / Math.PI;
    s.obstacle.count = feature.count ?? (spec.stack?.default ?? 1);
    s.obstacle.weight = feature.weight ?? getDefaultMass(spec, s.obstacle.count);
    s.obstacle.color = feature.color ?? 'yellow';
    s.obstacle.placementActive = true;
    s.selectedType = 'obstacle';
  }

  _hideProperties() {
    const s = this.editor._editorStore;
    if (!s) return;
    s.obstacle.placementActive = false;
    if (s.selectedType === 'obstacle' && !s.obstacle.placementActive) {      
      s.selectedType = null;
    }
  }

  _rebuildNodeVisual(stackData) {
    const { feature } = stackData;
    const { type, spec } = this._ensureObstacleDefaults(feature);
    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);

    stackData.node?.dispose();

    const node = new TransformNode('tireStackNode', this.scene);
    node.position = new Vector3(feature.x, terrainH, feature.z);
    node.rotation.x = (spec.rotationX ?? 0) * Math.PI / 180; // config is in degrees
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.baseScale ?? 1) * (feature.scale ?? 1));
    stackData.node = node;
    stackData.handleYOffset = this._computeHandleYOffset(feature, spec);

    this._cloneVisualMeshes(stackData, type, spec);
  }

  createVisual(feature) {
    const { type, spec } = this._ensureObstacleDefaults(feature);
    const SPHERE_Y_ABOVE = this._computeHandleYOffset(feature, spec);

    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);

    // TransformNode holds the OBJ visual at ground level.
    const node = new TransformNode('tireStackNode', this.scene);
    node.position   = new Vector3(feature.x, terrainH, feature.z);
    node.rotation.x = (spec.rotationX ?? 0) * Math.PI / 180; // config is in degrees
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.baseScale ?? 1) * (feature.scale ?? 1));

    // Sphere floating above — sole pickable click/drag target
    const mesh = MeshBuilder.CreateSphere('obstacleSphere', { diameter: 1.2, segments: 8 }, this.scene);
    mesh.position   = new Vector3(feature.x, terrainH + SPHERE_Y_ABOVE, feature.z);
    mesh.material   = this.material;
    mesh.isPickable = true;

    const stackData = { feature, node, mesh, handleYOffset: SPHERE_Y_ABOVE, visualMeshes: [] };
    stackData.decalMeshes = stackData.visualMeshes;
    this._syncDecalAnchor(stackData, spec, terrainH);

    // Clone from shared cache — no extra network request
    this._cloneVisualMeshes(stackData, type, spec);

    this.meshes.push(stackData);
    return stackData;
  }

  /**
   * Re-sample obstacle + handle heights after a terrain rebuild. Obstacles rest
   * on whatever surface is under them (terrain, bridge, drive box), so this
   * re-runs the same surface query the visual was placed with.
   */
  refreshGizmoHeights() {
    for (const stackData of this.meshes) this.updateVisual(stackData);
  }

  updateVisual(stackData) {
    const { feature, node, mesh } = stackData;
    const terrainH = this.editor.terrainQuery.heightAt(feature.x, feature.z);
    const { spec } = this._ensureObstacleDefaults(feature);
    const SPHERE_Y_ABOVE = this._syncHandleYOffsetFromVisual(stackData, spec, terrainH);

    node.position.x = feature.x;
    node.position.y = terrainH;
    node.position.z = feature.z;
    node.rotation.y = feature.angle ?? 0;
    node.scaling.setAll((spec.baseScale ?? 1) * (feature.scale ?? 1));

    mesh.position.x = feature.x;
    mesh.position.y = terrainH + SPHERE_Y_ABOVE;
    mesh.position.z = feature.z;

    this._syncDecalAnchor(stackData, spec, terrainH);
    this.editor.decalEditor?.refreshHandles();
  }

  /**
   * Keep `stackData.decalAnchor` at the obstacle's ground-pose frame — the same
   * world transform the runtime `Obstacle.decalAnchor` holds at rest — so a decal
   * stuck to it in the editor lands in the same spot at race time. Position
   * (x, groundY, z), yaw only, uniform base+user scale. No rotationX / offsetY.
   */
  _syncDecalAnchor(stackData, spec, terrainH) {
    let a = stackData.decalAnchor;
    if (!a || a.isDisposed()) {
      a = new TransformNode('obstacleDecalAnchor', this.scene);
      stackData.decalAnchor = a;
    }
    const { feature } = stackData;
    a.position.set(feature.x, terrainH, feature.z);
    a.rotation.y = feature.angle ?? 0;
    a.scaling.setAll((spec.baseScale ?? 1) * (feature.scale ?? 1));
  }

  // ── Lookup ─────────────────────────────────────────────────────────────────

  findByMesh(mesh) {
    return this.meshes.find(d => d.mesh === mesh || d.visualMeshes?.includes(mesh)) ?? null;
  }

  /** stackData whose feature carries this id, or null. */
  findById(id) {
    if (!id) return null;
    return this.meshes.find(d => d.feature?.id === id) ?? null;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  select(stackData) {
    this.deselect();
    this.selected = stackData;
    this.editor._rawDragPos = { x: stackData.feature.x, z: stackData.feature.z };
    stackData.mesh.material = this.highlightMaterial;
    this._syncStoreFromFeature(stackData.feature);
  }

  deselect() {
    if (!this.selected) return;
    this.selected.mesh.material = this.material;
    this.selected = null;
    this.editor._rawDragPos = null;
    this._hideProperties();
  }

  // ── Movement ───────────────────────────────────────────────────────────────

  move(movement) {
    if (!this.selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);
    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this.selected;
    if (!e._rawDragPos) e._rawDragPos = { x: feature.x, z: feature.z };
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x;
    const prevZ = feature.z;
    const newX  = e._snap(e._rawDragPos.x);
    const newZ  = e._snap(e._rawDragPos.z);
    feature.x = newX;
    feature.z = newZ;
    this.updateVisual(this.selected);
    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  rotate(delta) {
    if (!this.selected || delta === 0) return;
    const { feature } = this.selected;
    this.editor.saveSnapshot(true);
    feature.angle = (feature.angle ?? 0) + delta;
    this.updateVisual(this.selected);
    if (this.editor._editorStore?.selectedType === 'obstacle') {
      this.editor._editorStore.obstacle.rotation = (feature.angle * 180) / Math.PI;
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  deleteSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const stackData = this.selected;
    const idx = this.editor.currentTrack.features.indexOf(stackData.feature);
    if (idx > -1) this.editor.currentTrack.features.splice(idx, 1);
    removeAttachedDecals(this.editor.currentTrack, this.editor.decalManager, stackData.feature.id);
    stackData.node.dispose();
    stackData.mesh.dispose();
    stackData.decalAnchor?.dispose();
    stackData.matRes?.dispose();
    const meshIdx = this.meshes.indexOf(stackData);
    if (meshIdx > -1) this.meshes.splice(meshIdx, 1);
    this.selected = null;
    this._hideProperties();
  }

  duplicateSelected() {
    if (!this.selected) return;
    this.editor.saveSnapshot();
    const src = this.selected.feature;
    const newFeature = { ...src, x: src.x + 3, z: src.z + 3 };
    delete newFeature.id; // the copy gets its own
    this.editor.currentTrack.features.push(newFeature);
    const stackData = this.createVisual(newFeature);
    copyAttachedDecals(this.editor.currentTrack, this.editor.decalManager, src, newFeature, 'obstacle');
    this.deselect();
    this.select(stackData);
  }

  addEntityAt(x, z) {
    const e = this.editor;
    const selectedType = normalizeObstacleType(e._editorStore?.obstacle?.type ?? 'barrel');
    const selectedSpec = getObstacleSpec(selectedType);
    const selectedScale = e._editorStore?.obstacle?.scale ?? 1;
    const selectedCount = clampObstacleCount(e._editorStore?.obstacle?.count, selectedSpec);
    const selectedWeight = e._editorStore?.obstacle?.weight ?? getDefaultMass(selectedSpec, selectedCount);
    const selectedRotationDeg = e._editorStore?.obstacle?.rotation ?? 0;
    const selectedColor = e._editorStore?.obstacle?.color ?? 'yellow';
    const newFeature = {
      type: 'obstacle',
      obstacleType: selectedType,
      x: e._snap(x, 'x'),
      z: e._snap(z, 'z'),
      angle: selectedRotationDeg * Math.PI / 180,
      scale: selectedScale,
      count: selectedCount,
      weight: selectedWeight,
      color: selectedColor,
    };
    e.saveSnapshot();
    e.currentTrack.features.push(newFeature);
    const stackData = this.createVisual(newFeature);
    e.deselectCheckpoint();
    e.deselectHill();
    e.squareHillEditor.deselect();
    e.terrainShapeEditor.deselect();
    this.select(stackData);
    return stackData;
  }

  addEntity() {
    const e = this.editor;
    const center = e.viewCenterXZ();
    this.addEntityAt(center.x, center.z);
    e.hideAddMenu();
  }

  changeType(val) {
    const normalized = normalizeObstacleType(val);
    const spec = getObstacleSpec(normalized);
    // Switching type resets the stack count to the new type's default (a
    // non-stackable type just reports 1) — the weight default follows it.
    const count = clampObstacleCount(spec.stack?.default, spec);
    const s = this.editor._editorStore;
    if (s) {
      s.obstacle.type = normalized;
      s.obstacle.count = count;
      s.obstacle.weight = getDefaultMass(spec, count);
    }
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.type = 'obstacle';
    this.selected.feature.obstacleType = normalized;
    this.selected.feature.count = count;
    this.selected.feature.weight = getDefaultMass(spec, count);
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  changeScale(val) {
    const scale = Math.max(0.05, Number(val) || 1);
    const s = this.editor._editorStore;
    if (s) s.obstacle.scale = scale;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.scale = scale;
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  /** Number of units in a stackable obstacle's pile (e.g. the tire stack). */
  changeCount(val) {
    const s = this.editor._editorStore;
    const type = normalizeObstacleType(s?.obstacle?.type);
    const spec = getObstacleSpec(type);
    const count = clampObstacleCount(val, spec);
    if (s) s.obstacle.count = count;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.count = count;
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  changeRotation(degrees) {
    const angle = (Number(degrees) || 0) * Math.PI / 180;
    const s = this.editor._editorStore;
    if (s) s.obstacle.rotation = Number(degrees) || 0;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.angle = angle;
    this.updateVisual(this.selected);
  }

  changeWeight(val) {
    const weight = Math.max(0.1, Number(val) || 1);
    const s = this.editor._editorStore;
    if (s) s.obstacle.weight = weight;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.weight = weight;
  }

  resetToDefaults() {
    if (!this.selected) return;
    const { feature } = this.selected;
    const { spec } = this._ensureObstacleDefaults(feature);
    this.editor.saveSnapshot(true);
    feature.scale = 1;
    feature.angle = 0;
    feature.count = clampObstacleCount(spec.stack?.default, spec);
    feature.weight = getDefaultMass(spec, feature.count);
    feature.color = 'yellow';
    this._syncStoreFromFeature(feature);
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  changeColor(color) {
    const normalized = String(color || 'yellow');
    const s = this.editor._editorStore;
    if (s) s.obstacle.color = normalized;
    if (!this.selected) return;
    this.editor.saveSnapshot(true);
    this.selected.feature.color = normalized;
    this._rebuildNodeVisual(this.selected);
    this.updateVisual(this.selected);
  }

  deleteSelectedObstacle() {
    this.deleteSelected();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  dispose() {
    this.deselect();
    for (const d of this.meshes) {
      d.node.dispose();
      d.mesh.dispose();
      d.decalAnchor?.dispose();
      d.matRes?.dispose();
    }
    this.meshes = [];
  }
}
