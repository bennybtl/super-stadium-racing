import { Vector3, Color3 } from "@babylonjs/core";
import { Flag } from "../objects/Flag.js";
import { BannerString } from "../objects/BannerString.js";

const EMISSIVE_BLACK = new Color3(0, 0, 0);
const EMISSIVE_GREY  = new Color3(0.4, 0.4, 0.4);

export class DecorationsEditor {
  constructor(editor) {
    this.editor = editor;
    this.scene = null;
    this.track = null;
    this.flags = [];
    this.banners = [];
    this._selected = null;
  }

  get selected() { return this._selected; }

  activate(scene, track) {
    this.scene = scene;
    this.track = track;
    this.createVisualsForTrack(track);
  }

  clearMeshes() {
    for (const flag of this.flags) flag.dispose();
    for (const banner of this.banners) banner.dispose();
    this.flags = [];
    this.banners = [];
    this._selected = null;
  }

  dispose() {
    this.clearMeshes();
    this.scene = null;
    this.track = null;
  }

  createVisualsForTrack(track) {
    for (const feature of track.features) {
      if (feature.type === 'flag') this._createFlag(feature);
      else if (feature.type === 'bannerString') this._createBanner(feature);
    }
  }

  createVisual(feature) {
    if (feature.type === 'flag') return this._createFlag(feature);
    if (feature.type === 'bannerString') return this._createBanner(feature);
    return null;
  }

  _createFlag(feature) {
    const { x, z, color } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const flag = new Flag(x, z, color, groundY, this.scene, null);
    flag.feature = feature;
    this.flags.push(flag);
    return flag;
  }

  _createBanner(feature) {
    const { x, z } = feature;
    const groundY = this.track.getHeightAt(x, z);
    const banner = new BannerString(feature, groundY, this.scene, null);
    banner.feature = feature;
    this.banners.push(banner);
    return banner;
  }

  findByMesh(mesh) {
    return this.flags.find(f => f.containsMesh(mesh)) ?? this.banners.find(b => b.containsMesh(mesh)) ?? null;
  }

  select(featureData) {
    if (!featureData) return;

    if (this._selected && this._selected !== featureData && this._selected.feature.type === 'flag') {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
    }

    this._selected = featureData;
    this.editor._rawDragPos = { x: featureData.feature.x, z: featureData.feature.z };

    const s = this.editor._editorStore;
    if (!s) return;

    if (featureData.feature.type === 'flag') {
      s.decoration.type = 'flag';
      s.decoration.color = featureData.feature.color;
      featureData.flag.material.emissiveColor = EMISSIVE_GREY;
    } else {
      s.decoration.type = 'bannerString';
      s.decoration.width      = featureData.feature.width;
      s.decoration.poleHeight = featureData.feature.poleHeight ?? 4.2;
      s.decoration.heading    = +((featureData.feature.heading ?? 0) * 180 / Math.PI).toFixed(1);
    }

    s.selectedType = 'decoration';
  }

  deselect() {
    if (this._selected?.feature.type === 'flag') {
      this._selected.flag.material.emissiveColor = EMISSIVE_BLACK;
    }
    this._selected = null;
    this.editor._rawDragPos = null;
    this.hideProperties();
  }

  hideProperties() {
    if (this.editor._editorStore?.selectedType === 'decoration') {
      this.editor._editorStore.selectedType = null;
    }
  }

  move(movement) {
    if (!this._selected || (movement.x === 0 && movement.z === 0)) return new Vector3(0, 0, 0);

    const e = this.editor;
    e.saveSnapshot(true);
    const { feature } = this._selected;
    e._rawDragPos.x += movement.x;
    e._rawDragPos.z += movement.z;
    const prevX = feature.x;
    const prevZ = feature.z;
    const newX = e._snap(e._rawDragPos.x);
    const newZ = e._snap(e._rawDragPos.z);

    this._selected.feature.x = newX;
    this._selected.feature.z = newZ;
    const groundY = this.track.getHeightAt(newX, newZ);
    this._selected.moveTo(newX, newZ, groundY);

    return new Vector3(newX - prevX, 0, newZ - prevZ);
  }

  rotate(angleDelta) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    const newHeading = (this._selected.feature.heading ?? 0) + angleDelta;
    this._selected.setHeading(newHeading);
    const s = this.editor._editorStore;
    if (s) s.decoration.heading = +(newHeading * 180 / Math.PI).toFixed(1);
  }

  changeColor(val) {
    if (!this._selected || this._selected.feature.type !== 'flag') return;
    this.editor.saveSnapshot(true);
    this._selected.feature.color = val;
    this._selected.setColor(val);
  }

  changeWidth(val) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    this._selected.setWidth(val);
  }

  changePoleHeight(val) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    this._selected.setPoleHeight(val);
  }

  changeHeading(val) {
    if (!this._selected || this._selected.feature.type !== 'bannerString') return;
    this.editor.saveSnapshot(true);
    const radians = val * (Math.PI / 180);
    this._selected.setHeading(radians);
  }

  changeType(val) {
    if (!this._selected || this._selected.feature.type === val) return;
    if (val === 'flag' && this._selected.feature.type === 'bannerString') {
      this._convertBannerToFlag(this._selected);
    } else if (val === 'bannerString' && this._selected.feature.type === 'flag') {
      this._convertFlagToBanner(this._selected);
    }
  }

  _convertBannerToFlag(bannerData) {
    if (!bannerData) return;
    const feature = bannerData.feature;
    const index = this.track.features.indexOf(feature);
    if (index === -1) return;

    this.editor.saveSnapshot();
    bannerData.dispose();
    const bannerIndex = this.banners.indexOf(bannerData);
    if (bannerIndex > -1) this.banners.splice(bannerIndex, 1);
    this._selected = null;

    const color = this.editor._editorStore?.decoration?.color || 'red';
    const newFeature = { type: 'flag', x: feature.x, z: feature.z, color };
    this.track.features.splice(index, 1, newFeature);
    const newFlag = this._createFlag(newFeature);
    this.deselect();
    if (newFlag) this.select(newFlag);
  }

  _convertFlagToBanner(flagData) {
    if (!flagData) return;
    const feature = flagData.feature;
    const index = this.track.features.indexOf(feature);
    if (index === -1) return;

    this.editor.saveSnapshot();
    flagData.dispose();
    const flagIndex = this.flags.indexOf(flagData);
    if (flagIndex > -1) this.flags.splice(flagIndex, 1);
    this._selected = null;

    const newFeature = { type: 'bannerString', x: feature.x, z: feature.z, heading: 0, width: 8, poleHeight: 4.2 };
    this.track.features.splice(index, 1, newFeature);
    const newBanner = this._createBanner(newFeature);
    this.deselect();
    if (newBanner) this.select(newBanner);
  }

  deleteSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();

    const feature = this._selected.feature;
    const index = this.track.features.indexOf(feature);
    if (index > -1) this.track.features.splice(index, 1);

    this._selected.dispose();
    if (feature.type === 'flag') {
      const idx = this.flags.indexOf(this._selected);
      if (idx > -1) this.flags.splice(idx, 1);
    } else {
      const idx = this.banners.indexOf(this._selected);
      if (idx > -1) this.banners.splice(idx, 1);
    }

    this._selected = null;
    this.hideProperties();
  }

  duplicateSelected() {
    if (!this._selected) return;
    this.editor.saveSnapshot();
    const src = this._selected.feature;
    const newX = src.x + 3;
    const newZ = src.z + 3;

    let newFeature = { ...src, x: newX, z: newZ };
    this.track.features.push(newFeature);

    if (src.type === 'flag') {
      this._createFlag(newFeature);
    } else {
      this._createBanner(newFeature);
    }

    const newSelected = (src.type === 'flag') ? this.flags[this.flags.length - 1] : this.banners[this.banners.length - 1];
    this.deselect();
    if (newSelected) this.select(newSelected);
  }

  addEntity() {
    const e = this.editor;
    const camTarget = e.camera.getTarget();
    const newX = camTarget.x;
    const newZ = camTarget.z;
    const type = this.editor._editorStore?.decoration?.type || 'flag';

    e.saveSnapshot();
    if (type === 'bannerString') {
      this._addBanner(e._snap(newX), e._snap(newZ));
    } else {
      this._addFlag(e._snap(newX), e._snap(newZ));
    }
    e.deselectAll();
    e.hideAddMenu();
  }

  _addFlag(x, z) {
    const color = this.editor._editorStore?.decoration?.color || 'red';
    const feature = { type: 'flag', x, z, color };
    this.track.features.push(feature);
    this._createFlag(feature);
  }

  _addBanner(x, z) {
    const feature = { type: 'bannerString', x, z, heading: 0, width: 8, poleHeight: 4.2 };
    this.track.features.push(feature);
    this._createBanner(feature);
  }
}
