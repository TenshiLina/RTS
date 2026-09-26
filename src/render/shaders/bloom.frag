#version 450
// Dual-filter bloom (downsample with prefilter on the first level, tent upsample).
layout(location = 0) in vec2 vUV;
layout(set = 0, binding = 0) uniform PostUniforms {
  vec4 texel;   // xy = source texel size, z = mode (0 prefilter-down, 1 down, 2 up), w = threshold
  vec4 params;  // x = knee, y = upsample radius, z = intensity
} post;
layout(set = 0, binding = 1) uniform sampler2D uSrc;
layout(location = 0) out vec4 outColor;

vec3 prefilter(vec3 c) {
  float br = max(c.r, max(c.g, c.b));
  float knee = post.params.x;
  float soft = clamp(br - post.texel.w + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - post.texel.w) / max(br, 1e-4);
  return c * contrib;
}

void main() {
  vec2 t = post.texel.xy;
  int mode = int(post.texel.z + 0.5);
  if (mode <= 1) {
    vec3 a = texture(uSrc, vUV + t * vec2(-1.0, -1.0)).rgb;
    vec3 b = texture(uSrc, vUV + t * vec2(1.0, -1.0)).rgb;
    vec3 c = texture(uSrc, vUV + t * vec2(-1.0, 1.0)).rgb;
    vec3 d = texture(uSrc, vUV + t * vec2(1.0, 1.0)).rgb;
    vec3 m = texture(uSrc, vUV).rgb;
    vec3 s = (a + b + c + d) * 0.125 + m * 0.5;
    if (mode == 0) s = prefilter(min(s, vec3(64.0)));
    outColor = vec4(s, 1.0);
  } else {
    float r = post.params.y;
    vec3 s = texture(uSrc, vUV).rgb * 4.0;
    s += texture(uSrc, vUV + t * vec2(-r, 0.0)).rgb * 2.0;
    s += texture(uSrc, vUV + t * vec2(r, 0.0)).rgb * 2.0;
    s += texture(uSrc, vUV + t * vec2(0.0, -r)).rgb * 2.0;
    s += texture(uSrc, vUV + t * vec2(0.0, r)).rgb * 2.0;
    s += texture(uSrc, vUV + t * vec2(-r, -r)).rgb;
    s += texture(uSrc, vUV + t * vec2(r, -r)).rgb;
    s += texture(uSrc, vUV + t * vec2(-r, r)).rgb;
    s += texture(uSrc, vUV + t * vec2(r, r)).rgb;
    outColor = vec4(s / 16.0 * post.params.z, 1.0);
  }
}
