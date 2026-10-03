import { WebSocket, WebSocketServer } from "ws";

/**
 * Relays `/race/<raceId>` websocket upgrades on the public server to the race
 * process, which listens on loopback only — so one port serves the API, the
 * relay lobby and every race. Anything else goes to `fallback` (colyseus).
 *
 * Messages and close codes pass through untouched; the race process still does
 * all auth (`hello` token) and rate limiting.
 */

const RACE_PATH = /^\/race\/([A-Za-z0-9_-]+)$/;
const MAX_PAYLOAD = 4096; // matches the race process
const MAX_BUFFERED = 1 << 20; // drop a client that can't keep up rather than buffer without bound

export function attachRaceProxy(httpServer, { portFor, fallback }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

  httpServer.on("upgrade", (req, socket, head) => {
    const id = RACE_PATH.exec(req.url.split("?")[0])?.[1];
    if (!id) return fallback(req, socket, head);
    const port = portFor(id);
    if (port === null) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${port}`, { perMessageDeflate: false });
      const pending = [];
      client.on("message", (data, isBinary) => {
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        else if (pending.length < 64) pending.push([data, isBinary]);
      });
      upstream.on("open", () => {
        for (const [data, isBinary] of pending.splice(0)) upstream.send(data, { binary: isBinary });
      });
      upstream.on("message", (data, isBinary) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount > MAX_BUFFERED) client.terminate();
        else client.send(data, { binary: isBinary });
      });
      // 1005/1006 aren't sendable close codes; map them to a normal close.
      const closeWith = (ws, code, reason) =>
        ws.readyState <= WebSocket.OPEN && ws.close(code >= 1000 && code !== 1005 && code !== 1006 ? code : 1000, reason);
      client.on("close", (code, reason) => closeWith(upstream, code, reason));
      upstream.on("close", (code, reason) => closeWith(client, code, reason));
      client.on("error", () => upstream.terminate());
      upstream.on("error", () => client.terminate());
    });
  });
}
