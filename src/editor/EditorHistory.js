/**
 * Undo/redo stack for the track editor.
 *
 * Snapshots are opaque strings: `serialize` produces one, `restore` consumes
 * one. EditorController owns what a snapshot contains (track name / size /
 * terrain / features / wear) and how restoring one rebuilds every gizmo — this
 * class only manages the two stacks and the commit-after-silence debounce that
 * keeps continuous operations (slider drags, WASD nudge) from flooding history.
 */
export class EditorHistory {
  /**
   * @param {object} o
   * @param {() => string} o.serialize       snapshot the current editable state
   * @param {(snap: string) => void} o.restore  apply a snapshot
   * @param {number} [o.maxDepth=50]          undo entries kept (oldest dropped)
   * @param {number} [o.debounceMs=400]       silence before a debounced commit
   */
  constructor({ serialize, restore, maxDepth = 50, debounceMs = 400 }) {
    this._serialize = serialize;
    this._restore = restore;
    this._maxDepth = maxDepth;
    this._debounceMs = debounceMs;
    this._undo = [];
    this._redo = [];
    this._debounceTimer = null;
  }

  /**
   * Push the current state as an undo entry, clearing the redo stack.
   * `debounce=true` coalesces a burst of calls into one snapshot committed
   * `debounceMs` after the last call.
   */
  save(debounce = false) {
    clearTimeout(this._debounceTimer);
    if (debounce) {
      this._debounceTimer = setTimeout(() => this._commit(), this._debounceMs);
    } else {
      this._commit();
    }
  }

  _commit() {
    const snap = this._serialize();
    // Don't stack a no-op edit.
    if (this._undo.length && this._undo[this._undo.length - 1] === snap) return;
    this._undo.push(snap);
    if (this._undo.length > this._maxDepth) this._undo.shift();
    this._redo = [];
  }

  undo() {
    if (this._undo.length === 0) return;
    this._redo.push(this._serialize());
    this._restore(this._undo.pop());
  }

  redo() {
    if (this._redo.length === 0) return;
    this._undo.push(this._serialize());
    this._restore(this._redo.pop());
  }

  /** Drop all history and any pending debounced commit. */
  reset() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    this._undo = [];
    this._redo = [];
  }

  get undoDepth() { return this._undo.length; }
  get redoDepth() { return this._redo.length; }
}
