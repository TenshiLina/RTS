#version 450
#include "common.glsl"
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUV;       // atlas uv; for trails: x = across (0..1), y = along (m)
layout(location = 2) in vec4 aColor;    // linear-ish colour, a = opacity
layout(location = 3) in float aIntensity; // HDR multiplier
layout(location = 4) in vec4 aParams;   // x: mode | soft<<4 | localU<<5 | localV<<6, y: age (trails: along fraction), z: seed
layout(location = 0) out vec2 vUV;
layout(location = 1) out vec4 vColor;
layout(location = 2) out float vIntensity;
layout(location = 3) out vec3 vWorld;
layout(location = 4) out vec2 vLocal;
layout(location = 5) flat out vec4 vParams; // x = mode, y = soft, z = age/along, w = seed
void main() {
  int bits = int(aParams.x * 255.0 + 0.5);
  vUV = aUV;
  vColor = aColor;
  vIntensity = aIntensity;
  vWorld = aPos;
  vLocal = vec2(float((bits >> 5) & 1), float((bits >> 6) & 1));
  vParams = vec4(float(bits & 15), float((bits >> 4) & 1), aParams.y, aParams.z);
  gl_Position = frame.viewProj * vec4(aPos, 1.0);
}
