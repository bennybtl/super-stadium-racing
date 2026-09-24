import { describe, it, expect } from 'vitest';
import { FixedStepLoop, SIM_DT } from '../src/modes/fixed-step.js';

const makeMesh = (x = 0, heading = 0) => ({
  position: { x, y: 0, z: 0 },
  rotation: { x: 0, y: heading, z: 0 },
});

// Sim that moves the mesh +1 m along x per step.
const stepper = (mesh) => () => { mesh.position.x += 1; };

describe('FixedStepLoop', () => {
  it('runs a whole number of fixed steps and carries the remainder', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    const dts = [];
    expect(loop.run(SIM_DT * 2.5, (dt) => dts.push(dt))).toBe(2);
    expect(dts).toEqual([SIM_DT, SIM_DT]);
    expect(loop.run(SIM_DT * 0.5, () => {})).toBe(1); // 0.5 carried + 0.5
  });

  it('sim distance is independent of frame rate', () => {
    const simulate = (hz) => {
      const mesh = makeMesh();
      const loop = new FixedStepLoop(() => [mesh]);
      let steps = 0;
      for (let i = 0; i < hz; i++) steps += loop.run(1 / hz, stepper(mesh));
      loop.run(0, () => {}); // restore sim pose
      return { steps, loop };
    };
    // 1 s of real time → 60 steps (±1 for float carry) at any display rate.
    for (const hz of [30, 60, 120, 144, 165]) {
      expect(Math.abs(simulate(hz).steps - 60)).toBeLessThanOrEqual(1);
    }
  });

  it('renders between the last two sim poses and restores the sim pose', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    loop.run(SIM_DT * 1.25, stepper(mesh)); // 1 step, alpha 0.25
    expect(mesh.position.x).toBeCloseTo(0.25);
    // Next frame's step starts from the true sim pose (x=1), not the blend.
    let seen;
    loop.run(SIM_DT * 0.75, () => { seen = mesh.position.x; mesh.position.x += 1; });
    expect(seen).toBe(1);
    expect(mesh.position.x).toBeCloseTo(1); // alpha 0 → prev pose (x=1)
  });

  it('frames with no step still advance the blend smoothly', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    loop.run(SIM_DT, stepper(mesh));           // sim x=1, shown at alpha 0 → 0
    loop.run(SIM_DT * 0.5, stepper(mesh));     // no step, alpha 0.5
    expect(mesh.position.x).toBeCloseTo(0.5);
  });

  it('blends heading across the ±π wrap the short way', () => {
    const mesh = makeMesh(0, Math.PI - 0.1);
    const loop = new FixedStepLoop(() => [mesh]);
    loop.run(SIM_DT * 1.5, () => { mesh.rotation.y = -Math.PI + 0.1; });
    expect(Math.abs(mesh.rotation.y)).toBeGreaterThan(Math.PI - 0.1);
  });

  it('ignores Havok writing the presented pose back, float-rounded', () => {
    const mesh = makeMesh(123.456789);
    const loop = new FixedStepLoop(() => [mesh]);
    let x = mesh.position.x;
    for (let i = 0; i < 120; i++) {
      loop.run(SIM_DT * 1.5, () => { x += 0.5; mesh.position.x = x; });
      // Havok sync: body pose → mesh, float32 + quaternion→Euler round trip.
      mesh.position.x = Math.fround(mesh.position.x);
      mesh.rotation.y = Math.fround(mesh.rotation.y) + 2 * Math.PI;
    }
    let seen;
    loop.run(0, () => {});
    loop.run(SIM_DT, () => { seen = mesh.position.x; });
    expect(seen).toBe(x); // sim never lost ground to the render lag
  });

  it('adopts a teleport made between frames', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    loop.run(SIM_DT * 1.5, stepper(mesh));
    mesh.position.x = 100; // e.g. respawn from a key handler
    let seen;
    loop.run(SIM_DT * 0.5, () => { seen = mesh.position.x; });
    expect(seen).toBe(100);
    expect(mesh.position.x).toBe(100); // no sweep from the old pose
  });

  it('snaps instead of sweeping when a step teleports', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    loop.run(SIM_DT * 1.5, () => { mesh.position.x = 200; });
    expect(mesh.position.x).toBe(200);
  });

  it('drops backlog past the step cap instead of spiralling', () => {
    const mesh = makeMesh();
    const loop = new FixedStepLoop(() => [mesh]);
    expect(loop.run(1, () => {})).toBe(5);
    expect(loop.run(0, () => {})).toBe(0);
  });
});
