/**
 * Starting-grid layout — shared by the race spawner (DriveMode.makeGridSpawner)
 * and the editor's start-position gizmo, so the ghost slots drawn in the editor
 * are exactly the spots the trucks land on.
 *
 * Two coordinate systems meet here, and keeping them apart is the whole point:
 *
 *   layout index — where a slot SITS. For a grid that is row-major from the
 *                  anchor (0 = front row, leftmost); for a custom layout it is
 *                  the index into the feature's hand-placed `positions`.
 *   race index   — WHO gets it. 0 is pole (player in a single race, standings
 *                  leader in a championship), then back through the field.
 *
 * `poleIndex` names the layout slot that pole starts on. Race order is that slot
 * first, then every other slot in layout order, so picking a middle-of-the-row
 * pole for a land rush doesn't scramble the rest of the field.
 */

/** Grid shape used when a feature doesn't override it. Matches the original two-wide grid. */
export const DEFAULT_START_GRID = { columns: 2, colSpacing: 4, rowSpacing: 7 };

/** How far behind the start/finish gate the front row sits (gate-anchored grids). */
export const CHECKPOINT_GRID_BACK_OFFSET = 3;

/** Biggest field the race config offers (player + 9 AI) — what the editor lays out. */
export const MAX_GRID_SLOTS = 10;

/**
 * World XZ of the grid slot at `layoutIndex`.
 *
 * @param {number} layoutIndex  0 = front row, leftmost
 * @param {{x:number, z:number, heading:number, columns?:number, colSpacing?:number,
 *          rowSpacing?:number, backOffset?:number}} anchor
 * @returns {{x:number, z:number}}
 */
export function gridSlotXZ(layoutIndex, anchor) {
  const h = anchor.heading ?? 0;
  const fwdX   = Math.sin(h), fwdZ   = Math.cos(h);
  const rightX = Math.cos(h), rightZ = -Math.sin(h);

  const columns    = Math.max(1, Math.round(anchor.columns ?? DEFAULT_START_GRID.columns));
  const colSpacing = anchor.colSpacing ?? DEFAULT_START_GRID.colSpacing;
  const rowSpacing = anchor.rowSpacing ?? DEFAULT_START_GRID.rowSpacing;
  const backOffset = anchor.backOffset ?? 0;

  const col = layoutIndex % columns;
  const row = Math.floor(layoutIndex / columns);
  // Rows straddle the anchor line, so widening the grid grows it evenly to both
  // sides instead of walking the front row off to the left.
  const lateral = (col - (columns - 1) / 2) * colSpacing;
  const back    = backOffset + row * rowSpacing;

  return {
    x: anchor.x + rightX * lateral - fwdX * back,
    z: anchor.z + rightZ * lateral - fwdZ * back,
  };
}

/** Clamp a stored poleIndex to a real slot. */
export function resolvePoleIndex(feature, count = MAX_GRID_SLOTS) {
  const pole = Math.round(feature?.poleIndex ?? 0);
  return Math.min(Math.max(pole, 0), Math.max(0, count - 1));
}

/** Race index (0 = pole) → layout index. Inverse of raceIndexFor. */
export function layoutIndexFor(raceIndex, poleIndex = 0) {
  if (raceIndex === 0) return poleIndex;
  return raceIndex <= poleIndex ? raceIndex - 1 : raceIndex;
}

/** Layout index → race index (0 = pole). Inverse of layoutIndexFor. */
export function raceIndexFor(layoutIndex, poleIndex = 0) {
  if (layoutIndex === poleIndex) return 0;
  return layoutIndex < poleIndex ? layoutIndex + 1 : layoutIndex;
}

/**
 * World placement of one laid-out slot — the grid formula, or the hand-placed
 * position in custom mode. Falls back to the grid whenever a custom layout is
 * missing that slot, so a half-built `positions` array can't strand a truck.
 */
export function startGridLayoutSlot(feature, layoutIndex) {
  const custom = feature?.mode === 'custom' ? feature.positions?.[layoutIndex] : null;
  if (custom && Number.isFinite(custom.x) && Number.isFinite(custom.z)) {
    return { x: custom.x, z: custom.z, heading: custom.heading ?? feature.heading ?? 0 };
  }
  const { x, z } = gridSlotXZ(layoutIndex, feature ?? {});
  return { x, z, heading: feature?.heading ?? 0 };
}

/** Every laid-out slot, in layout order — what the editor draws. */
export function startGridLayout(feature, count = MAX_GRID_SLOTS) {
  return Array.from({ length: count }, (_, i) => startGridLayoutSlot(feature, i));
}

/**
 * Where the truck starting `raceIndex`-th goes (0 = pole). Fields larger than
 * the laid-out slots keep extending the grid pattern behind them.
 */
export function startGridSlot(feature, raceIndex) {
  const pole = resolvePoleIndex(feature);
  return startGridLayoutSlot(feature, layoutIndexFor(raceIndex, pole));
}
