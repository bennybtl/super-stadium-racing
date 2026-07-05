import { MeshBuilder, DynamicTexture, StandardMaterial, Mesh, Vector3 } from "@babylonjs/core";

const RANK_TEXT = { 1: '1st', 2: '2nd', 3: '3rd' };
const RANK_COLOR = { 1: '#ffd24a', 2: '#d9d9e0', 3: '#e08a4b' };
const TEX = 256;        // badge texture resolution
const PLANE_SIZE = 2.6; // world units
const Y_OFFSET = 4.6;   // height above the truck's origin

/**
 * RacePositionLabels — floating 1st/2nd/3rd badges above the leading trucks.
 *
 * Ranks all trucks each frame by race progress (laps → checkpoints → distance
 * to the next gate) and shows a camera-facing badge above the top three. Labels
 * follow their truck's position; the texture is only redrawn when a truck's
 * rank changes.
 */
export class RacePositionLabels {
  constructor(scene) {
    this.scene = scene;
    this.labels = new Map(); // truckId -> { truck, plane, tex, mat, rank }
    this._tmp = [];          // reused ranking scratch array
  }

  attach(truckData) {
    const plane = MeshBuilder.CreatePlane(`posLabel_${truckData.id}`, { size: PLANE_SIZE }, this.scene);
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.isPickable = false;
    plane.isVisible = false;

    const tex = new DynamicTexture(`posLabelTex_${truckData.id}`, { width: TEX, height: TEX }, this.scene);
    tex.hasAlpha = true;

    const mat = new StandardMaterial(`posLabelMat_${truckData.id}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    plane.material = mat;

    this.labels.set(truckData.id, { truck: truckData.truck, plane, tex, mat, rank: 0 });
  }

  _draw(entry, rank) {
    const ctx = entry.tex.getContext();
    const c = TEX / 2;
    ctx.clearRect(0, 0, TEX, TEX);

    ctx.fillStyle = RANK_COLOR[rank];
    ctx.font = `bold ${Math.round(TEX * 0.34)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RANK_TEXT[rank], c, c + TEX * 0.02);

    entry.tex.update();
  }

  /** Rank the trucks and show badges above the top three. */
  update(trucks, checkpointManager) {
    const total = Math.max(1, checkpointManager.getTotalCheckpoints());

    // Map checkpoint number -> gate center for the distance tiebreak.
    const cpByNum = new Map();
    for (const cp of checkpointManager.checkpointMeshes || []) {
      if (cp.feature?.checkpointNumber != null) cpByNum.set(cp.feature.checkpointNumber, cp.feature);
    }

    const ranked = this._tmp;
    ranked.length = 0;
    for (const td of trucks) {
      const gs = td.gameState;
      const progress = gs.lapCount * total + gs.checkpointCount;
      const nextNum = (gs.lastCheckpointPassed % total) + 1;
      const gate = cpByNum.get(nextNum);
      let dist = Infinity;
      if (gate) {
        const dx = td.truck.mesh.position.x - gate.centerX;
        const dz = td.truck.mesh.position.z - gate.centerZ;
        dist = dx * dx + dz * dz;
      }
      ranked.push({ id: td.id, progress, dist });
    }
    // Furthest progress first; closer to the next gate breaks ties.
    ranked.sort((a, b) => (b.progress - a.progress) || (a.dist - b.dist));

    for (let i = 0; i < ranked.length; i++) {
      const entry = this.labels.get(ranked[i].id);
      if (!entry) continue;
      const rank = i + 1;
      if (rank <= 3) {
        if (entry.rank !== rank) { this._draw(entry, rank); entry.rank = rank; }
        const p = entry.truck.mesh.position;
        entry.plane.position.set(p.x, p.y + Y_OFFSET, p.z);
        entry.plane.isVisible = true;
      } else if (entry.plane.isVisible) {
        entry.plane.isVisible = false;
        entry.rank = 0;
      }
    }
  }

  hideAll() {
    for (const entry of this.labels.values()) {
      if (entry.plane.isVisible) { entry.plane.isVisible = false; entry.rank = 0; }
    }
  }

  dispose() {
    for (const entry of this.labels.values()) {
      entry.mat.dispose();
      entry.tex.dispose();
      entry.plane.dispose();
    }
    this.labels.clear();
  }
}
