# Offroad

A 3D top-down off-road racing game built with Babylon.js, Vite, and Vue.

## Quick Start

1. Install dependencies:

```bash
npm ci
```

2. Start local dev server:

```bash
npm run dev
```

3. Build production output:

```bash
npm run build
```

## Scripts

- npm run dev: run Vite dev server
- npm run build: run production build and asset optimization
- npm run build:raw: run plain Vite production build
- npm run build:optimize: optimize built assets in dist
- npm run preview: preview production build locally

## Production Build Output

The production build is emitted to the dist folder.

The build pipeline includes post-processing to reduce deployment size:

- WAV to OGG conversion for audio assets
- PNG/JPG recompression
- Selective conversion of PNG assets to JPG/WEBP
- Automatic rewrite of built asset URLs after conversion

## GitHub Pages Deployment

This repo is configured for GitHub Pages via GitHub Actions.

Workflow file:

- .github/workflows/deploy-pages.yml

### One-time GitHub setup

1. Push this repository to GitHub.
2. Open repository settings.
3. Go to Pages.
4. Set Source to GitHub Actions.

### Deploy flow

- Every push to main triggers the Pages workflow.
- The workflow runs npm ci and npm run build.
- The dist folder is uploaded and deployed.
- The workflow automatically sets the correct Vite base path for:
  - User/organization sites
  - Project sites

## Notes

- This is a static site deployment (no server runtime required).
- For local testing of the production bundle:

```bash
npm run preview
```
