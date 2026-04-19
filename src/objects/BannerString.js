import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  Mesh,
  VertexData,
} from "@babylonjs/core";
import { basicColors } from "../constants.js";

const DEFAULT_POLE_HEIGHT = 4.2;
const POLE_RADIUS     = 0.16;
const STRING_RADIUS   = 0.05;
// Match the standalone Flag banner dimensions exactly
const FLAG_W          = 1.5;
const FLAG_H          = 1.6;
const FLAG_SPACING    = 1.7;  // slight gap between pennants
const N_ROPE_PTS      = 24;   // resolution of the catenary curve
// Sag: centre drops this fraction of total width
const SAG_FACTOR      = 0.06;

/**
 * Parabola approximation of a catenary.
 * t = 0..1 along the span; returns downward offset (negative = lower).
 */
function catenaryOffset(t, sag) {
  return -sag * 4 * t * (1 - t); // 0 at ends, -sag at centre
}

// Alternating pennant colours: red, blue, yellow
const FLAG_COLORS = [
  basicColors.red.diffuse,
  basicColors.blue.diffuse,
  basicColors.yellow.diffuse,
];

/**
 * BannerString — a decorative string of triangle pennant flags stretched
 * between two vertical poles.
 *
 * Feature format:
 *   { type: 'bannerString', x, z, heading, width }
 *
 * The container TransformNode is positioned at ground level (x, groundY, z)
 * and rotated to the requested heading.  All child meshes are in local space
 * so move/rotate/setWidth only need to touch the container or rebuild children.
 */
export class BannerString {
  constructor(feature, groundY, scene, shadows) {
    this.feature  = feature;
    this._scene   = scene;
    this._shadows = shadows ?? null;
    this._meshes  = [];

    this.container = new TransformNode(
      `bannerStr_${feature.x.toFixed(1)}_${feature.z.toFixed(1)}`,
      scene
    );
    this.container.position.copyFromFloats(feature.x, groundY, feature.z);
    this.container.rotation.y = feature.heading ?? 0;

    this._buildMeshes(feature.width, feature.poleHeight ?? DEFAULT_POLE_HEIGHT);
  }

  // ─── Private build ────────────────────────────────────────────────────────

  _buildMeshes(width, poleHeight = DEFAULT_POLE_HEIGHT) {
    // Dispose existing children (including their materials)
    for (const m of this._meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this._meshes = [];

    const half  = width / 2;
    const scene = this._scene;

    // Shared pole / rope material
    const poleMat = new StandardMaterial("bannerPoleMat", scene);
    poleMat.diffuseColor  = basicColors.brown.diffuse;
    poleMat.specularColor = basicColors.brown.emissive;

    // Two vertical poles
    for (const side of [half, -half]) {
      const pole = MeshBuilder.CreateCylinder("bannerPole", {
        height: poleHeight, diameter: POLE_RADIUS * 2, tessellation: 8,
      }, scene);
      pole.parent     = this.container;
      pole.position   = new Vector3(side, poleHeight / 2, 0);
      pole.material   = poleMat;
      pole.isPickable = true;
      this._meshes.push(pole);
      if (this._shadows) this._shadows.addShadowCaster(pole);
    }

    // Catenary rope as a tube following the parabolic sag curve
    const sag       = width * SAG_FACTOR;
    const ropePath  = [];
    for (let i = 0; i <= N_ROPE_PTS; i++) {
      const t   = i / N_ROPE_PTS;
      const px  = -half + width * t;
      const py  = poleHeight + catenaryOffset(t, sag);
      ropePath.push(new Vector3(px, py, 0));
    }
    const rope = MeshBuilder.CreateTube("bannerRope", {
      path: ropePath, radius: STRING_RADIUS, tessellation: 5, cap: 0,
    }, scene);
    rope.parent     = this.container;
    rope.material   = poleMat;
    rope.isPickable = true;
    this._meshes.push(rope);

    // Triangle pennants hanging from the rope at catenary height
    const count = Math.max(1, Math.floor((width - 0.1) / FLAG_SPACING));
    for (let i = 0; i < count; i++) {
      const px = -half + FLAG_SPACING * (i + 0.5);
      const t  = (px + half) / width;                      // 0..1 along span
      const py = poleHeight + catenaryOffset(t, sag);       // match rope height

      const mat = new StandardMaterial(`bannerFlagMat_${i}`, scene);
      mat.diffuseColor    = FLAG_COLORS[i % FLAG_COLORS.length].clone();
      mat.emissiveColor   = FLAG_COLORS[i % FLAG_COLORS.length].scale(0.15);
      mat.specularColor   = new Color3(0.04, 0.04, 0.04);
      mat.backFaceCulling = false;

      const tri = this._makeTriangle();
      tri.parent     = this.container;
      tri.position   = new Vector3(px, py, 0);
      tri.material   = mat;
      tri.isPickable = true;
      this._meshes.push(tri);
      if (this._shadows) this._shadows.addShadowCaster(tri);
    }
  }

  /** Build a double-sided downward-pointing triangle mesh. */
  _makeTriangle() {
    const mesh = new Mesh("bannerPennant", this._scene);
    const vd   = new VertexData();
    const w    = FLAG_W;
    const h    = FLAG_H;

    // Front face (normal +Z) and back face (normal -Z) as separate vertices
    vd.positions = [
      -w / 2,  0, 0,   // 0 front top-left
       w / 2,  0, 0,   // 1 front top-right
       0,     -h, 0,   // 2 front tip
      -w / 2,  0, 0,   // 3 back top-left
       w / 2,  0, 0,   // 4 back top-right
       0,     -h, 0,   // 5 back tip
    ];
    vd.indices = [0, 1, 2,  3, 5, 4]; // front CW, back CCW
    vd.normals = [
       0, 0,  1,  0, 0,  1,  0, 0,  1,
       0, 0, -1,  0, 0, -1,  0, 0, -1,
    ];
    vd.applyToMesh(mesh);
    return mesh;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  containsMesh(mesh) {
    return this._meshes.includes(mesh);
  }

  moveTo(x, z, groundY) {
    this.feature.x = x;
    this.feature.z = z;
    this.container.position.copyFromFloats(x, groundY, z);
  }

  setHeading(radians) {
    this.feature.heading = radians;
    this.container.rotation.y = radians;
  }

  setWidth(newWidth) {
    this.feature.width = newWidth;
    this._buildMeshes(newWidth, this.feature.poleHeight ?? DEFAULT_POLE_HEIGHT);
  }

  setPoleHeight(newHeight) {
    this.feature.poleHeight = newHeight;
    this._buildMeshes(this.feature.width, newHeight);
  }

  dispose() {
    for (const m of this._meshes) {
      m.material?.dispose();
      m.dispose();
    }
    this._meshes = [];
    this.container.dispose();
  }
}
