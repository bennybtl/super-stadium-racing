# Multiplayer server: colyseus relay + server-authoritative race lobbies.
# Build from the repo root:  docker build -f server/Dockerfile .
#
# Each race runs in a child process on its own port (RACE_PORT_MIN..MAX), so
# that range must be published alongside 2567 and reachable by clients; set
# PUBLIC_HOST if clients reach races by a different name than the API.

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
# The race process reads track / vehicle / obstacle definitions as JSON.
COPY src/tracks/*.json ./src/tracks/
COPY track-packs ./track-packs
COPY src/vehicles/*.json ./src/vehicles/
COPY src/obstacles/*.json ./src/obstacles/

ENV RACE_PORT_MIN=22000 RACE_PORT_MAX=22099 RACE_DATA_DIR=/data/races
VOLUME /data
EXPOSE 2567 22000-22099
CMD ["node", "server/index.js"]
