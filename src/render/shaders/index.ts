// Shader library. Sources are GLSL 4.50 (Vulkan dialect); `#include "x.glsl"` is resolved here so
// the exact same expanded source can be fed to glslang for native backends.

import common from './common.glsl?raw';
import meshVert from './mesh.vert?raw';
import meshFrag from './mesh.frag?raw';
import depthFrag from './depth.frag?raw';
import depthSimpleFrag from './depthSimple.frag?raw';
import skyVert from './sky.vert?raw';
import skyFrag from './sky.frag?raw';
import terrainVert from './terrain.vert?raw';
import terrainFrag from './terrain.frag?raw';
import waterVert from './water.vert?raw';
import waterFrag from './water.frag?raw';
import fullscreenVert from './fullscreen.vert?raw';
import bloomFrag from './bloom.frag?raw';
import compositeFrag from './composite.frag?raw';
import overlayVert from './overlay.vert?raw';
import overlayFrag from './overlay.frag?raw';
import particleVert from './particle.vert?raw';
import particleFrag from './particle.frag?raw';
import uiVert from './ui.vert?raw';
import uiFrag from './ui.frag?raw';

const includes: Record<string, string> = { 'common.glsl': common };

export function resolveIncludes(src: string): string {
  return src.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_m, name) => {
    const inc = includes[name];
    if (inc === undefined) throw new Error(`shader include not found: ${name}`);
    return inc;
  });
}

const raw = {
  meshVert, meshFrag, depthFrag, depthSimpleFrag, skyVert, skyFrag, terrainVert, terrainFrag, waterVert, waterFrag, fullscreenVert, bloomFrag, compositeFrag, overlayVert, overlayFrag, particleVert, particleFrag, uiVert, uiFrag,
};
export type ShaderName = keyof typeof raw;
export const SHADERS = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolveIncludes(v)])) as Record<ShaderName, string>;
