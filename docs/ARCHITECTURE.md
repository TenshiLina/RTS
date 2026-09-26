# Architecture — built to port

Target today: **browser / WebGL2**. Targets later: **iOS, macOS, Windows, Linux** with
**Metal, Vulkan and Direct3D 11** backends. The codebase is layered so that each of those is an
*implementation of an interface*, not a rewrite.

```
 ┌──────────────────────── apps (viewer today; game client, editor later) ───────────────────────┐
 │  src/apps/*            — only layer allowed to wire platform + renderer + sim together        │
 ├──────────────┬──────────────────────┬──────────────────────┬──────────────────────────────────┤
 │  src/sim     │  src/render          │  src/assets          │  src/platform                    │
 │  determin-   │  Renderer, camera,   │  glTF loader →       │  Platform interface              │
 │  istic       │  terrain, animation  │  backend-neutral     │  (input, timing, files, storage) │
 │  fixed-point │        │             │  ModelData           │    └─ web/  (DOM lives ONLY here) │
 │  lockstep    │  src/render/rhi ◄────┘                      │    └─ ios/ macos/ win/ linux/ …   │
 │              │   types.ts  (the RHI)                       │                                  │
 │              │   webgl2/   (backend #1)                    │                                  │
 │              │   webgpu/ metal/ vulkan/ d3d11/ (planned)   │                                  │
 ├──────────────┴──────────────────────┴──────────────────────┴──────────────────────────────────┤
 │  src/core  — math, noise, material model. No dependencies. Shared with tools.                  │
 ├───────────────────────────────────────────────────────────────────────────────────────────────┤
 │  content/*.json  (rules, factions, tech tree)   public/assets/*.glb   src/render/shaders/*.glsl │
 │  — platform-neutral data read by every build                                                   │
 └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Rules that keep it portable
1. **No DOM / browser API outside `src/platform/web/`** (the viewer app's dev-tool UI is the only
   exception and is not part of the game). The in-game UI (sidebar, cameos) will be drawn by the
   renderer, not HTML, so it ports as-is.
2. **The renderer only talks to the RHI** (`src/render/rhi/types.ts`), never to WebGL.
3. **The simulation is deterministic**: Q16.16 fixed-point (`src/sim/fixed.ts`), its own PRNG,
   fixed tick (15 Hz), no floats in sim state, no `Math.random`, no wall-clock. Rendering
   interpolates between ticks in floats. This gives lockstep multiplayer + replays, and lets a
   native port be verified bit-for-bit against golden replays.
4. **Content is data** (`content/*.json`): stats, costs, prerequisites, tiers. No gameplay numbers
   in code.
5. **Assets are standard glTF 2.0**; engine-specific bits live in `extras` so the files still
   open in Blender or any viewer.

## RHI (Render Hardware Interface)
Modelled on the explicit APIs, so the native backends are thin:

| RHI concept | WebGL2 (now) | Metal | Vulkan | Direct3D 11 |
|---|---|---|---|---|
| `Pipeline` (shader + vertex layout + raster/depth/blend) | program + cached GL state | `MTLRenderPipelineState` + `MTLDepthStencilState` | `VkPipeline` | shaders + input layout + state objects |
| Bind group (set) / binding | UBO binding point / texture unit = `set*4+binding` | argument table indices | descriptor set | `b#` / `t#` / `s#` registers |
| Uniform buffer + dynamic offset | `bindBufferRange` | `setVertexBuffer:offset:` | dynamic UBO offset | `*SSetConstantBuffers1` |
| Render pass (load/clear, MSAA resolve) | FBO + clear + `blitFramebuffer` | `MTLRenderPassDescriptor` | render pass / dynamic rendering | OMSetRenderTargets + Clear + ResolveSubresource |
| Comparison sampler (shadows) | `TEXTURE_COMPARE_MODE` | `MTLSamplerDescriptor.compareFunction` | `compareEnable` | `D3D11_FILTER_COMPARISON_*` |
| Instancing | `drawElementsInstanced` | `drawIndexedPrimitives:instanceCount:` | `vkCmdDrawIndexed` | `DrawIndexedInstanced` |

The device reports its **clip-space convention** (`depthZeroToOne`, `flipY`, `uvOriginTop`); all
projection/shadow matrices are built through `core/math.ts` helpers that honour it. Nothing uses
bindless, compute or other features D3D11/WebGL2 lack; skinned instancing uses a joint-matrix
texture read with `texelFetch` (supported everywhere).

## Shaders — one source, every backend
* Authored once in **GLSL 4.50, Vulkan dialect** (`src/render/shaders/`): `layout(set, binding)`
  uniform blocks (std140), combined samplers, `layout(location)` IO.
* **WebGL2**: translated at runtime to GLSL ES 3.00 (`rhi/shaderTranslate.ts`).
* **Native**: `glslang → SPIR-V` (Vulkan as-is) `→ SPIRV-Cross → MSL` (Metal) / `HLSL SM5` (D3D11).
* `npm run shaders:validate` compiles **every pipeline variant to SPIR-V** today, so the native
  path is continuously checked. (Output: `dist/spirv/*.spv`.)

## Asset pipeline
* `tools/assetgen/` — a procedural modelling kit (primitives, sweeps, lathes, the parametric
  Chinese-roof generator, a humanoid rig) plus one recipe per asset.
* Build: recipe → mesh → **baked per-vertex AO** (BVH ray-cast) → **glTF .glb** with materials,
  rigid skin + baked animations (idle/walk/attack/harvest), sockets (`socket_muzzle`, `socket_rally`,
  …) → `public/assets/models/` + `manifest.json`.
* Materials: PBR factors + `extras.pattern/team/sway`. The loader flattens them into per-vertex
  attributes → **one draw call per model, instanced** on every backend. Procedural surface
  patterns (roof tiles, wood grain, lamellar armour, brick…) are evaluated in the shader, so no
  texture memory is needed — ideal for mobile.
* Artists can later replace any recipe output with a hand-authored .glb that follows the same
  conventions (material extras, joint names, sockets); nothing downstream changes.

## Port paths
* **Recommended (full native)**: a C++ (or Rust) host implementing `Platform` + one RHI backend
  per API, consuming the same `content/`, `.glb` and SPIR-V/MSL/HLSL. The sim is ported as a
  straight transliteration of `src/sim` and verified against golden replays (lockstep checksums).
* **Fast path (shipping sooner)**: wrap the web build in a native shell. On Windows the WebGL2 path
  already runs on **D3D11 via ANGLE**; on macOS/iOS on **Metal via ANGLE/WebKit**. A WebGPU backend
  (Dawn/wgpu → Metal/Vulkan/D3D12) is the natural second RHI implementation.

## Frame (current renderer)
`shadow depth (2048², PCF) → main HDR pass, 4×MSAA [terrain → instanced meshes → sky → water] →
resolve → dual-filter bloom (5 levels) → ACES tonemap + grade + vignette → backbuffer`.
