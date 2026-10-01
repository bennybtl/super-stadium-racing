import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { DriveRoom } from "./DriveRoom.js";
import { mountRaceLobbies } from "./lobbies/index.js";

const PORT = Number(process.env.PORT) || 2567;
const ROOM_NAME = "drive";

const app = express();
app.use(cors());
app.use(express.json());

// This colyseus version's built-in matchmake route is POST-only (join/create/
// etc.) — there is no GET room-listing endpoint, so the lobby browser needs
// its own. matchMaker.query() is the same call the old client-side
// `getAvailableRooms()` helper used to wrap.
app.get("/lobbies", async (_req, res) => {
  try {
    const rooms = await matchMaker.query({ name: ROOM_NAME });
    res.json(
      rooms
        .filter((r) => !r.private && !r.unlisted && !r.locked)
        .map((r) => ({
          roomId: r.roomId,
          metadata: r.metadata,
          clients: r.clients,
          maxClients: r.maxClients,
        }))
    );
  } catch (err) {
    console.error("[offroad-server] /lobbies query failed", err);
    res.status(500).json({ error: "failed to list lobbies" });
  }
});

// Server-authoritative race lobbies (docs/MULTIPLAYER.md): each race runs in its
// own child process on a port from RACE_PORT_MIN..RACE_PORT_MAX, which must be
// reachable by clients. PUBLIC_HOST overrides the host handed to them.
const raceLobbies = mountRaceLobbies(app, {
  dataDir: process.env.RACE_DATA_DIR || undefined,
  portMin: Number(process.env.RACE_PORT_MIN) || 22000,
  portMax: Number(process.env.RACE_PORT_MAX) || 22099,
  publicHost: process.env.PUBLIC_HOST || null,
  raceOptions: {
    maxRaceMs: Number(process.env.RACE_MAX_MS) || undefined,
    joinTimeoutMs: Number(process.env.RACE_JOIN_TIMEOUT_MS) || undefined,
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    raceLobbies.stop();
    process.exit(0);
  });
}

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOM_NAME, DriveRoom);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[offroad-server] listening on ws://0.0.0.0:${PORT}`);
  console.log(`[offroad-server] LAN players connect via ws://<this-machine-ip>:${PORT}`);
});
