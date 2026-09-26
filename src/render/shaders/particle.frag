#version 450
#include "common.glsl"
layout(location = 0) in vec2 vUV;
layout(location = 1) in vec4 vColor;
layout(location = 2) in float vIntensity;
layout(location = 3) in vec3 vWorld;
layout(location = 4) in vec2 vLocal;
layout(location = 5) flat in vec4 vParams;
layout(set = 1, binding = 0) uniform sampler2D uAtlas;
layout(set = 1, binding = 1) uniform sampler2D uHeight;
layout(location = 0) out vec4 outColor;

const float CELL = 0.125; // atlas is 8 × 8

// fire colour ramp: deep red → orange → yellow → white-hot
vec3 fireRamp(float h) {
  vec3 c = mix(vec3(0.45, 0.04, 0.01), vec3(1.0, 0.3, 0.04), smoothstep(0.08, 0.4, h));
  c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.68, h));
  return mix(c, vec3(1.0, 0.96, 0.82), smoothstep(0.7, 0.95, h));
}

void main() {
  int mode = int(vParams.x + 0.5);
  float age = vParams.z;
  float seed = vParams.w;
  float t = frame.cameraPos.w;
  vec3 rgb;
  float a;
  vec2 dir = vec2(0.0); // distortion direction

  if (mode >= 8) {
    // ---- procedural trails: vUV.x across (0..1), vUV.y along (m); age = along fraction
    float x = vUV.x * 2.0 - 1.0;
    float s = vUV.y;
    if (mode == 8) {           // beam (lightning)
      a = min(1.0, exp(-x * x * 10.0) + exp(-x * x * 90.0) * 0.8);
      rgb = vec3(1.0);
    } else if (mode == 9) {    // water tendril: glossy tube, flowing streaks, foam at the rims
      float body = smoothstep(1.0, 0.72, abs(x));
      float flow = vnoise(vec2(x * 2.5 + seed * 20.0, s * 1.7));
      float streak = smoothstep(0.55, 0.85, vnoise(vec2(x * 5.0, s * 0.9 + seed * 9.0)));
      float foam = smoothstep(0.55, 0.95, abs(x)) * smoothstep(0.35, 0.75, vnoise(vec2(s * 4.0, x * 3.0 + seed * 7.0)));
      float hl = exp(-pow(x + 0.35, 2.0) * 40.0) * (0.6 + 0.4 * flow);
      vec3 lit = vec3(frame.skyColor.w + frame.sunDir.w * 0.45);
      rgb = mix(vColor.rgb * (0.75 + 0.35 * flow), vec3(0.95, 0.98, 1.0), clamp(foam + streak * 0.35, 0.0, 1.0)) * lit + vec3(1.2) * hl * frame.sunDir.w * 0.5;
      a = body * (0.78 + 0.22 * foam);
      dir = vec2(x, 0.0);
    } else if (mode == 10) {   // flame tail: flickering tongue that thins toward the tail
      float n = vnoise(vec2(x * 2.0 + seed * 11.0, s * 1.3 - t * 7.0)) * 0.65 + vnoise(vec2(x * 5.0, s * 3.1 - t * 11.0)) * 0.35;
      float prof = smoothstep(1.0, 0.1, abs(x) + (n - 0.5) * 0.7);
      float heat = prof * (1.0 - age * 0.9) * (0.6 + 0.45 * n);
      rgb = fireRamp(heat) * vColor.rgb;
      a = smoothstep(0.05, 0.35, heat);
      dir = vec2(n - 0.5, 0.6);
    } else if (mode == 11) {   // wind: broken pale dashes
      float dash = smoothstep(0.45, 0.8, vnoise(vec2(s * 0.9 + seed * 13.0, x * 1.7)));
      a = dash * exp(-x * x * 5.0);
      rgb = vColor.rgb;
      dir = vec2(x * 1.5, 0.0);
    } else if (mode == 13) {   // wash: thin sheet of water racing over the ground — ragged edges, foam lace
      float n = vnoise(vec2(x * 2.2 + seed * 9.0, s * 0.45));
      // ragged edge that always reaches zero before the ribbon's geometric border
      float edge = smoothstep(0.9, 0.25, abs(x) + (n - 0.5) * 1.2) * smoothstep(1.0, 0.8, abs(x));
      float lace = smoothstep(0.62, 0.82, vnoise(vec2(x * 5.0 + seed * 3.0, s * 1.6)));
      lace = clamp(lace * (smoothstep(0.2, 0.9, abs(x) + 0.35 * n) + 0.35), 0.0, 1.0); // foam gathers at the edges
      // no hard ends: fades in behind the wave front and out toward the caster
      float ends = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(0.3, 1.0, age));
      float hl = smoothstep(0.62, 0.9, vnoise(vec2(x * 3.0 - seed, s * 0.8 + 4.0))) * (1.0 - lace);
      vec3 lit = vec3(frame.skyColor.w + frame.sunDir.w * 0.45);
      rgb = mix(vColor.rgb, vec3(0.9, 0.96, 1.0), lace) * lit + vec3(0.5, 0.6, 0.65) * hl * frame.sunDir.w;
      a = edge * ends * (0.22 + 0.55 * lace + 0.2 * hl);
      dir = vec2(x, 0.0);
    } else {                   // 12 frost mist
      float n = vnoise(vec2(x * 2.0 + seed * 5.0, s * 1.4 - t * 0.7)) * 0.7 + vnoise(vec2(x * 6.0, s * 4.0)) * 0.3;
      a = smoothstep(1.0, 0.2, abs(x)) * (0.35 + 0.65 * n);
      rgb = vColor.rgb * (frame.skyColor.w * 1.2 + frame.sunDir.w * 0.4);
    }
  } else {
    // ---- atlas sprites
    vec2 uv = vUV;
    if (mode == 1) {
      // living flame: warp the tongue upward with scrolling noise, then colour by density
      vec2 cmin = vec2(vUV.x - vLocal.x * CELL, vUV.y + vLocal.y * CELL - CELL);
      float sc = t * 3.4 + seed * 17.0;
      vec2 w = vec2(vnoise(vec2(vLocal.x * 3.0 + seed * 7.0, vLocal.y * 2.6 - sc)) - 0.5, vnoise(vec2(vLocal.x * 3.0 + 5.0, vLocal.y * 2.2 - sc * 1.3)) - 0.5);
      uv += w * vec2(0.3, 0.2) * CELL * (0.35 + vLocal.y);
      uv = clamp(uv, cmin + 0.002, cmin + CELL - 0.002);
    }
    vec4 tex = texture(uAtlas, uv);
    a = tex.a;
    rgb = tex.rgb;
    if (mode == 1) {
      // white-hot only in the dense base of young flames; most of the tongue is orange → red
      float heat = a * (0.98 - vLocal.y * 0.75) * (1.0 - age * 0.6);
      rgb = fireRamp(heat);
      a = smoothstep(0.03, 0.3, a);
    } else if (mode == 2) {
      float er = vnoise(vLocal * 3.0 + seed * 31.0) * 0.7 + vnoise(vLocal * 8.0 + seed * 7.0) * 0.3;
      a *= smoothstep(age * 1.05 - 0.05, age * 1.05 + 0.2, er);
    }
    dir = vLocal * 2.0 - 1.0;
  }
  float inten = vIntensity;
  if (mode == 3) inten *= 0.25 + 2.2 * pow(vnoise(vec2(t * 10.0 + seed * 60.0, seed * 17.0)), 3.0);
  if (mode == 4) inten *= step(0.4, hash12(vec2(floor(t * 28.0), seed * 97.0)));
  a *= vColor.a;
  // soft intersection with the terrain (no hard cut where a sprite dips into the ground)
  if (vParams.y > 0.5) {
    float h = texture(uHeight, terrainUV(vWorld.xz)).r;
    a *= clamp((vWorld.y - h) / 0.45, 0.0, 1.0);
  }

#ifdef DISTORT
  // screen-space UV offset: kind 0 = radial push (shock rings, blades), 1 = heat shimmer
  vec2 o;
  if (mode == 1) o = (vec2(vnoise(vWorld.xz * 1.7 + vec2(0.0, t * 3.0)), vnoise(vWorld.xz * 1.7 + vec2(5.0, t * 2.3))) - 0.5) * 2.0;
  else o = dir;
  outColor = vec4(o * a * inten * 0.012, 0.0, 0.0);
#else
  vec3 c = rgb * vColor.rgb * inten;
  if (mode >= 8 && mode != 8) c = rgb * inten;
#ifdef ADDITIVE
  outColor = vec4(c * a, 0.0);
#else
  // alpha particles (smoke, dust, water) are lit by sky, sun and nearby fires, and fogged
  if (mode < 8) c *= mix(vec3(1.0), frame.skyColor.rgb * frame.skyColor.w * 1.6 + frame.sunColor.rgb * frame.sunDir.w * 0.25, 0.65);
  c += vColor.rgb * pointLights(vWorld, vec3(0.0, 1.0, 0.0)) * 0.35;
  c = applyFog(c, vWorld);
  outColor = vec4(c * a, a);
#endif
#endif
}
