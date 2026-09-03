# Build the static client bundle.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Serve dist/ with the cross-origin-isolation headers Havok's WASM
# (SharedArrayBuffer) needs.
FROM node:22-alpine AS serve
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY web ./web
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "web/serveStatic.js"]
