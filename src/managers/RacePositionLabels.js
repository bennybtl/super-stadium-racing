import { createBillboardTextPlane, drawCenteredText } from "./billboardText.js";

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
    const { plane, tex, mat } = createBillboardTextPlane(this.scene, {
      name: `posLabel_${truckData.id}`,
      size: PLANE_SIZE,
      texWidth: TEX,
      texHeight: TEX,
    });
    plane.isVisible = false;

    this.labels.set(truckData.id, { truck: truckData.truck, plane, tex, mat, rank: 0 });
  }

  _draw(entry, rank) {
    drawCenteredText(entry.tex, RANK_TEXT[rank], {
      color: RANK_COLOR[rank],
      font: `bold ${Math.round(TEX * 0.34)}px sans-serif`,
      yNudge: TEX * 0.02,
    });
  }

  /**
   * Rank the trucks and show badges above the top three.
   *
   * `finishOrder` (truckData entries in the order they crossed the line) locks a
   * finished truck's position: finished trucks always rank ahead of still-racing
   * ones, in their finish order, so a driver who comes home 2nd stays "2nd" as
   * the rest of the field trickles in — rather than being re-sorted by live
   * distance to the next gate.
   */
  update(trucks, checkpointManager, finishOrder = []) {
    const total = Math.max(1, checkpointManager.getTotalCheckpoints());

    // Map checkpoint number -> gate center for the distance tiebreak.
    const cpByNum = new Map();
    for (const cp of checkpointManager.checkpointMeshes || []) {
      if (cp.feature?.checkpointNumber != null) cpByNum.set(cp.feature.checkpointNumber, cp.feature);
    }

    const finishRank = new Map();
    finishOrder.forEach((td, i) => finishRank.set(td.id, i));

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
      // Finished trucks sort first by their finish order; the rest are Infinity
      // and fall through to the live progress/distance comparison below.
      const finishIdx = finishRank.has(td.id) ? finishRank.get(td.id) : Infinity;
      ranked.push({ id: td.id, progress, dist, finishIdx });
    }
    // Finished (by finish order) first; then still-racing by furthest progress,
    // closer to the next gate breaking ties.
    ranked.sort((a, b) =>
      (a.finishIdx - b.finishIdx) || (b.progress - a.progress) || (a.dist - b.dist)
    );

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
