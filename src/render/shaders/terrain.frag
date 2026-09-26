#version 450
#include "common.glsl"

layout(location = 0) in vec3 vWorldPos;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec4 vSplat;
layout(location = 3) in vec4 vExtra;

layout(set = 1, binding = 1) uniform sampler2DShadow uShadow;

layout(location = 0) out vec4 outColor;

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

// Meadow flowers: sparse coloured dots on a jittered cell grid
vec3 flowers(vec2 p, float density, inout float mask) {
  vec2 cell = floor(p * 2.6);
  vec2 f = fract(p * 2.6);
  float h = hash12(cell);
  vec2 c = vec2(hash12(cell + 11.0), hash12(cell + 23.0)) * 0.7 + 0.15;
  float d = length(f - c);
  float r = 0.07 + 0.05 * hash12(cell + 5.0);
  float on = step(h, density) * smoothstep(r, r * 0.4, d);
  mask = on;
  float k = hash12(cell + 41.0);
  vec3 col = k < 0.2 ? srgb(vec3(0.9, 0.88, 0.82)) : k < 0.5 ? srgb(vec3(0.95, 0.78, 0.25)) : k < 0.8 ? srgb(vec3(0.92, 0.55, 0.7)) : srgb(vec3(0.6, 0.48, 0.88));
  return col;
}

void main() {
  vec2 xz = vWorldPos.xz;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(frame.cameraPos.xyz - vWorldPos);

  // --- lush grass: layered noise for painterly variation
  float big = fbm(xz * 0.035);
  float mid = fbm(xz * 0.18 + 5.0);
  float fine = vnoise(xz * 2.5);
  float blades = vnoise(xz * vec2(14.0, 9.0) + vnoise(xz * 3.0) * 2.0);
  vec3 grassA = srgb(vec3(0.27, 0.37, 0.16));
  vec3 grassB = srgb(vec3(0.35, 0.43, 0.2));
  vec3 grassC = srgb(vec3(0.19, 0.30, 0.14));
  vec3 grass = mix(grassC, mix(grassA, grassB, smoothstep(0.35, 0.7, mid)), smoothstep(0.25, 0.65, big));
  grass *= 0.86 + 0.18 * fine + 0.1 * blades;
  // sun-bleached tips
  grass = mix(grass, srgb(vec3(0.56, 0.58, 0.32)), smoothstep(0.72, 0.95, fbm(xz * 0.09 + 13.0)) * 0.3);

  // --- dirt / path
  float peb = vnoise(xz * 7.0);
  vec3 dirt = srgb(vec3(0.47, 0.38, 0.27)) * (0.8 + 0.25 * fbm(xz * 0.6) + 0.15 * step(0.78, peb));
  // --- rock
  vec3 rock = srgb(vec3(0.52, 0.5, 0.46)) * (0.7 + 0.45 * fbm(xz * 0.4 + vWorldPos.y * 0.3));
  // --- sand / shore
  vec3 sand = srgb(vec3(0.74, 0.66, 0.48)) * (0.9 + 0.12 * fine);
  // --- jade-tinted soil around deposits
  vec3 jadeSoil = mix(dirt * 0.8, srgb(vec3(0.16, 0.36, 0.27)), 0.5 + 0.2 * mid);

  float slope = 1.0 - N.y;
  float rockW = max(vSplat.b, smoothstep(0.28, 0.45, slope + (mid - 0.5) * 0.15));
  // noisy splat boundaries look hand-painted instead of blurry
  float dirtW = smoothstep(0.35, 0.65, vSplat.g + (fine - 0.5) * 0.35);
  float sandW = smoothstep(0.35, 0.65, vExtra.b + (fine - 0.5) * 0.3);
  float jadeW = smoothstep(0.3, 0.7, vSplat.a + (mid - 0.5) * 0.3);

  vec3 albedo = grass;
  float mask = 0.0;
  vec3 fl = flowers(xz, vExtra.g * 0.18 * (1.0 - dirtW), mask);
  albedo = mix(albedo, fl, mask);
  albedo = mix(albedo, dirt, dirtW);
  albedo = mix(albedo, jadeSoil, jadeW);
  albedo = mix(albedo, sand, sandW);
  albedo = mix(albedo, rock, rockW);

  // bump
  float e = 0.05;
  float h0 = fbm(xz * 1.3) * (0.3 + rockW) + blades * 0.05 * (1.0 - rockW);
  float hx = fbm((xz + vec2(e, 0.0)) * 1.3) * (0.3 + rockW) + vnoise((xz + vec2(e, 0.0)) * vec2(14.0, 9.0) + vnoise((xz + vec2(e, 0.0)) * 3.0) * 2.0) * 0.05 * (1.0 - rockW);
  float hz = fbm((xz + vec2(0.0, e)) * 1.3) * (0.3 + rockW) + vnoise((xz + vec2(0.0, e)) * vec2(14.0, 9.0) + vnoise((xz + vec2(0.0, e)) * 3.0) * 2.0) * 0.05 * (1.0 - rockW);
  N = normalize(N + vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.22);

  float rough = mix(0.92, 0.75, rockW);
  float ao = vExtra.r;
  float shadow = sampleShadow(uShadow, vWorldPos, N);
  vec3 col = shadeSurface(albedo, rough, 0.0, N, V, ao, shadow);

  // jade glow veins
  if (jadeW > 0.01) {
    float vein = smoothstep(0.47, 0.5, fbm(xz * 1.8)) * smoothstep(0.53, 0.5, fbm(xz * 1.8));
    col += srgb(vec3(0.3, 1.0, 0.65)) * vein * jadeW * (0.6 + 0.4 * sin(frame.cameraPos.w * 1.5 + xz.x));
  }

  // build grid overlay
  if (frame.grid.y > 0.0) {
    vec2 g = abs(fract(xz / frame.grid.x + 0.5) - 0.5) * frame.grid.x;
    float line = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
    col = mix(col, vec3(0.9, 0.95, 1.0), line * frame.grid.y);
  }

  col = applyFog(col, vWorldPos);
  outColor = vec4(col, 1.0);
}
