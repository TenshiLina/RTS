#version 450
#include "common.glsl"
layout(location = 0) in vec2 vNdc;
layout(location = 0) out vec4 outColor;
void main() {
  vec4 a = frame.invViewProj * vec4(vNdc, 1.0, 1.0);
  vec4 b = frame.invViewProj * vec4(vNdc, -1.0, 1.0);
  vec3 dir = normalize(a.xyz / a.w - b.xyz / b.w);
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 zenith = frame.skyColor.rgb * 1.1;
  vec3 horizon = mix(frame.fogColor.rgb, vec3(1.0, 0.92, 0.8), 0.3) * 1.15;
  vec3 col = mix(horizon, zenith, pow(clamp(up, 0.0, 1.0), 0.55));
  col = mix(col, frame.groundColor.rgb * 0.8, smoothstep(0.0, -0.3, up));
  float sun = max(dot(dir, frame.sunDir.xyz), 0.0);
  col += frame.sunColor.rgb * (pow(sun, 600.0) * 20.0 + pow(sun, 12.0) * 0.25);
  // soft painterly cloud bands
  vec2 cp = dir.xz / max(dir.y + 0.15, 0.05);
  float cl = smoothstep(0.55, 0.8, fbm(cp * 0.7 + vec2(frame.cameraPos.w * 0.01, 0.0))) * smoothstep(0.0, 0.25, up);
  col = mix(col, vec3(1.0, 0.98, 0.95) * (frame.skyColor.w + frame.sunDir.w * 0.35), cl * 0.55);
  outColor = vec4(col, 1.0);
}
