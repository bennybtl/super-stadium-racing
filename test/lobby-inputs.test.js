import { describe, it, expect } from 'vitest';
import { PlayerInputs, sanitizeFrame, toTruckInput, WINDOW_AHEAD } from '../server/lobby/inputs.js';

describe('lobby input ingest', () => {
  it('normalises untrusted frames', () => {
    expect(sanitizeFrame({ t: 5, s: 9, g: -Infinity, b: 'yes', r: 1 }))
      .toEqual({ t: 5, s: 1, g: 0, b: false, r: false });
    expect(sanitizeFrame({ t: 1.5 })).toBeNull();
    expect(sanitizeFrame({ t: -1 })).toBeNull();
    expect(sanitizeFrame('junk')).toBeNull();
  });

  it('accepts one frame per tick inside the window only', () => {
    const p = new PlayerInputs();
    expect(p.offer({ t: 10, g: 1 }, 10)).toBe('accepted');
    expect(p.offer({ t: 10, g: -1 }, 10)).toBe('duplicate');
    expect(p.offer({ t: 9 }, 10)).toBe('stale');
    expect(p.offer({ t: 10 + WINDOW_AHEAD }, 10)).toBe('accepted');
    expect(p.offer({ t: 11 + WINDOW_AHEAD }, 10)).toBe('future');
    expect(p.offer({ s: 1 }, 10)).toBe('malformed');
    expect(p.rejected).toEqual({ malformed: 1, stale: 1, future: 1, duplicate: 1 });
    // The first frame for a tick wins.
    expect(p.take(10).frame.g).toBe(1);
  });

  it('repeats the last frame when one is missing, and acks only real ones', () => {
    const p = new PlayerInputs();
    p.offer({ t: 0, g: 1, s: -1 }, 0);
    expect(p.take(0)).toMatchObject({ extrapolated: false, frame: { g: 1, s: -1 } });
    expect(p.take(1)).toMatchObject({ extrapolated: true, frame: { g: 1, s: -1 } });
    expect(p.lastProcessedTick).toBe(0);
  });

  it('fires boost and respawn on the rising edge only', () => {
    const p = new PlayerInputs();
    p.offer({ t: 0, b: true }, 0);
    p.offer({ t: 1, b: true }, 0);
    expect(p.take(0).boostPressed).toBe(true);
    expect(p.take(1).boostPressed).toBe(false);
    expect(p.take(2).boostPressed).toBe(false); // extrapolated hold
    p.offer({ t: 3, b: false, r: true }, 3);
    expect(p.take(3)).toMatchObject({ boostPressed: false, respawnPressed: true });
  });

  it('maps frames to the truck controls', () => {
    expect(toTruckInput({ s: -0.6, g: 1 })).toEqual({ forward: true, back: false, left: true, right: false, steer: -0.6 });
    expect(toTruckInput({ s: 0.05, g: -0.5 })).toEqual({ forward: false, back: true, left: false, right: false, steer: 0 });
  });
});
