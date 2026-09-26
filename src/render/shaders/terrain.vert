#version 450
#include "common.glsl"

layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aSplat;  // r = lush grass, g = dirt, b = rock, a = jade-scorched
layout(location = 3) in vec4 aExtra;  // r = ao, g = flowers, b = sand, a = cliff

layout(location = 0) out vec3 vWorldPos;
layout(location = 1) out vec3 vNormal;
layout(location = 2) out vec4 vSplat;
layout(location = 3) out vec4 vExtra;

void main() {
  vWorldPos = aPos;
  vNormal = aNormal;
  vSplat = aSplat;
  vExtra = aExtra;
#ifdef SHADOW_PASS
  gl_Position = frame.shadowViewProj * vec4(aPos, 1.0);
#else
  gl_Position = frame.viewProj * vec4(aPos, 1.0);
#endif
}
