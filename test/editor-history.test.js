import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorHistory } from "../src/editor/EditorHistory.js";

// A tiny fake "document": `state` is the value, serialize/restore round-trip it.
function makeHistory(opts = {}) {
  const doc = { state: "a" };
  const restored = [];
  const h = new EditorHistory({
    serialize: () => doc.state,
    restore: (snap) => { doc.state = snap; restored.push(snap); },
    ...opts,
  });
  return { h, doc, restored };
}

describe("EditorHistory", () => {
  it("save() then undo()/redo() walks the stack", () => {
    const { h, doc } = makeHistory();
    h.save();            // snapshot "a"
    doc.state = "b";
    h.save();            // snapshot "b"
    doc.state = "c";

    h.undo();            // -> "b"
    expect(doc.state).toBe("b");
    h.undo();            // -> "a"
    expect(doc.state).toBe("a");
    h.undo();            // stack empty, no-op
    expect(doc.state).toBe("a");

    h.redo();            // -> "b"
    expect(doc.state).toBe("b");
    h.redo();            // -> "c"
    expect(doc.state).toBe("c");
  });

  it("a fresh save() clears the redo stack", () => {
    const { h, doc } = makeHistory();
    h.save(); doc.state = "b";
    h.save(); doc.state = "c";
    h.undo();                 // back to "b", redo has "c"
    doc.state = "b2";
    h.save();                 // new branch — redo cleared
    expect(h.redoDepth).toBe(0);
    h.redo();
    expect(doc.state).toBe("b2"); // unchanged, redo was empty
  });

  it("does not stack a no-op (identical top)", () => {
    const { h } = makeHistory();
    h.save();
    h.save();
    h.save();
    expect(h.undoDepth).toBe(1);
  });

  it("caps the undo stack at maxDepth, dropping the oldest", () => {
    const { h, doc } = makeHistory({ maxDepth: 3 });
    for (const s of ["a", "b", "c", "d", "e"]) { doc.state = s; h.save(); }
    expect(h.undoDepth).toBe(3);
    // oldest kept is "c"
    h.undo(); h.undo(); h.undo();
    expect(doc.state).toBe("c");
  });

  it("reset() drops both stacks", () => {
    const { h, doc } = makeHistory();
    h.save(); doc.state = "b"; h.save();
    h.undo();
    h.reset();
    expect(h.undoDepth).toBe(0);
    expect(h.redoDepth).toBe(0);
  });

  describe("debounce", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("coalesces a burst into one commit after the silence window", () => {
      const { h, doc } = makeHistory({ debounceMs: 400 });
      doc.state = "1"; h.save(true);
      doc.state = "2"; h.save(true);
      doc.state = "3"; h.save(true);
      expect(h.undoDepth).toBe(0); // nothing committed yet
      vi.advanceTimersByTime(400);
      expect(h.undoDepth).toBe(1);
      h.undo();
      expect(doc.state).toBe("3"); // the last value in the burst
    });

    it("an immediate save() cancels a pending debounced one", () => {
      const { h, doc } = makeHistory({ debounceMs: 400 });
      doc.state = "1"; h.save(true);
      doc.state = "2"; h.save(false);
      vi.advanceTimersByTime(400);
      expect(h.undoDepth).toBe(1); // only the immediate one
    });

    it("reset() cancels a pending debounced commit", () => {
      const { h, doc } = makeHistory({ debounceMs: 400 });
      doc.state = "1"; h.save(true);
      h.reset();
      vi.advanceTimersByTime(400);
      expect(h.undoDepth).toBe(0);
    });
  });
});
