import { describe, it, expect } from 'vitest';
import { createRng, deriveSeed, rngStream } from '../src/sim/rng.js';

const draw = (rng, n) => Array.from({ length: n }, rng);

describe('sim rng', () => {
  it('repeats exactly for the same seed', () => {
    expect(draw(createRng(42), 50)).toEqual(draw(createRng(42), 50));
  });

  it('stays in [0, 1)', () => {
    for (const v of draw(createRng(7), 5000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('gives each label its own stream, independent of draw order', () => {
    const a = rngStream(1234, 'truck:p0');
    const b = rngStream(1234, 'truck:p1');
    expect(draw(a, 5)).not.toEqual(draw(b, 5));
    // Drawing heavily from one stream never shifts another.
    const a2 = rngStream(1234, 'truck:p0');
    draw(rngStream(1234, 'truck:p1'), 1000);
    expect(draw(a2, 5)).toEqual(draw(rngStream(1234, 'truck:p0'), 5));
  });

  it('derives different seeds for different races and labels', () => {
    expect(deriveSeed(1, 'pickups')).not.toBe(deriveSeed(2, 'pickups'));
    expect(deriveSeed(1, 'pickups')).not.toBe(deriveSeed(1, 'grid'));
  });
});
