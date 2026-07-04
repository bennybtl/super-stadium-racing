import { MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";
import { TRUCK_WIDTH, TRUCK_HEIGHT, TRUCK_DEPTH } from "../constants.js";

export class GhostPlayer {
  constructor(scene, frames) {
    this.scene = scene;
    this.frames = frames;
    this.frameIndex = 0;
    this.mesh = this._createMesh();
    this.visible = true;
  }

  _createMesh() {
    const mesh = MeshBuilder.CreateBox("ghost", {
      width: TRUCK_WIDTH,
      height: TRUCK_HEIGHT,
      depth: TRUCK_DEPTH,
    }, this.scene);
    mesh.rotationQuaternion = null;
    const mat = new StandardMaterial("ghostMat", this.scene);
    mat.diffuseColor = new Color3(0.3, 0.7, 1);
    mat.alpha = 0.3;
    mat.disableLighting = true;
    mat.emissiveColor = new Color3(0.15, 0.35, 0.5);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  }

  update() {
    if (!this.visible || !this.frames || this.frames.length === 0) {
      this.mesh.isVisible = false;
      return;
    }
    const frame = this.frames[this.frameIndex % this.frames.length];
    this.mesh.position.set(frame.x, frame.y, frame.z);
    this.mesh.rotation.y = frame.h;
    this.mesh.isVisible = true;
    this.frameIndex++;
  }

  setVisible(v) {
    this.visible = v;
    if (!v) this.mesh.isVisible = false;
  }

  reset() {
    this.frameIndex = 0;
  }

  dispose() {
    this.mesh?.dispose();
    this.mesh = null;
  }
}
