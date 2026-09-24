import { describe, it, expect } from 'vitest';
import { Vector3 } from '@babylonjs/core';
import { CameraController } from '../src/managers/CameraController.js';

const makeCam = () => {
  const camera = {
    position: new Vector3(),
    target: new Vector3(),
    setTarget(v) { this.target = v.clone(); },
    getTarget() { return this.target; },
  };
  return { camera, cc: new CameraController(camera) };
};

describe('CameraController motion feel', () => {
  it('shakes on a sudden velocity change (wall hit)', () => {
    const { cc } = makeCam();
    const pos = new Vector3(0, 0, 0);
    cc.update(pos, 0, 1 / 60, new Vector3(0, 0, 25));
    cc.update(pos, 0, 1 / 60, new Vector3(0, 0, 0)); // 25 m/s → 0 in a frame
    expect(cc._trauma).toBeGreaterThan(0.9);
  });

  it('ignores normal acceleration and respawn teleports', () => {
    const { cc } = makeCam();
    cc.update(new Vector3(0, 0, 0), 0, 1 / 60, new Vector3(0, 0, 20));
    cc.update(new Vector3(0, 0, 0.35), 0, 1 / 60, new Vector3(0, 0, 20.3)); // throttle
    expect(cc._trauma).toBe(0);
    cc.update(new Vector3(40, 0, 60), 0, 1 / 60, new Vector3(0, 0, 0)); // respawn: velocity zeroed far away
    expect(cc._trauma).toBe(0);
  });

  it('looks ahead along travel, capped, in the overhead modes', () => {
    const { camera, cc } = makeCam();
    const pos = new Vector3(0, 0, 0);
    for (let i = 0; i < 600; i++) cc.update(pos, 0, 1 / 60, new Vector3(40, 0, 0));
    expect(camera.target.x).toBeCloseTo(7, 1); // 40 m/s × 0.35 s = 14, capped at 7
    expect(camera.target.z).toBeCloseTo(0, 5);
  });

  it('stays a plain follow camera without velocity', () => {
    const { camera, cc } = makeCam();
    cc.update(new Vector3(5, 0, 5), 0, 1 / 60);
    expect(camera.target.x).toBe(5);
    expect(camera.target.z).toBe(5);
  });
});
