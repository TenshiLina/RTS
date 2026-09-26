#version 450
#include "common.glsl"

layout(location = 0) in vec3 vWorldPos;

layout(set = 1, binding = 0) uniform WaterUniforms {
  vec4 heightmapRect; // xy = origin (world xz), zw = 1/size
  vec4 shallow;       // rgb, a = unused
  vec4 deep;          // rgb, a = depth scale
} water;
layout(set = 1, binding = 1) uniform sampler2DShadow uShadow;
layout(set = 1, binding = 2) uniform sampler2D uHeight;
layout(set = 1, binding = 3) uniform sampler2D uFxMap;

layout(location = 0) out vec4 outColor;

float waves(vec2 p, float t) {
  return vnoise(p * 0.35 + vec2(t * 0.08, t * 0.05)) * 0.6 + vnoise(p * 0.9 - vec2(t * 0.11, -t * 0.07)) * 0.3 + vnoise(p * 2.4 + vec2(-t * 0.2, t * 0.16)) * 0.1;
}

void main() {
  float t = frame.cameraPos.w;
  vec2 xz = vWorldPos.xz;
  vec2 huv = (xz - water.heightmapRect.xy) * water.heightmapRect.zw;
  float ground = texture(uHeight, huv).r;
  float depth = vWorldPos.y - ground;
  if (depth <= 0.0) discard;

  float e = 0.1;
  float h0 = waves(xz, t), hx = waves(xz + vec2(e, 0.0), t), hz = waves(xz + vec2(0.0, e), t);
  vec3 N = normalize(vec3(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
  vec3 V = normalize(frame.cameraPos.xyz - vWorldPos);
  vec3 L = frame.sunDir.xyz;

  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(frame.fogColor.rgb, frame.skyColor.rgb * 1.3, clamp(R.y, 0.0, 1.0));
  float shadow = sampleShadow(uShadow, vWorldPos, vec3(0.0, 1.0, 0.0));
  float spec = pow(max(dot(R, L), 0.0), 300.0) * 12.0 * shadow;

  float dk = 1.0 - exp(-depth * water.deep.a);
  vec3 body = mix(water.shallow.rgb, water.deep.rgb, dk) * (frame.skyColor.w * 0.7 + max(L.y, 0.0) * frame.sunDir.w * 0.35 * mix(0.6, 1.0, shadow));
  vec3 col = mix(body, sky, fres * 0.8) + frame.sunColor.rgb * spec;

  // shore foam
  float foam = smoothstep(0.35, 0.0, depth) * (0.55 + 0.45 * sin(depth * 30.0 - t * 2.0 + vnoise(xz * 2.0) * 4.0));
  foam += smoothstep(0.62, 0.8, vnoise(xz * 1.2 + t * 0.1)) * 0.12 * (1.0 - dk);
  col = mix(col, vec3(0.95) * (frame.skyColor.w + frame.sunDir.w * 0.5), clamp(foam, 0.0, 1.0) * 0.8);

  float alpha = clamp(smoothstep(0.0, 0.25, depth) * 0.75 + fres * 0.25 + foam * 0.3, 0.0, 0.96);
  // magic light glints on the surface
  col += pointLights(vWorldPos + vec3(0.0, 0.3, 0.0), N) * (0.15 + fres);

  // frozen by ice magic: an opaque sheet with cracks and a cold sheen
  float frost = texture(uFxMap, terrainUV(xz)).g;
  if (frost > 0.02) {
    vec2 re = mat2(0.8, -0.6, 0.6, 0.8) * xz;
    float cell = 1.0 - abs(vnoise(re * 1.4) * 2.0 - 1.0);
    float cracks = smoothstep(0.93, 0.99, cell) + smoothstep(0.95, 0.995, 1.0 - abs(vnoise(re * 4.0 + 3.0) * 2.0 - 1.0)) * 0.6;
    float cover = smoothstep(0.15, 0.45, frost + (vnoise(xz * 0.8) - 0.5) * 0.3);
    vec3 Ni = normalize(vec3((vnoise(xz * 3.0) - 0.5) * 0.15, 1.0, (vnoise(xz * 3.0 + 7.0) - 0.5) * 0.15));
    float fi = 0.04 + 0.96 * pow(1.0 - max(dot(Ni, V), 0.0), 5.0);
    vec3 Ri = reflect(-V, Ni);
    vec3 ice = mix(vec3(0.42, 0.62, 0.78), vec3(0.85, 0.93, 1.0), 0.35 + 0.3 * vnoise(xz * 0.7)) * (frame.skyColor.w + frame.sunDir.w * 0.45 * shadow);
    ice = mix(ice, mix(frame.fogColor.rgb, frame.skyColor.rgb * 1.4, clamp(Ri.y, 0.0, 1.0)), fi * 0.6);
    ice += frame.sunColor.rgb * pow(max(dot(Ri, L), 0.0), 120.0) * 4.0 * shadow;
    ice = mix(ice, vec3(0.95, 0.98, 1.0), cracks * 0.7);
    col = mix(col, ice, cover);
    alpha = mix(alpha, 0.97, cover);
  }
  col = applyFog(col, vWorldPos);
  outColor = vec4(col, alpha);
}
