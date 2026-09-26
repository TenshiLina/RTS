# Mandate of Heaven 天命 — East Asian fantasy RTS (prototype)

A Command & Conquer–style base-building RTS set in a mythic Three Kingdoms world: geomancers,
clockwork oxen, elemental academies and — at the end of the tech tree — magitech that mirrors
modern weapons. Visual target: *Red Alert 2, remastered*.

**Status: M0 — foundation + first tier-1 assets.** See [docs/GDD.md](docs/GDD.md) for the design
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the portability plan (WebGL2 now;
Metal / Vulkan / D3D11 and iOS / macOS / Windows / Linux later).

## Run
```bash
npm install
npm run dev          # generates assets, starts the viewer at http://localhost:5173
```
Viewer: **Diorama** shows a tier-1 Azure Dynasty base in Peach Garden Valley; **Gallery** shows
each asset on a turntable with its animations and team colours.
Controls: drag = orbit · right/middle-drag = pan · wheel = zoom · WASD = move · Q/E = rotate · G = build grid.

## Scripts
| Script | What it does |
|---|---|
| `npm run assets` | Build all procedural assets → `public/assets/models/*.glb` (+ baked AO) |
| `npm run dev` / `build` | Viewer dev server / production build (`dist/`) |
| `npm test` | Unit tests: mesh winding, fixed-point determinism, content integrity |
| `npm run shaders:validate` | Compile every shader to SPIR-V (the Vulkan/Metal/D3D11 path) |
| `npx tsx tools/screenshot.ts <dir> "<query>" name …` | Headless screenshots of the viewer |

## Layout
```
content/            rules + faction data (tech tree, costs, stats) — platform-neutral JSON
docs/               GDD, architecture
src/core/           math, noise, material model (shared with tools)
src/sim/            deterministic fixed-point simulation foundation
src/world/          terrain data + biome generator
src/assets/         glTF loader
src/render/         renderer, camera, terrain, animation
src/render/rhi/     render hardware interface + WebGL2 backend + shader translator
src/render/shaders/ GLSL 4.50 (Vulkan dialect) sources
src/platform/       platform interface + web implementation
src/apps/viewer/    asset viewer / diorama
tools/assetgen/     procedural modelling kit, Chinese-roof generator, humanoid rig, recipes
```
