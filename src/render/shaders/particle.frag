#version 450
#include "common.glsl"
layout(location = 0) in vec2 vUV;
layout(location = 1) in vec4 vColor;
layout(location = 2) in float vIntensity;
layout(location = 3) in vec3 vWorld;
layout(set = 1, binding = 0) uniform sampler2D uAtlas;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 t = texture(uAtlas, vUV);
  vec3 c = vColor.rgb * t.rgb * vIntensity;
  float a = vColor.a * t.a;
#ifdef ADDITIVE
  outColor = vec4(c * a, 0.0);
#else
  // alpha particles (smoke, dust) are lit a little by the sky and fogged like the world
  c *= mix(vec3(1.0), frame.skyColor.rgb * frame.skyColor.w * 1.6 + frame.sunColor.rgb * frame.sunDir.w * 0.25, 0.65);
  c = applyFog(c, vWorld);
  outColor = vec4(c * a, a);
#endif
}
