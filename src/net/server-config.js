/**
 * Where the multiplayer server is, and whether it's there.
 *
 * Multiplayer is opt-in: a build only offers it when it has a server address
 * (VITE_SERVER_URL, e.g. "https://race.example.com:2567") and that server
 * answers. `npm run dev` falls back to the page's own host on the server's
 * default port so local and LAN play need no setup. With neither, the game is
 * single-player only — the static-site deployment.
 */

const DEV_PORT = 2567;
const PROBE_TIMEOUT_MS = 3000;

/** http(s) base URL of the multiplayer server, or null when none is configured. */
export function serverUrl() {
  const configured = import.meta.env.VITE_SERVER_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:${DEV_PORT}`;
  return null;
}

/** ws(s) form of serverUrl() for the relay lobby's websocket client. */
export function serverWsUrl() {
  const url = serverUrl();
  return url && url.replace(/^http/, 'ws');
}

/** ws(s) URL of a race: the lobby view's `race.path` on the multiplayer server. */
export function raceWsUrl(path) {
  return serverWsUrl() + path;
}

/** True when a server is configured and answers. Never throws. */
export async function probeServer() {
  const url = serverUrl();
  if (!url) return false;
  try {
    const res = await fetch(`${url}/race-tracks`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}
