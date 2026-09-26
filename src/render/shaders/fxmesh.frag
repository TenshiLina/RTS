#version 450
#include "common.glsl"
layout(location = 0) in vec3 vWorld;
layout(location = 1) in vec3 vNormal;
layout(location = 2) in vec2 vUV;
layout(location = 3) in vec3 vObj;
layout(location = 4) flat in vec4 vColor;
layout(location = 5) flat in vec4 vParams;
layout(set = 1, binding = 0) uniform sampler2D uFxMap;
layout(location = 0) out vec4 outColor;

vec3 fireRamp(float h) {
  vec3 c = mix(vec3(0.45, 0.04, 0.01), vec3(1.0, 0.3, 0.04), smoothstep(0.08, 0.4, h));
  c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.4, 0.68, h));
  return mix(c, vec3(1.0, 0.96, 0.82), smoothstep(0.7, 0.95, h));
}

void main() {
  int mat = int(vParams.x + 0.5);
  float t = frame.cameraPos.w;
  float seed = vParams.w;
  float fade = vParams.z;
  vec3 V = normalize(frame.cameraPos.xyz - vWorld);
  vec3 L = frame.sunDir.xyz;
  vec3 sun = frame.sunColor.rgb * frame.sunDir.w;
  vec3 amb = frame.skyColor.rgb * frame.skyColor.w;
  vec3 col;
  float a;

  if (mat == 0) {
    // ICE: faceted, reflective, deep blue body, white rims, internal fractures, glints
    vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    if (dot(N, V) < 0.0) N = -N;
    float ndv = max(dot(N, V), 0.0);
    float fres = pow(1.0 - ndv, 3.0);
    // saturated blue body that stays blue under the sun; the brightness lives only in rims,
    // fractures and glints, so the crystal silhouette reads against grass and frost alike
    vec3 deep = vec3(0.02, 0.08, 0.24), body = vec3(0.12, 0.42, 0.78) * vColor.rgb, rim = vec3(0.8, 0.93, 1.0);
    float facet = hash13(floor(N * 7.0 + seed * 3.0)); // each facet a slightly different tone
    col = mix(deep, body, clamp(ndv * 0.75 + 0.3 * facet, 0.0, 1.0));
    col *= amb * 1.05 + sun * (0.1 + 0.28 * max(dot(N, L), 0.0));
    float cr = smoothstep(0.965, 0.995, 1.0 - abs(vnoise(vObj.xy * 5.0 + seed * 7.0) * 2.0 - 1.0));
    col += rim * cr * 0.5 * (amb + sun * 0.2);
    vec3 R = reflect(-V, N);
    col = mix(col, mix(frame.fogColor.rgb, frame.skyColor.rgb * 1.4, clamp(R.y, 0.0, 1.0)), pow(1.0 - ndv, 4.0) * 0.7);
    col += sun * pow(max(dot(R, L), 0.0), 90.0) * 2.0;
    col += pointLights(vWorld, N) * body * 0.6;
    float glint = step(0.985, hash13(floor(vWorld * 18.0) + floor(t * 4.0 + seed * 10.0)));
    col += vec3(2.0, 2.3, 2.8) * glint;
    col += vec3(0.25, 0.55, 1.0) * vColor.a * 0.35; // cold inner light while forming
    a = (0.86 + 0.14 * fres) * fade;
  } else if (mat == 1) {
    // WATER: glossy aquamarine sheet, foam on the crest, sky reflection
    float e = 0.02;
    vec2 q = vUV * vec2(10.0, 7.0) + vec2(0.0, -t * 1.6 + seed * 13.0);
    float h0 = vnoise(q), hu = vnoise(q + vec2(e * 10.0, 0.0)), hv = vnoise(q + vec2(0.0, e * 7.0));
    vec3 N = normalize(vNormal + vec3(hu - h0, 0.0, hv - h0) * 1.6);
    if (dot(N, V) < 0.0) N = -N;
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    vec3 sky = mix(frame.fogColor.rgb, frame.skyColor.rgb * 1.35, clamp(R.y, 0.0, 1.0));
    vec3 body = vColor.rgb * (amb * 1.2 + sun * 0.35 * max(dot(N, L), 0.2));
    col = mix(body, sky, fres * 0.85) + sun * pow(max(dot(R, L), 0.0), 150.0) * 5.0;
    // a thick white crest and torn foam streaks running down the face: the wave's silhouette
    float crest = smoothstep(0.5, 0.8, vUV.y);
    float streaks = smoothstep(0.5, 0.75, vnoise(vec2(vUV.x * 16.0, vUV.y * 4.0 - t * 2.2 + seed)));
    float foam = clamp(crest * (0.7 + 0.3 * vnoise(vUV * vec2(30.0, 10.0) - vec2(0.0, t * 3.0))) + streaks * 0.55 * smoothstep(0.25, 0.6, vUV.y), 0.0, 1.0);
    col = mix(col, vec3(0.94, 0.97, 1.0) * (amb * 1.3 + sun * 0.55), foam);
    col += pointLights(vWorld, N) * 0.3;
    a = clamp(0.68 + fres * 0.3 + foam * 0.3, 0.0, 1.0) * fade;
    // soften the base where the sheet meets the ground
    a *= smoothstep(0.0, 0.08, vUV.y);
  } else if (mat == 2) {
    // WIND: pale streaks spiralling up the funnel
    float s = smoothstep(0.52, 0.86, vnoise(vec2(vUV.x * 11.0 + vUV.y * 3.0 - t * 4.2, vUV.y * 3.5 - t * 1.8 + seed * 7.0)));
    s += smoothstep(0.7, 0.95, vnoise(vec2(vUV.x * 23.0 - t * 6.0, vUV.y * 8.0 + seed))) * 0.5;
    float edge = smoothstep(0.0, 0.12, vUV.y) * smoothstep(1.0, 0.7, vUV.y);
    col = vColor.rgb * (amb * 1.2 + sun * 0.3);
    a = s * edge * fade * 0.28;
  } else if (mat == 3) {
    // DUST: earthy veil, dense at the ground, torn by the spin
    float n = vnoise(vec2(vUV.x * 7.0 + vUV.y * 2.0 - t * 3.0, vUV.y * 4.0 - t * 1.2 + seed * 5.0)) * 0.7 + vnoise(vec2(vUV.x * 16.0 - t * 5.0, vUV.y * 9.0)) * 0.3;
    // spiral bands wrapping the funnel: the rotation reads even in a still frame
    float bands = smoothstep(0.25, 0.75, sin((vUV.x * 3.0 + vUV.y * 2.2) * 6.2832 - t * 7.0) * 0.5 + 0.5);
    n = n * (0.55 + 0.6 * bands);
    float dens = pow(1.0 - vUV.y, 1.1) * 0.8 + 0.3;
    // earthy and dark at the churning base, paler where it thins out at the top
    col = vColor.rgb * mix(0.55, 1.1, vUV.y) * (amb * 1.0 + sun * 0.32) + pointLights(vWorld, vec3(0.0, 1.0, 0.0)) * vColor.rgb * 0.5;
    a = clamp(n * 1.8 - 0.2, 0.0, 1.0) * dens * smoothstep(1.0, 0.75, vUV.y) * fade * vColor.a;
  } else if (mat == 4) {
    // FIRE shell: flames licking up a column / whirl
    float n = vnoise(vec2(vUV.x * 9.0 + seed * 7.0, vUV.y * 3.0 - t * 4.5)) * 0.65 + vnoise(vec2(vUV.x * 21.0, vUV.y * 7.0 - t * 8.0)) * 0.35;
    float heat = (1.05 - vUV.y) * (0.5 + 0.7 * n);
    col = fireRamp(heat) * vColor.rgb * 1.1;
    a = smoothstep(0.12, 0.45, heat) * fade;
  } else {
    // ENERGY: fresnel glow (wards, charged domes)
    vec3 N = normalize(vNormal);
    float f = pow(1.0 - abs(dot(N, V)), 2.0);
    float bands = 0.6 + 0.4 * sin(vUV.y * 30.0 - t * 5.0);
    col = vColor.rgb * (0.15 + f * 2.0) * bands;
    a = fade * (0.2 + f);
  }
  col = applyFog(col, vWorld);
#ifdef ADDITIVE
  outColor = vec4(col * a, 0.0);
#else
  outColor = vec4(col, a);
#endif
}
