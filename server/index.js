import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { mountRaceLobbies } from "./lobbies/index.js";
import { startIdleShutdown } from "./idleShutdown.js";

const PORT = Number(process.env.PORT) || 2567;

const app = express();
app.use(cors());
app.use(express.json());

// Server-authoritative race lobbies (docs/MULTIPLAYER.md): each race runs in its
// own child process on a loopback port from RACE_PORT_MIN..RACE_PORT_MAX, reached
// by clients through this server's one port at /race/<raceId>.
const raceLobbies = mountRaceLobbies(app, {
  dataDir: process.env.RACE_DATA_DIR || undefined,
  portMin: Number(process.env.RACE_PORT_MIN) || 22000,
  portMax: Number(process.env.RACE_PORT_MAX) || 22099,
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

raceLobbies.attach(httpServer);
startIdleShutdown({
  isIdle: () => raceLobbies.registry.size === 0 && raceLobbies.supervisor.activeCount === 0,
  minutes: Number(process.env.IDLE_SHUTDOWN_MINUTES),
  cluster: process.env.ECS_CLUSTER,
  service: process.env.ECS_SERVICE,
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`[offroad-server] listening on ws://0.0.0.0:${PORT}`);
  console.log(`[offroad-server] LAN players connect via http://<this-machine-ip>:${PORT}`);
});
