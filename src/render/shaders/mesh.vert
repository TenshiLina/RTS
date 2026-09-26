#version 450
#include "common.glsl"

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec4 aColor;   // rgb base colour (linear), a = team blend
layout(location = 4) in vec4 aMat;     // roughness, metallic, pattern/255, emissive/8
layout(location = 5) in vec4 aExtra;   // ao, sway, -, -
layout(location = 6) in uvec4 aJoints;
// per-instance
layout(location = 8) in vec4 iM0;
layout(location = 9) in vec4 iM1;
layout(location = 10) in vec4 iM2;
layout(location = 11) in vec4 iM3;
layout(location = 12) in vec4 iParams; // x team, y joint row (-1 = static), z highlight, w build clip height (object space)

layout(set = 1, binding = 0) uniform sampler2D uJoints; // RGBA32F, 3 texels (rows of an affine 3x4) per joint

layout(location = 0) out vec3 vWorldPos;
layout(location = 1) out vec3 vNormal;
layout(location = 2) out vec2 vUV;
layout(location = 3) out vec4 vColor;
layout(location = 4) out vec4 vMat;
layout(location = 5) out vec4 vExtra;
layout(location = 6) out vec3 vObjPos;
layout(location = 7) flat out vec4 vInst;

void main() {
  mat4 model = mat4(iM0, iM1, iM2, iM3);
  vec3 pos = aPos;
  vec3 nrm = aNormal;
#ifndef DEPTH_ONLY_STATIC
  if (iParams.y >= 0.0) {
    int row = int(iParams.y);
    int j = int(aJoints.x) * 3;
    vec4 r0 = texelFetch(uJoints, ivec2(j, row), 0);
    vec4 r1 = texelFetch(uJoints, ivec2(j + 1, row), 0);
    vec4 r2 = texelFetch(uJoints, ivec2(j + 2, row), 0);
    vec4 p = vec4(aPos, 1.0);
    pos = vec3(dot(r0, p), dot(r1, p), dot(r2, p));
    nrm = vec3(dot(r0.xyz, aNormal), dot(r1.xyz, aNormal), dot(r2.xyz, aNormal));
  }
#endif
  vec4 world = model * vec4(pos, 1.0);
  world.xyz += windOffset(world.xyz, aExtra.y);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(model) * nrm);
  vUV = aUV;
  vColor = vec4(aColor.rgb * aColor.rgb, aColor.a); // colour is sqrt-encoded in the vertex
  vMat = aMat;
  vExtra = aExtra;
  vObjPos = pos;
  vInst = iParams;
#ifdef SHADOW_PASS
  gl_Position = frame.shadowViewProj * world;
#else
  gl_Position = frame.viewProj * world;
#endif
}
