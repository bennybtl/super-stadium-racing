import { describe, it, expect } from 'vitest';
import {
  cleanText, cleanKey, cleanMaxClients, cleanLaps, takeToken, STATE_BURST, STATE_RATE,
} from '../server/validate.js';

describe('server validate helpers', () => {
  it('cleans display text', () => {
    expect(cleanText('  Ben\u0007  ', 'Racer')).toBe('Ben');
    expect(cleanText(42, 'Racer')).toBe('Racer');
    expect(cleanText('   ', 'Racer')).toBe('Racer');
    expect(cleanText('x'.repeat(100), 'Racer')).toHaveLength(24);
  });

  it('accepts filename-ish keys, rejects junk', () => {
    expect(cleanKey('dust_devil')).toBe('dust_devil');
    expect(cleanKey('My Track (2)')).toBe('My Track (2)');
    expect(cleanKey({ evil: true })).toBeNull();
    expect(cleanKey('')).toBeNull();
    expect(cleanKey('a\nb')).toBeNull();
    expect(cleanKey('k'.repeat(65))).toBeNull();
  });

  it('clamps room size and laps', () => {
    expect(cleanMaxClients(1e6, 8)).toBe(8);
    expect(cleanMaxClients(0, 8)).toBe(2);
    expect(cleanMaxClients('lots', 8)).toBe(8);
    expect(cleanLaps(NaN, 3)).toBe(3);
    expect(cleanLaps(1000, 3)).toBe(20);
    expect(cleanLaps(2.6, 3)).toBe(3);
  });

  it('rate-limits with a token bucket', () => {
    const b = {};
    let ok = 0;
    for (let i = 0; i < 50; i++) if (takeToken(b, 0)) ok++;
    expect(ok).toBe(STATE_BURST); // a burst at one instant
    ok = 0;
    for (let t = 1; t <= 1000; t++) if (takeToken(b, t)) ok++; // 1 kHz flood for 1 s
    expect(ok).toBeLessThanOrEqual(STATE_RATE + 1);
    const steady = {};
    let sent = 0, tries = 0;
    for (let t = 0; t < 10000; t += 1000 / 15, tries++) sent += takeToken(steady, t) ? 1 : 0; // real 15 Hz
    expect(sent).toBe(tries); // a well-behaved client never loses an update
  });
});

