#version 450
#include "common.glsl"
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;   // linear-ish colour, a = opacity
layout(location = 3) in float aIntensity; // HDR multiplier
layout(location = 0) out vec2 vUV;
layout(location = 1) out vec4 vColor;
layout(location = 2) out float vIntensity;
layout(location = 3) out vec3 vWorld;
void main() {
  vUV = aUV;
  vColor = aColor;
  vIntensity = aIntensity;
  vWorld = aPos;
  gl_Position = frame.viewProj * vec4(aPos, 1.0);
}
