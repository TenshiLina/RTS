#version 450
// Tonemap + grade. Look target: saturated, warm, crisp — "RA2 remastered".
layout(location = 0) in vec2 vUV;
layout(set = 0, binding = 0) uniform CompositeUniforms {
  vec4 grade;   // x = exposure, y = saturation, z = contrast, w = bloom strength
  vec4 tint;    // rgb lift/warmth multiplier, w = vignette
  vec4 misc;    // x = time, y = dither, z = flash, w = unused
} comp;
layout(set = 0, binding = 1) uniform sampler2D uHDR;
layout(set = 0, binding = 2) uniform sampler2D uBloom;
layout(set = 0, binding = 3) uniform sampler2D uDistort; // screen-space UV offsets (heat haze, air)
layout(location = 0) out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 off = texture(uDistort, vUV).xy;
  vec3 hdr = texture(uHDR, vUV + off).rgb;
  vec3 bloom = texture(uBloom, vUV).rgb;
  vec3 c = (hdr + bloom * comp.grade.w) * comp.grade.x * comp.tint.rgb;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, comp.grade.y);
  c = clamp((c - 0.5) * comp.grade.z + 0.5, 0.0, 1.0);
  vec2 q = vUV - 0.5;
  c *= 1.0 - dot(q, q) * comp.tint.w;
  c = mix(c, vec3(1.0, 0.98, 0.94), clamp(comp.misc.z, 0.0, 1.0));
  c = pow(c, vec3(1.0 / 2.2));
  // blue-noise-ish dither to kill banding in skies/fog
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  c += (n - 0.5) / 255.0 * comp.misc.y;
  outColor = vec4(c, 1.0);
}
