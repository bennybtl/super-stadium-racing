import {
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Color3,
  Vector3,
  Vector4,
} from "@babylonjs/core";

const BOARD_W        = 24;    // world units wide
const BOARD_H        =  6;    // world units tall
const BOARD_D        =  0.6;  // thickness
const POST_H         =  2.5;  // post height
const POST_DIAM      =  1;
const BOARD_CENTER_Y = POST_H + BOARD_H / 2; // height of board centre above ground

const TEX_W = 512;
const TEX_H = 256;

export class TrackSign {
  /**
   * @param {object}        feature  – feature object from the track (mutated in place)
   * @param {number}        groundY  – terrain height at (feature.x, feature.z)
   * @param {BABYLON.Scene} scene
   */
  constructor(feature, groundY, scene) {
    this.feature = feature;
    this._scene  = scene;

    const { x, z } = feature;
    const rot = feature.rotation ?? 0;

    // ── Post ──────────────────────────────────────────────────────────────
    this.post = MeshBuilder.CreateCylinder(
      `signPost_${x}_${z}`,
      { height: POST_H, diameter: POST_DIAM, tessellation: 8 },
      scene
    );
    this.post.position   = new Vector3(x, groundY + POST_H / 2, z);
    this.post.isPickable = true;

    const postMat           = new StandardMaterial(`signPostMat_${x}_${z}`, scene);
    postMat.diffuseColor    = new Color3(0.25, 0.25, 0.25);
    postMat.specularColor   = new Color3(0.1,  0.1,  0.1);
    this.post.material      = postMat;

    // ── Board ─────────────────────────────────────────────────────────────
    // BabylonJS box face indices: 0=back, 1=front, 2=right, 3=left, 4=top, 5=bottom.
    // Non-front faces sample UV (0,0)→(0,0) — a single black pixel from the texture background.
    const faceUV = Array.from({ length: 6 }, () => new Vector4(0, 0, 0, 0));
    faceUV[1] = new Vector4(0, 0, 1, 1); // front face gets the full texture

    this.board = MeshBuilder.CreateBox(
      `signBoard_${x}_${z}`,
      { width: BOARD_W, height: BOARD_H, depth: BOARD_D, faceUV },
      scene
    );
    this.board.position   = new Vector3(x, groundY + BOARD_CENTER_Y, z);
    this.board.rotation.y = rot;
    this.board.isPickable = true;

    // ── Dynamic texture ───────────────────────────────────────────────────
    this._texture = new DynamicTexture(
      `signTex_${x}_${z}`,
      { width: TEX_W, height: TEX_H },
      scene
    );
    this._drawText(feature.name ?? 'Track Name');

    const boardMat               = new StandardMaterial(`signBoardMat_${x}_${z}`, scene);
    boardMat.diffuseTexture      = this._texture;
    boardMat.emissiveTexture     = this._texture; // self-lit, readable at night/in shadow
    this.board.material          = boardMat;
  }

  // ─── Text rendering ───────────────────────────────────────────────────────

  _drawText(text) {
    const ctx = this._texture.getContext();

    // Black background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, TEX_W, TEX_H);

    // Red border
    ctx.strokeStyle = '#cc0000';
    ctx.lineWidth   = 8;
    ctx.strokeRect(4, 4, TEX_W - 8, TEX_H - 8);

    // Red bold italic text — shrink font if text is too wide
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    let fontSize = 250;
    ctx.font = `bold italic ${fontSize}px Arial`;
    const maxW = TEX_W - 40;
    while (ctx.measureText(text).width > maxW && fontSize > 16) {
      fontSize -= 4;
      ctx.font = `bold italic ${fontSize}px Arial`;
    }
    ctx.fillStyle = '#ff2222';
    ctx.fillText(text, TEX_W / 2, TEX_H / 2);

    this._texture.update();
  }

  // ─── Mutators ─────────────────────────────────────────────────────────────

  setName(name) {
    this.feature.name = name;
    this._drawText(name);
  }

  setRotation(radians) {
    this.feature.rotation = radians;
    this.board.rotation.y = radians;
  }

  moveTo(x, z, groundY) {
    this.feature.x       = x;
    this.feature.z       = z;
    this.post.position.x = x;
    this.post.position.y = groundY + POST_H / 2;
    this.post.position.z = z;
    this.board.position.x = x;
    this.board.position.y = groundY + BOARD_CENTER_Y;
    this.board.position.z = z;
  }

  dispose() {
    this._texture?.dispose();
    this.post?.dispose();
    this.board?.dispose();
  }
}
