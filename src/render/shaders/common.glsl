// Shared declarations. GLSL 4.50, Vulkan dialect (see rhi/shaderTranslate.ts for the rules).

layout(set = 0, binding = 0) uniform FrameUniforms {
  mat4 viewProj;
  mat4 invViewProj;
  mat4 shadowMatrix;   // world -> shadow-map texture space [0,1]^3
  mat4 shadowViewProj; // world -> light clip space (for the depth pass)
  vec4 cameraPos;      // xyz, w = time (s)
  vec4 sunDir;         // xyz towards the sun, w = intensity
  vec4 sunColor;       // rgb, w = shadow strength
  vec4 skyColor;       // rgb (zenith ambient), w = ambient intensity
  vec4 groundColor;    // rgb (bounce ambient), w = rim strength
  vec4 fogColor;       // rgb, w = density
  vec4 fogParams;      // x = start distance, y = height falloff, z = horizon glow, w = unused
  vec4 wind;           // xy direction, z strength, w speed
  vec4 shadowParams;   // x = 1/mapSize, y = normal bias, z = depth bias, w = enabled
  vec4 viewport;       // xy = size in px, zw = 1/size
  vec4 grid;           // x = cell size, y = grid opacity, zw = unused
  vec4 teamColors[8];
} frame;

const float PI = 3.14159265;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 3.7);
    a *= 0.5;
  }
  return s / 0.9375;
}

vec3 windOffset(vec3 worldPos, float sway) {
  if (sway <= 0.0) return vec3(0.0);
  float t = frame.cameraPos.w * frame.wind.w;
  float phase = dot(worldPos.xz, vec2(0.21, 0.17));
  float gust = 0.6 + 0.4 * sin(t * 0.37 + worldPos.x * 0.05);
  float w = (sin(t + phase) * 0.7 + sin(t * 2.3 + phase * 1.7) * 0.3) * gust;
  return vec3(frame.wind.x, 0.0, frame.wind.y) * (w * frame.wind.z * sway);
}

// Stylised PBR-lite lighting shared by meshes and terrain.
vec3 shadeSurface(vec3 albedo, float rough, float metal, vec3 N, vec3 V, float ao, float shadow) {
  vec3 L = frame.sunDir.xyz;
  float NdL = dot(N, L);
  float wrap = 0.25;
  float diff = max((NdL + wrap) / (1.0 + wrap), 0.0);
  diff = mix(diff, smoothstep(0.0, 1.0, diff), 0.35); // slight painterly ramp
  vec3 H = normalize(L + V);
  float NdH = max(dot(N, H), 0.0);
  float NdV = max(dot(N, V), 0.001);
  float NdLc = max(NdL, 0.0);
  float a = max(rough * rough, 0.03);
  float a2 = a * a;
  float dd = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float VdH = max(dot(V, H), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float G = (NdLc / (NdLc * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  vec3 spec = D * F * G / max(4.0 * NdV * NdLc, 0.001) * NdLc;
  vec3 kd = (1.0 - F) * (1.0 - metal);
  vec3 sun = frame.sunColor.rgb * frame.sunDir.w * shadow;
  vec3 direct = (kd * albedo * diff + spec) * sun;
  float up = N.y * 0.5 + 0.5;
  vec3 amb = mix(frame.groundColor.rgb, frame.skyColor.rgb, up) * frame.skyColor.w;
  vec3 ambient = amb * albedo * (1.0 - metal * 0.7) * ao;
  vec3 R = reflect(-V, N);
  vec3 env = mix(frame.groundColor.rgb * 0.8, frame.skyColor.rgb * 1.6 + frame.sunColor.rgb * pow(max(dot(R, L), 0.0), 8.0) * 0.6, clamp(R.y * 0.6 + 0.5, 0.0, 1.0));
  vec3 envSpec = env * mix(F0, vec3(1.0), pow(1.0 - NdV, 5.0) * (1.0 - rough)) * ao * (1.0 - rough * 0.75) * frame.skyColor.w;
  float rim = pow(1.0 - NdV, 4.0) * frame.groundColor.w * (0.4 + 0.6 * max(dot(-V.xz, L.xz), 0.0));
  return direct + ambient + envSpec * mix(0.25, 1.0, metal) + rim * frame.sunColor.rgb * ao * 0.5;
}

#ifdef STAGE_FRAGMENT
float sampleShadow(sampler2DShadow sm, vec3 worldPos, vec3 N) {
  if (frame.shadowParams.w < 0.5) return 1.0;
  vec3 p = worldPos + N * frame.shadowParams.y;
  vec4 sc = frame.shadowMatrix * vec4(p, 1.0);
  vec3 uvz = sc.xyz / sc.w;
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 1.0;
  uvz.z -= frame.shadowParams.z;
  float t = frame.shadowParams.x;
  float s = 0.0;
  // 12-tap rotated-disk PCF for soft, "remastered" shadow edges
  float ang = hash12(gl_FragCoord.xy) * 6.2831;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  const vec2 taps[12] = vec2[](
    vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
    vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
    vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
  for (int i = 0; i < 12; i++) {
    s += texture(sm, vec3(uvz.xy + rot * taps[i] * t * 1.8, uvz.z));
  }
  s /= 12.0;
  return mix(1.0, s, frame.sunColor.w);
}

#endif

vec3 applyFog(vec3 col, vec3 worldPos) {
  float d = length(worldPos - frame.cameraPos.xyz);
  float f = 1.0 - exp(-max(d - frame.fogParams.x, 0.0) * frame.fogColor.w);
  f *= exp(-max(worldPos.y, 0.0) * frame.fogParams.y);
  return mix(col, frame.fogColor.rgb, clamp(f, 0.0, 1.0));
}

#ifdef STAGE_FRAGMENT
// Cotangent frame from screen-space derivatives (no stored tangents needed).
mat3 cotangentFrame(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p), dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N);
  vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float m = max(dot(T, T), dot(B, B));
  float invmax = m > 0.0 ? inversesqrt(m) : 0.0;
  return mat3(T * invmax, B * invmax, N);
}
#endif
