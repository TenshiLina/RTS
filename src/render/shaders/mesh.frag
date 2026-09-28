#version 450
#include "common.glsl"

layout(location = 0) in vec3 vWorldPos;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec2 vUV;
layout(location = 3) in vec4 vColor;
layout(location = 4) in vec4 vMat;
layout(location = 5) in vec4 vExtra;
layout(location = 6) in vec3 vObjPos;
layout(location = 7) flat in vec4 vInst;
layout(location = 8) flat in vec4 vStatus;

layout(set = 1, binding = 1) uniform sampler2DShadow uShadow;
layout(set = 1, binding = 2) uniform sampler2D uFxMap;
// baked character atlas (painted materials, pattern >= 18):
//   uAlbedo  rgb = colour (sRGB texture), a = team mask
//   uSurface r = roughness, g = normal.y, b = metalness, a = normal.x (tangent space)
layout(set = 1, binding = 3) uniform sampler2D uAlbedo;
layout(set = 1, binding = 4) uniform sampler2D uSurface;

layout(location = 0) out vec4 outColor;

// ------------------------------------------------------------------ procedural surface patterns
// Each pattern supplies a height (for bump normals) and an albedo/roughness modulation.
// Pattern IDs match core/materialModel.ts.

float roofTileH(vec2 uv) {
  // alternating convex cover tiles (筒瓦) and concave pan tiles (板瓦), overlapping courses
  float w = 0.3;
  float c = fract(uv.x / w);
  float cover = sqrt(max(0.0, 1.0 - pow((c - 0.5) / 0.22, 2.0)));
  float pan = 0.25 * (1.0 - cos(c * 2.0 * PI)) * 0.5;
  float course = fract(uv.y / 0.34);
  float lap = course * 0.18 + smoothstep(0.0, 0.05, course) * 0.08;
  return max(cover * 0.9, pan) + lap;
}
float brickH(vec2 uv) {
  float row = floor(uv.y / 0.12);
  float x = uv.x / 0.3 + mod(row, 2.0) * 0.5;
  vec2 f = vec2(fract(x) * 0.3, fract(uv.y / 0.12) * 0.12);
  float m = min(min(f.x, 0.3 - f.x), min(f.y, 0.12 - f.y));
  return smoothstep(0.0, 0.014, m);
}
float stoneH(vec2 uv) {
  float row = floor(uv.y / 0.42);
  float x = uv.x / 0.75 + hash12(vec2(row, 3.0)) * 0.7;
  vec2 f = vec2(fract(x) * 0.75, fract(uv.y / 0.42) * 0.42);
  float m = min(min(f.x, 0.75 - f.x), min(f.y, 0.42 - f.y));
  return smoothstep(0.0, 0.03, m) * (0.9 + 0.1 * vnoise(uv * 9.0));
}
float lamellarH(vec2 uv) {
  float row = floor(uv.y / 0.05);
  float x = uv.x / 0.04 + mod(row, 2.0) * 0.5;
  vec2 f = vec2(fract(x), fract(uv.y / 0.05));
  float plate = (1.0 - pow(abs(f.x - 0.5) * 2.0, 3.0)) * smoothstep(0.0, 0.25, f.y);
  return plate;
}
float bambooH(vec2 uv) {
  float n = fract(uv.y / 0.42);
  return smoothstep(0.04, 0.0, abs(n - 0.02)) * 0.8;
}

float patternHeight(int p, vec2 uv) {
  if (p == 5) return roofTileH(uv) * 0.06;
  if (p == 1) return fbm(vec2(uv.x * 22.0, uv.y * 1.5)) * 0.006;
  if (p == 2) return brickH(uv) * 0.012;
  if (p == 3) return stoneH(uv) * 0.02;
  if (p == 4) return fbm(uv * 3.0) * 0.004;
  if (p == 11) return abs(fbm(vec2(uv.x * 7.0, uv.y * 1.3)) - 0.5) * 0.05;
  if (p == 12) return vnoise(vec2(uv.x * 70.0, uv.y * 3.0)) * 0.006;
  if (p == 15) return lamellarH(uv) * 0.006;
  if (p == 16) return fbm(uv * 2.5) * 0.08;
  if (p == 8) return vnoise(uv * 7.0) * 0.04;
  if (p == 17) return bambooH(uv) * 0.01;
  if (p == 6) return vnoise(uv * 60.0) * 0.0015;
  return 0.0;
}

// returns albedo multiplier (rgb) and roughness multiplier (a)
vec4 patternColor(int p, vec2 uv, vec3 obj, vec3 N) {
  if (p == 5) {
    float w = 0.3;
    float c = fract(uv.x / w);
    float cover = step(abs(c - 0.5), 0.22);
    float course = fract(uv.y / 0.34);
    float edge = smoothstep(0.0, 0.06, course);
    vec2 tileId = floor(vec2(uv.x / w, uv.y / 0.34));
    float v = 0.8 + 0.28 * cover - (1.0 - edge) * 0.28 + (hash12(tileId) - 0.5) * 0.16;
    // weathering: soot/lichen streaks running down the slope, mostly in the pan channels
    float streak = fbm(vec2(uv.x * 1.3, uv.y * 0.25) + obj.xz * 0.05);
    float grime = smoothstep(0.45, 0.8, streak) * (1.0 - cover * 0.6) * 0.35;
    vec3 tint = vec3(v) * mix(vec3(1.0), vec3(0.78, 0.8, 0.7), grime);
    return vec4(tint, 1.0 - cover * 0.2);
  }
  if (p == 1) {
    float g = fbm(vec2(uv.x * 18.0, uv.y * 1.2));
    float rings = sin((uv.x * 40.0 + g * 6.0)) * 0.5 + 0.5;
    return vec4(vec3(0.82 + 0.22 * g + rings * 0.06), 1.0);
  }
  if (p == 2) {
    float row = floor(uv.y / 0.12);
    float bx = floor(uv.x / 0.3 + mod(row, 2.0) * 0.5);
    float h = brickH(uv);
    float var = 0.85 + 0.3 * hash12(vec2(bx, row));
    return vec4(mix(vec3(1.25), vec3(var), h), 1.0);
  }
  if (p == 3) {
    float row = floor(uv.y / 0.42);
    float bx = floor(uv.x / 0.75 + hash12(vec2(row, 3.0)) * 0.7);
    float var = 0.86 + 0.26 * hash12(vec2(bx, row) + 7.0);
    float h = stoneH(uv);
    return vec4(vec3(mix(0.7, var, h) * (0.92 + 0.16 * fbm(uv * 4.0))), 1.0);
  }
  if (p == 4) {
    float m = 0.9 + 0.14 * fbm(uv * 1.3 + obj.xz * 0.2);
    float dirt = smoothstep(0.9, 0.0, obj.y) * 0.25;
    return vec4(vec3(m) * mix(vec3(1.0), vec3(0.72, 0.62, 0.5), dirt), 1.0);
  }
  if (p == 6) {
    return vec4(vec3(0.9 + 0.12 * fbm(uv * 5.0) + (vnoise(uv * 80.0) - 0.5) * 0.06), 1.0);
  }
  if (p == 7) {
    float b = vnoise(vec2(uv.x * 3.0, uv.y * 90.0));
    return vec4(vec3(0.9 + 0.15 * b), 0.8 + 0.5 * fbm(uv * 6.0));
  }
  if (p == 8) {
    float big = fbm(obj.xz * 0.9 + obj.y * 0.7);
    float clump = vnoise(uv * 7.0);
    float top = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 m = vec3(0.7 + 0.45 * big) * (0.8 + 0.35 * clump);
    m *= mix(vec3(0.85, 0.95, 0.9), vec3(1.12, 1.08, 0.86), top);
    return vec4(m, 1.0);
  }
  if (p == 9) {
    float s = vnoise3(obj * 6.0 + frame.cameraPos.w * 0.3);
    return vec4(vec3(0.75 + 0.5 * s), 1.0);
  }
  if (p == 10) {
    return vec4(vec3(0.95 + 0.08 * fbm(uv * 2.0)), 0.9 + 0.3 * vnoise(uv * 12.0));
  }
  if (p == 11) {
    float r = abs(fbm(vec2(uv.x * 7.0, uv.y * 1.3)) - 0.5) * 2.0;
    return vec4(vec3(0.6 + 0.6 * r), 1.0);
  }
  if (p == 12) {
    float f = vnoise(vec2(uv.x * 70.0, uv.y * 3.0));
    return vec4(vec3(0.8 + 0.3 * f), 1.0);
  }
  if (p == 13) {
    return vec4(vec3(0.92 + 0.1 * vnoise(uv * 40.0)), 1.0);
  }
  if (p == 15) {
    float h = lamellarH(uv);
    float lace = step(0.92, fract(uv.y / 0.05 * 1.0));
    return vec4(vec3(0.55 + 0.55 * h) * (1.0 - lace * 0.4), 1.0 - h * 0.3);
  }
  if (p == 16) {
    float n = fbm(uv * 1.7 + obj.xz * 0.3);
    float moss = smoothstep(0.55, 0.9, N.y) * smoothstep(0.45, 0.7, fbm(obj.xz * 1.3));
    vec3 c = vec3(0.75 + 0.45 * n);
    return vec4(mix(c, c * vec3(0.72, 0.95, 0.55), moss), 1.0);
  }
  if (p == 17) {
    float n = fract(uv.y / 0.42);
    float node = smoothstep(0.035, 0.0, abs(n - 0.02));
    return vec4(vec3(0.9 + 0.2 * vnoise(vec2(uv.x * 3.0, uv.y * 0.8))) * (1.0 - node * 0.35) + vec3(0.1, 0.08, -0.05) * n, 1.0);
  }
  return vec4(1.0);
}

void main() {
  // C&C-style construction: geometry rises from the ground, with a glowing build line
  if (vObjPos.y > vInst.w) discard;

  int pat = int(vMat.z * 255.0 + 0.5);
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(frame.cameraPos.xyz - vWorldPos);

  bool painted = pat >= 18;
  vec4 atlasA = vec4(1.0), atlasS = vec4(0.8, 0.5, 0.0, 0.5);
  if (painted) {
    atlasA = texture(uAlbedo, vUV);
    atlasS = texture(uSurface, vUV);
    vec2 nxy = vec2(atlasS.a, atlasS.g) * 2.0 - 1.0;
    vec3 tn = vec3(nxy, sqrt(max(1.0 - dot(nxy, nxy), 0.0)));
    mat3 tbn = cotangentFrame(N, vWorldPos, vUV);
    vec3 pn = tbn * tn;
    if (dot(pn, pn) > 0.0) N = normalize(pn);
  }
  // bump from pattern height
  if (!painted && pat != 0 && pat != 9 && pat != 14) {
    float e = 0.01;
    float h0 = patternHeight(pat, vUV);
    float hu = patternHeight(pat, vUV + vec2(e, 0.0));
    float hv = patternHeight(pat, vUV + vec2(0.0, e));
    vec3 tn = normalize(vec3(-(hu - h0) / e, -(hv - h0) / e, 1.0));
    mat3 tbn = cotangentFrame(N, vWorldPos, vUV);
    vec3 pn = tbn * tn;
    if (dot(pn, pn) > 0.0) N = normalize(pn);
  }

  vec3 base = painted ? atlasA.rgb * vColor.rgb : vColor.rgb;
  float teamMask = painted ? atlasA.a : vColor.a;
  int team = int(vInst.x + 0.5);
  vec3 tc = frame.teamColors[team].rgb;
  base = mix(base, tc * (0.6 + 0.4 * dot(base, vec3(0.3, 0.5, 0.2)) / 0.35), teamMask);
  vec4 pc = painted ? vec4(1.0) : patternColor(pat, vUV, vObjPos, N);
  vec3 albedo = base * pc.rgb;
  float rough = painted ? clamp(atlasS.r, 0.04, 1.0) : clamp(vMat.x * pc.a, 0.04, 1.0);
  float metal = painted ? atlasS.b : vMat.y;
  float ao = vExtra.x;

  // ---- elemental status (per instance) + ground effects creeping up from below
  vec4 gfx = texture(uFxMap, terrainUV(vWorldPos.xz));
  float low = smoothstep(1.1, 0.0, vObjPos.y);
  float frost = max(vStatus.x, gfx.g * low * 0.9);
  float wet = max(vStatus.y, gfx.b * smoothstep(0.5, 0.0, vObjPos.y) * 0.8);
  float charW = max(vStatus.w, gfx.r * smoothstep(0.6, 0.0, vObjPos.y) * 0.7);
  float frostPat = smoothstep(0.35, 0.65, vnoise(vObjPos.xz * 9.0 + vObjPos.y * 6.0) * 0.6 + frost * 0.7);
  albedo = mix(albedo, vec3(0.62, 0.78, 0.92), frost * frostPat);
  rough = mix(rough, 0.22, frost * frostPat);
  metal *= 1.0 - frost;
  albedo *= mix(1.0, 0.58, wet);
  rough = mix(rough, 0.14, wet);
  albedo = mix(albedo, vec3(0.035, 0.03, 0.028), charW * 0.85);

  float shadow = sampleShadow(uShadow, vWorldPos, N);
  vec3 col = shadeSurface(albedo, rough, metal, N, V, ao, shadow);
  if (pat == 19) {
    // skin: light scattered under the surface warms and softens the terminator
    float ndl = dot(N, frame.sunDir.xyz);
    float sss = smoothstep(-0.35, 0.25, ndl) * (1.0 - smoothstep(0.25, 0.8, ndl));
    col += albedo * vec3(0.95, 0.32, 0.2) * frame.sunColor.rgb * frame.sunDir.w * sss * 0.22 * mix(0.55, 1.0, shadow);
    float back = pow(clamp(1.0 - max(dot(N, V), 0.0), 0.0, 1.0), 3.0);
    col += albedo * vec3(1.0, 0.45, 0.35) * back * 0.08 * frame.skyColor.w;
  } else if (pat == 21) {
    // eyes: a sharp wet highlight
    vec3 H = normalize(frame.sunDir.xyz + V);
    col += frame.sunColor.rgb * pow(max(dot(N, H), 0.0), 400.0) * 1.5 * shadow;
  }
  col += albedo * pointLights(vWorldPos, N) * ao;
  if (frost > 0.01) {
    float rimF = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    col += vec3(0.35, 0.65, 1.0) * rimF * frost * 0.9;
    float glint = step(0.992, hash13(floor(vWorldPos * 22.0) + floor(frame.cameraPos.w * 3.0)));
    col += vec3(2.0, 2.3, 2.6) * glint * frost * frostPat;
  }
  if (vStatus.z > 0.01) {
    // burning: embers crawl over the surface, lit from the flames below
    float n = vnoise(vObjPos.xz * 7.0 + vec2(0.0, vObjPos.y * 9.0 - frame.cameraPos.w * 3.0));
    float ember = smoothstep(0.55, 0.9, n) * vStatus.z;
    col += vec3(2.6, 0.75, 0.12) * ember * (0.7 + 0.3 * sin(frame.cameraPos.w * 13.0 + vObjPos.y * 5.0));
    col += vec3(1.0, 0.42, 0.1) * vStatus.z * 0.35 * smoothstep(1.6, 0.0, vObjPos.y);
  }

  // foliage translucency: light bleeding through leaves when backlit
  if (pat == 8) {
    float back = pow(max(dot(-V, frame.sunDir.xyz), 0.0), 3.0);
    col += albedo * frame.sunColor.rgb * back * 0.35 * shadow;
  }

  float emissive = vMat.w * 8.0;
  if (emissive > 0.0) {
    float flick = pat == 13 ? 0.9 + 0.1 * sin(frame.cameraPos.w * 7.0 + vWorldPos.x * 3.0) : 1.0;
    col += base * pc.rgb * emissive * flick;
  }

  // placement ghost: 2 = valid (jade green), 3 = blocked (red)
  if (vInst.z >= 1.5) {
    vec3 g = vInst.z < 2.5 ? vec3(0.35, 1.0, 0.55) : vec3(1.0, 0.28, 0.2);
    float lum = dot(col, vec3(0.3, 0.5, 0.2));
    col = mix(col, g * (0.25 + lum * 1.2), 0.6) + g * (0.08 + 0.06 * sin(frame.cameraPos.w * 6.0));
  } else if (vInst.z > 0.0 && vInst.z < 1.5) {
    float rim = pow(1.0 - max(dot(N, V), 0.0), 2.0);
    col += tc * rim * vInst.z * 1.5 + vec3(0.04) * vInst.z;
  }
  // construction edge glow (jade→gold); highlight < 0 marks a collapsing building (embers)
  float edge = vInst.w - vObjPos.y;
  if (edge < 0.25) {
    vec3 glow = vInst.z < -0.5 ? mix(vec3(2.2, 0.55, 0.1), vec3(0.6, 0.12, 0.03), edge * 4.0) : mix(vec3(0.5, 1.4, 1.2), vec3(1.6, 1.2, 0.5), edge * 4.0);
    col += glow * (1.0 - edge * 4.0) * 2.5;
  }
  if (vInst.z < -0.5) col *= 0.75; // scorched while collapsing

  col = applyFog(col, vWorldPos);
  outColor = vec4(col, 1.0);
}
