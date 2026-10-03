import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wakeServer, canWakeServer } from '../src/net/server-config.js';

const FAST = { intervalMs: 0, timeoutMs: 1000 };

/** fetch stub: `/race-tracks` answers per `probes` (true = up), `/wake` per `wake`. */
function stubServer({ probes, wake = { ok: true } }) {
  const calls = { probe: 0, wake: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url.endsWith('/wake')) {
      calls.wake++;
      if (wake instanceof Error) throw wake;
      return wake;
    }
    return { ok: probes[Math.min(calls.probe++, probes.length - 1)] };
  }));
  return calls;
}

beforeEach(() => vi.stubEnv('DEV', false)); // production build: no same-host dev fallback

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('wakeServer', () => {
  it('does nothing when no server is configured', async () => {
    vi.stubEnv('VITE_SERVER_URL', '');
    const calls = stubServer({ probes: [true] });
    expect(canWakeServer()).toBe(false);
    expect(await wakeServer(FAST)).toBe(false);
    expect(calls).toEqual({ probe: 0, wake: 0 });
  });

  it('returns at once when the server is already up', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://race.test');
    const calls = stubServer({ probes: [true] });
    expect(await wakeServer(FAST)).toBe(true);
    expect(calls.wake).toBe(0);
  });

  it('wakes a stopped server and waits for it to answer', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://race.test');
    const calls = stubServer({ probes: [false, false, false, true] });
    expect(canWakeServer()).toBe(true);
    expect(await wakeServer(FAST)).toBe(true);
    expect(calls.wake).toBe(1);
  });

  it('gives up when there is no /wake endpoint or it errors', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://race.test');
    stubServer({ probes: [false], wake: { ok: false } });
    expect(await wakeServer(FAST)).toBe(false);
    stubServer({ probes: [false], wake: new Error('network') });
    expect(await wakeServer(FAST)).toBe(false);
  });

  it('times out when the server never comes up', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://race.test');
    stubServer({ probes: [false] });
    expect(await wakeServer({ intervalMs: 10, timeoutMs: 50 })).toBe(false);
  });
});
