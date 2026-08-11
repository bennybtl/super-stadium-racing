/**
 * Starting-grid layout — shared by the race spawner (DriveMode.makeGridSpawner)
 * and the editor's start-position gizmo, so the ghost slots drawn in the editor
 * are exactly the spots the trucks land on.
 *
 * A grid is described by an anchor: a world point, the heading the trucks face,
 * how many columns wide the rows are, the lateral/back spacing, and how far the
 * front row sits behind the anchor. Slot 0 is pole; slots fill left-to-right
 * across a row, then step back a row.
 */

/** Grid shape used when a feature doesn't override it. Matches the original two-wide grid. */
export const DEFAULT_START_GRID = { columns: 2, colSpacing: 4, rowSpacing: 7 };

/** How far behind the start/finish gate the front row sits (gate-anchored grids). */
export const CHECKPOINT_GRID_BACK_OFFSET = 3;

/** Biggest field the race config offers (player + 9 AI) — what the editor previews. */
export const MAX_GRID_SLOTS = 10;

/**
 * World XZ of grid slot `index`.
 *
 * @param {number} index  0 = pole
 * @param {{x:number, z:number, heading:number, columns?:number, colSpacing?:number,
 *          rowSpacing?:number, backOffset?:number}} anchor
 * @returns {{x:number, z:number}}
 */
export function gridSlotXZ(index, anchor) {
  const h = anchor.heading ?? 0;
  const fwdX   = Math.sin(h), fwdZ   = Math.cos(h);
  const rightX = Math.cos(h), rightZ = -Math.sin(h);

  const columns    = Math.max(1, Math.round(anchor.columns ?? DEFAULT_START_GRID.columns));
  const colSpacing = anchor.colSpacing ?? DEFAULT_START_GRID.colSpacing;
  const rowSpacing = anchor.rowSpacing ?? DEFAULT_START_GRID.rowSpacing;
  const backOffset = anchor.backOffset ?? 0;

  const col = index % columns;
  const row = Math.floor(index / columns);
  // Rows straddle the anchor line, so widening the grid grows it evenly to both
  // sides instead of walking pole off to the left.
  const lateral = (col - (columns - 1) / 2) * colSpacing;
  const back    = backOffset + row * rowSpacing;

  return {
    x: anchor.x + rightX * lateral - fwdX * back,
    z: anchor.z + rightZ * lateral - fwdZ * back,
  };
}
