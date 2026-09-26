#version 450
#include "common.glsl"

layout(location = 0) in vec3 vWorldPos;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec4 vSplat;
layout(location = 3) in vec4 vExtra;

layout(set = 1, binding = 1) uniform sampler2DShadow uShadow;
layout(set = 1, binding = 2) uniform sampler2D uFxMap; // r = scorch, g = frost, b = wet, a = heat

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

float ridge(vec2 p) { return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }

void main() {
  vec2 xz = vWorldPos.xz;
  vec3 N = normalize(vNormal);
  vec3 V = normalize(frame.cameraPos.xyz - vWorldPos);

  // --- lush grass: layered noise for painterly variation
  float big = fbm(xz * 0.035);
  float mid = fbm(xz * 0.18 + 5.0);
  float fine = vnoise(xz * 2.5);
  float blades = vnoise(xz * vec2(14.0, 9.0) + vnoise(xz * 3.0) * 2.0);
  vec3 grassA = srgb(vec3(0.26, 0.35, 0.17));
  vec3 grassB = srgb(vec3(0.34, 0.405, 0.21));
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
  // edge noise on a rotated domain, two octaves: breaks up the value-noise lattice so the
  // boundaries don't read as square blocks up close
  vec2 re = mat2(0.8, -0.6, 0.6, 0.8) * xz;
  float edgeN = vnoise(re * 1.1 + 3.0) * 0.6 + vnoise(re * 3.7 - 5.0) * 0.4;
  float dirtW = smoothstep(0.38, 0.62, vSplat.g + (edgeN - 0.5) * 0.4);
  float sandW = smoothstep(0.35, 0.65, vExtra.b + (edgeN - 0.5) * 0.3);
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

  // ---- ground effects left by magic (ground-FX map, see render/groundFx.ts)
  vec4 gfx = texture(uFxMap, terrainUV(xz));
  float t = frame.cameraPos.w;
  // scorch: singed grass ring → charcoal with ash flecks
  float charW = clamp(gfx.r * (0.8 + 0.4 * edgeN), 0.0, 1.0);
  albedo = mix(albedo, srgb(vec3(0.33, 0.24, 0.1)), smoothstep(0.04, 0.3, gfx.r) * (1.0 - smoothstep(0.3, 0.65, charW)) * 0.8);
  albedo = mix(albedo, srgb(vec3(0.05, 0.045, 0.04)), smoothstep(0.25, 0.8, charW));
  albedo = mix(albedo, srgb(vec3(0.42, 0.4, 0.38)), step(0.94, hash12(floor(xz * 11.0))) * smoothstep(0.5, 0.9, charW));
  rough = mix(rough, 0.98, charW);
  // wet: darker and glossy; puddles in the wettest spots mirror the sky
  float wet = gfx.b;
  // (scattered, noise-shaped patches: a threshold on the wet amount alone traced the stamp's
  // straight edges along a wave's path)
  float puddle = smoothstep(0.95, 1.12, wet * 0.9 + (fbm(xz * 0.55 + 9.0) - 0.5) * 1.1);
  // (darker and glossier, not black: the sheen sells "wet", not the darkness)
  albedo *= mix(1.0, 0.7, smoothstep(0.0, 0.5, wet));
  albedo = mix(albedo, albedo * 0.8 + srgb(vec3(0.04, 0.08, 0.1)), puddle);
  rough = mix(rough, 0.16, smoothstep(0.0, 0.6, wet));
  rough = mix(rough, 0.03, puddle);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), puddle));
  // frost: dendritic crystals creep in along ridged noise, full sheet where thick
  float crystal = ridge(re * 5.0) * 0.65 + ridge(re * 13.0 + 4.0) * 0.35;
  float thr = 1.0 - gfx.g * 1.7;
  float frostW = smoothstep(thr, thr + 0.1, crystal * 0.75 + 0.25 * edgeN);
  // hoarfrost: blue-white with the ground's texture still showing through (not a flat white decal)
  vec3 frostCol = srgb(vec3(0.52, 0.66, 0.82)) * (0.8 + 0.32 * crystal);
  albedo = mix(albedo, frostCol, frostW * (0.75 + 0.25 * smoothstep(0.4, 0.9, gfx.g)));
  rough = mix(rough, 0.3, frostW);

  float shadow = sampleShadow(uShadow, vWorldPos, N);
  vec3 col = shadeSurface(albedo, rough, 0.0, N, V, ao, shadow);
  col += albedo * pointLights(vWorldPos, N) * ao;
  // hoarfrost glints
  float glint = step(0.985, hash12(floor(xz * 26.0) + floor(t * 2.5 + hash12(floor(xz * 26.0)) * 7.0)));
  col += vec3(1.6, 1.9, 2.3) * glint * frostW * (0.4 + 0.6 * shadow);
  // embers glowing in the cracks of scorched ground
  float cracks = pow(ridge(re * 2.2 + 7.0), 7.0) + pow(ridge(re * 5.5 + 3.0), 9.0) * 0.6;
  float heat = gfx.a;
  float flick = 0.75 + 0.25 * sin(t * 7.0 + xz.x * 2.3 + xz.y * 1.7);
  // (sparse: charred ground stays dark between the glowing cracks)
  col += vec3(2.4, 0.6, 0.1) * heat * heat * (cracks * 1.6 + 0.04) * flick;

  // jade glow veins
  if (jadeW > 0.01) {
    float vein = smoothstep(0.47, 0.5, fbm(xz * 1.8)) * smoothstep(0.53, 0.5, fbm(xz * 1.8));
    col += srgb(vec3(0.3, 1.0, 0.65)) * vein * jadeW * (0.6 + 0.4 * sin(frame.cameraPos.w * 1.5 + xz.x));
  }

  // out-of-bounds skirt (hills beyond the playable map): dimmed + desaturated
  float oob = vExtra.a;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.5, 0.2))), oob * 0.3) * (1.0 - 0.5 * oob);

  // build grid overlay
  if (frame.grid.y > 0.0 && oob < 0.01) {
    vec2 g = abs(fract(xz / frame.grid.x + 0.5) - 0.5) * frame.grid.x;
    float line = 1.0 - smoothstep(0.0, 0.06, min(g.x, g.y));
    col = mix(col, vec3(0.9, 0.95, 1.0), line * frame.grid.y);
  }

  col = applyFog(col, vWorldPos);
  outColor = vec4(col, 1.0);
}
