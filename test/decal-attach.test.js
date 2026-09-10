import { describe, it, expect, vi } from "vitest";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector.js";
import { DecalManager } from "../src/managers/DecalManager.js";

const mgr = new DecalManager(null, null, null); // param + resolver logic needs no scene

describe("DecalManager attach resolver", () => {
  it("returns null with no resolver set", () => {
    expect(mgr._resolveAttach({ kind: "decoration", id: "d_1" })).toBeNull();
  });

  it("delegates to the resolver and tolerates a miss", () => {
    const parent = { decalAnchor: {}, decalMeshes: [] };
    mgr.setAttachResolver((a) => (a.id === "d_hit" ? parent : null));
    expect(mgr._resolveAttach({ kind: "decoration", id: "d_hit" })).toBe(parent);
    expect(mgr._resolveAttach({ kind: "decoration", id: "d_miss" })).toBeNull();
    mgr.setAttachResolver(null);
  });

  it("_createAttached warns and returns null when the parent can't be resolved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mgr.setAttachResolver(() => null);
    expect(mgr._createAttached({ type: "decal", attachTo: { kind: "obstacle", id: "o_x" }, position: [0, 0, 0] })).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    mgr.setAttachResolver(null);
  });
});

describe("DecalManager._decalParams with attachTo", () => {
  it("parses a feature whose position / normal are prop-local", () => {
    const p = mgr._decalParams({
      type: "decal", attachTo: { kind: "decoration", id: "d_1" },
      position: [0.5, 1.2, -0.3], normal: [0, 0, 1], rotation: 45, shape: "brand", brand: "acme",
    });
    expect(p.position.asArray()).toEqual([0.5, 1.2, -0.3]);
    expect(p.normal.asArray()).toEqual([0, 0, 1]);
    expect(p.rotationRad).toBeCloseTo(Math.PI / 4, 9);
  });
});

describe("local <-> world round-trip through a prop anchor matrix", () => {
  // The invariant DecalEditor._applyAttach (world hit -> local store) and
  // DecalManager._buildAttachedMesh (local store -> world project) rely on.
  const anchor = Matrix.Compose(
    new Vector3(2, 2, 2),                          // uniform scale
    Quaternion.RotationYawPitchRoll(1.1, 0, 0),    // yaw
    new Vector3(30, 4, -12),                       // translation
  );
  const inv = anchor.clone().invert();

  it("recovers a point placed in world space", () => {
    const world = new Vector3(31.5, 5, -10.25);
    const local = Vector3.TransformCoordinates(world, inv);
    const back = Vector3.TransformCoordinates(local, anchor);
    expect(back.x).toBeCloseTo(world.x, 4);
    expect(back.y).toBeCloseTo(world.y, 4);
    expect(back.z).toBeCloseTo(world.z, 4);
  });

  it("recovers a (renormalised) normal", () => {
    const worldN = new Vector3(0.3, 0.1, -0.95).normalize();
    const localN = Vector3.TransformNormal(worldN, inv).normalize();
    const backN = Vector3.TransformNormal(localN, anchor).normalize();
    expect(Vector3.Dot(backN, worldN)).toBeCloseTo(1, 6);
  });
});
