// GLSL 4.50 (Vulkan dialect) → GLSL ES 3.00 translation for the WebGL2 backend.
//
// Authoring rules (enforced here, and validated to SPIR-V by `npm run shaders:validate`):
//   * uniform blocks:   layout(set = S, binding = B) uniform Name { ... } inst;
//   * textures:         layout(set = S, binding = B) uniform sampler2D name;   (combined samplers)
//   * stage IO:         layout(location = N) in/out ...
//   * gl_VertexIndex / gl_InstanceIndex (Vulkan names)
// Resource slot = set * 4 + binding (both for UBO binding points and texture units).

export interface ShaderReflection {
  blocks: { name: string; slot: number }[];
  samplers: { name: string; slot: number }[];
}

export const slotOf = (set: number, binding: number) => set * 4 + binding;

export function translateToES300(src: string, stage: 'vertex' | 'fragment', defines: Record<string, string | number | boolean> = {}, extraDefines: Record<string, string | number> = {}): { code: string; refl: ShaderReflection } {
  const refl: ShaderReflection = { blocks: [], samplers: [] };
  let body = src.replace(/^\s*#version\s+\d+.*$/m, '');

  // uniform blocks
  body = body.replace(/layout\s*\(\s*set\s*=\s*(\d+)\s*,\s*binding\s*=\s*(\d+)\s*(?:,\s*std140\s*)?\)\s*uniform\s+(\w+)\s*\{/g, (_m, s, b, name) => {
    refl.blocks.push({ name, slot: slotOf(+s, +b) });
    return `layout(std140) uniform ${name} {`;
  });
  // samplers
  body = body.replace(/layout\s*\(\s*set\s*=\s*(\d+)\s*,\s*binding\s*=\s*(\d+)\s*\)\s*uniform\s+(sampler2DShadow|sampler2D|usampler2D|isampler2D|sampler3D|samplerCube)\s+(\w+)\s*;/g, (_m, s, b, type, name) => {
    refl.samplers.push({ name, slot: slotOf(+s, +b) });
    return `uniform highp ${type} ${name};`;
  });
  // stage IO: ES 3.00 allows layout(location) only on VS inputs and FS outputs
  if (stage === 'vertex') {
    body = body.replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*(?:flat\s+)?out\s/g, (m) => (m.includes('flat') ? 'flat out ' : 'out '));
  } else {
    body = body.replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*((?:flat\s+)?in)\s/g, '$1 ');
  }
  body = body.replace(/\bgl_VertexIndex\b/g, 'gl_VertexID').replace(/\bgl_InstanceIndex\b/g, 'gl_InstanceID');

  const defs = { ...defines, ...extraDefines };
  const defLines = Object.entries(defs)
    .filter(([, v]) => v !== false)
    .map(([k, v]) => `#define ${k} ${v === true ? 1 : v}`)
    .join('\n');
  const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DShadow;
precision highp usampler2D;
#define BACKEND_WEBGL2 1
#define ${stage === 'vertex' ? 'STAGE_VERTEX' : 'STAGE_FRAGMENT'} 1
${defLines}
`;
  return { code: header + body, refl };
}
