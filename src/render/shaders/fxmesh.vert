#version 450
#include "common.glsl"
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 4) in vec4 iM0;
layout(location = 5) in vec4 iM1;
layout(location = 6) in vec4 iM2;
layout(location = 7) in vec4 iM3;
layout(location = 8) in vec4 iColor;
layout(location = 9) in vec4 iParams; // x material, y age (s), z fade, w seed
layout(location = 0) out vec3 vWorld;
layout(location = 1) out vec3 vNormal;
layout(location = 2) out vec2 vUV;
layout(location = 3) out vec3 vObj;
layout(location = 4) flat out vec4 vColor;
layout(location = 5) flat out vec4 vParams;
void main() {
  mat4 model = mat4(iM0, iM1, iM2, iM3);
  vec3 p = aPos;
  int mat = int(iParams.x + 0.5);
  float t = frame.cameraPos.w;
  if (mat == 2 || mat == 3) {
    // whirlwind funnel: sinuous sway that grows with height
    float ph = t * 2.3 + iParams.w * 30.0;
    p.x += sin(p.y * 2.6 - ph) * 0.22 * p.y;
    p.z += cos(p.y * 2.1 - ph * 0.8) * 0.22 * p.y;
  } else if (mat == 1) {
    // water sheet: rolling surface ripples
    p += aNormal * (vnoise(aUV * vec2(9.0, 6.0) + vec2(0.0, t * 2.5 + iParams.w * 9.0)) - 0.5) * 0.05;
  } else if (mat == 4) {
    // flame shell: licks upward
    p.xz *= 1.0 + (vnoise(vec2(aUV.x * 7.0, aUV.y * 3.0 - t * 4.0)) - 0.5) * 0.35 * aUV.y;
  }
  vec4 w = model * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(model) * aNormal);
  vUV = aUV;
  vObj = aPos;
  vColor = iColor;
  vParams = iParams;
  gl_Position = frame.viewProj * w;
}
