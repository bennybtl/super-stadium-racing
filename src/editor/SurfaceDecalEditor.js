import {
  MeshBuilder,
  StandardMaterial,
  Texture,
  Engine,
} from "@babylonjs/core";

// All decal image filenames available (discovered via import.meta.glob in SurfaceDecalManager).
const _decalModules = import.meta.glob('../assets/decals/*.png', { eager: true, query: '?url', import: 'default' });
const DECAL_FILENAMES = Object.keys(_decalModules)
  .map(path => path.split('/').at(-1))
  .sort();
const _decalUrls = {};
for (const [path, url] of Object.entries(_decalModules)) {
  _decalUrls[path.split('/').at(-1)] = url;
}

const GHOST_ROTATION_OFFSET_DEG = -90; // Align decal image "up" with world forward (Z+)

export const DECAL_TYPES = ['gouge', 'holes', 'rough'];
const _decalTypeImages = Object.fromEntries(
  DECAL_TYPES.map((type) => [
    type,
    DECAL_FILENAMES.filter((filename) => filename.startsWith(type)),
  ]),
);

/**
 * SurfaceDecalEditor — stamp-mode editor for placing surface decals.
 *
 * Controls:
 *   - Mouse move   : ghost preview follows terrain cursor
 *   - Click        : stamp a random decal variant at cursor position
 *   - Q / E        : rotate by 15° increments when random rotation is off
 *   - Mouse wheel  : scale up / down
 *   - Panel controls: select decal type, adjust size, opacity, and rotation mode
 */
export class SurfaceDecalEditor {
  constructor(editor) {
    this.editor = editor;
    this._scene = null;
    this._track = null;

    // Ghost preview mesh
    this._ghost = null;
    this._ghostMat = null;
    this._ghostTexCache = new Map(); // filename → Texture

    // Current stamp state
    this._decalType = DECAL_TYPES[0];
    this._previewImage = this._pickRandomImage(this._decalType);
    this._angle = 0;
    this._randomRotation = true;
    this._previewAngle = this._randomAngle();
    this._width = 4;
    this._depth = 4;
    this._opacity = 0.8;

    // Reference to the live SurfaceDecalManager set by EditorMode
    this._decalManager = null;

    this._boundPointerMove = this._onPointerMove.bind(this);
    this._boundWheel       = this._onWheel.bind(this);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  activate(scene, track) {
    this._scene = scene;
    this._track = track;
  }

  /** Called by EditorMode after SceneBuilder creates SurfaceDecalManager. */
  setDecalManager(manager) {
    this._decalManager = manager;
  }

  /** Open the stamp panel — called from EditorController.openSurfaceDecalStamp(). */
  open() {
    this._createGhost();
    this._scene.getEngine().getRenderingCanvas()?.addEventListener('wheel', this._boundWheel, { passive: false });
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = 'surfaceDecal';
      this._syncStore();
    }
  }

  /** Close / deactivate the stamp panel. */
  close() {
    this._destroyGhost();
    this._scene.getEngine().getRenderingCanvas()?.removeEventListener('wheel', this._boundWheel);
    if (this.editor._editorStore) {
      this.editor._editorStore.selectedType = null;
    }
  }

  get isOpen() {
    return this.editor._editorStore?.selectedType === 'surfaceDecal';
  }

  dispose() {
    this.close();
    for (const tex of this._ghostTexCache.values()) tex.dispose();
    this._ghostTexCache.clear();
    this._ghostMat?.dispose();
    this._ghostMat = null;
  }

  // ── Ghost preview ─────────────────────────────────────────────────────────

  _createGhost() {
    if (this._ghost) return;

    this._ghostMat = new StandardMaterial('_surfaceDecalGhostMat', this._scene);
    this._ghostMat.alphaMode  = Engine.ALPHA_COMBINE;
    this._ghostMat.backFaceCulling = false;
    this._ghostMat.disableLighting = true;
    this._ghostMat.useAlphaFromDiffuseTexture = true;
    this._ghostMat.zOffset    = -2;
    this._ghostMat.alpha      = this._opacity;
    this._updateGhostTexture();

    // Flat plane — 1×1, scaled to width×depth
    this._ghost = MeshBuilder.CreatePlane('_surfaceDecalGhost', { size: 1 }, this._scene);
    this._ghost.rotation.x = Math.PI / 2;
    this._ghost.isPickable  = false;
    this._ghost.material    = this._ghostMat;
    this._ghost.scaling.x   = this._width;
    this._ghost.scaling.y   = this._depth;
    this._ghost.rotation.y  = ((-this._previewAngle + GHOST_ROTATION_OFFSET_DEG) * Math.PI) / 180;
    this._ghost.setEnabled(false);

    this._scene.onPointerObservable.add(this._boundPointerMove);
  }

  _destroyGhost() {
    this._scene?.onPointerObservable.removeCallback(this._boundPointerMove);
    this._ghost?.dispose();
    this._ghost = null;
    this._ghostMat?.dispose();
    this._ghostMat = null;
  }

  _updateGhostTexture() {
    if (!this._ghostMat) return;
    const filename = this._previewImage;
    if (!filename) return;

    if (!this._ghostTexCache.has(filename)) {
      const url = _decalUrls[filename];
      const tex = new Texture(url, this._scene);
      tex.hasAlpha = true;
      this._ghostTexCache.set(filename, tex);
    }
    this._ghostMat.diffuseTexture = this._ghostTexCache.get(filename);
  }

  _updateGhostTransform() {
    if (!this._ghost) return;
    this._ghost.scaling.x  = this._width;
    this._ghost.scaling.y  = this._depth;
    this._ghost.rotation.y = ((-this._previewAngle + GHOST_ROTATION_OFFSET_DEG) * Math.PI) / 180;
  }

  _randomAngle() {
    return Math.floor(Math.random() * 360);
  }

  _pickRandomImage(type) {
    const images = _decalTypeImages[type] ?? [];
    if (!images.length) return null;
    return images[Math.floor(Math.random() * images.length)];
  }

  _refreshGhostPreview() {
    this._previewImage = this._pickRandomImage(this._decalType);
    if (this._randomRotation) {
      this._previewAngle = this._randomAngle();
    } else {
      this._previewAngle = this._angle;
    }
    this._updateGhostTexture();
    this._updateGhostTransform();
    this._syncStore();
  }

  _refreshGhostImageOnly() {
    this._previewImage = this._pickRandomImage(this._decalType);
    this._updateGhostTexture();
    this._syncStore();
  }

  // ── Pointer move — move ghost to cursor ───────────────────────────────────

  _onPointerMove(pointerInfo) {
    if (!this._ghost || !this.isOpen) return;
    const pick = this._scene.pick(this._scene.pointerX, this._scene.pointerY);
    if (pick?.hit && pick.pickedPoint) {
      const p = pick.pickedPoint;
      this._ghost.position.set(p.x, p.y + 0.05, p.z);
      this._ghost.setEnabled(true);
    } else {
      this._ghost.setEnabled(false);
    }
  }

  // ── Stamp on click ────────────────────────────────────────────────────────

  /**
   * Called by EditorController.handlePointerDown when selectedType === 'surfaceDecal'.
   */
  stamp(x, z) {
    if (!this._decalManager || !this._track) return;

    const filename = this._previewImage;
    if (!filename) return;

    const feature = {
      type:    'surfaceDecal',
      centerX: x,
      centerZ: z,
      image:   filename,
      width:   this._width,
      depth:   this._depth,
      angle:   this._previewAngle,
      opacity: this._opacity,
    };

    this.editor.saveSnapshot();
    this._track.features.push(feature);
    this._decalManager.createDecal(feature);
    if (this._randomRotation) {
      this._refreshGhostPreview();
    } else {
      this._refreshGhostImageOnly();
    }
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  onKeyDown(event) {
    if (!this.isOpen || this._randomRotation) return false;
    const key = event.key.toLowerCase();
    if (key === 'q') {
      this.setAngle((this._angle - 15 + 360) % 360);
      return true;
    }
    if (key === 'e') {
      this.setAngle((this._angle + 15) % 360);
      return true;
    }
    return false;
  }

  // ── Mouse wheel (scale) ───────────────────────────────────────────────────

  _onWheel(event) {
    if (!this.isOpen) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.5 : 0.5;
    this._width  = Math.max(0.5, this._width  + delta);
    this._depth  = Math.max(0.5, this._depth  + delta);
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Panel actions (called from store / Vue) ───────────────────────────────

  setType(type) {
    if (!DECAL_TYPES.includes(type) || type === this._decalType) return;
    this._decalType = type;
    this._refreshGhostPreview();
  }

  setRandomRotation(val) {
    const next = !!val;
    // Lock the current visible angle when switching from random -> manual.
    if (this._randomRotation && !next) {
      this._angle = this._previewAngle;
    }
    this._randomRotation = next;
    this._refreshGhostPreview();
  }

  setAngle(val) {
    this._angle = ((val % 360) + 360) % 360;
    if (!this._randomRotation) {
      this._previewAngle = this._angle;
      this._updateGhostTransform();
    }
    this._syncStore();
  }

  setOpacity(val) {
    this._opacity = val;
    if (this._ghostMat) this._ghostMat.alpha = val;
    this._syncStore();
  }

  setWidth(val) {
    this._width = val;
    this._updateGhostTransform();
    this._syncStore();
  }

  setDepth(val) {
    this._depth = val;
    this._updateGhostTransform();
    this._syncStore();
  }

  setSize(width, depth) {
    this._width = width;
    this._depth = depth;
    this._updateGhostTransform();
    this._syncStore();
  }

  // ── Store sync ────────────────────────────────────────────────────────────

  _syncStore() {
    const s = this.editor._editorStore?.surfaceDecal;
    if (!s) return;
    s.decalType  = this._decalType;
    s.decalTypes = DECAL_TYPES;
    s.imageName  = this._previewImage ?? '';
    s.angle = Math.round(this._previewAngle);
    s.randomRotation = this._randomRotation;
    s.width = +this._width.toFixed(1);
    s.depth = +this._depth.toFixed(1);
    s.opacity = +this._opacity.toFixed(2);
  }
}
