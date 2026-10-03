# Multiplayer server: colyseus relay + server-authoritative race lobbies.
# Build from the repo root:  docker build -f server/Dockerfile .
#
# Each race runs in a child process on a loopback-only port (RACE_PORT_MIN..MAX);
# the server proxies /race/<id> websockets to it, so 2567 is the only port to expose.

# ── Build: bundle the game's simulation for Node (esbuild is a dev dep) ──────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY scripts/build-server-sim.mjs ./scripts/
COPY server ./server
RUN npm run build:server-sim

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/server/build ./server/build
# The race process reads track / vehicle / obstacle definitions as JSON, and
# shares the input mapping with the game client.
COPY src/sim/input-frame.js src/sim/snapshot-wire.js ./src/sim/
COPY src/tracks/*.json ./src/tracks/
COPY track-packs ./track-packs
COPY src/vehicles/*.json ./src/vehicles/
COPY src/obstacles/*.json ./src/obstacles/

ENV RACE_PORT_MIN=22000 RACE_PORT_MAX=22099 RACE_DATA_DIR=/data/races
VOLUME /data
EXPOSE 2567
CMD ["node", "server/index.js"]
