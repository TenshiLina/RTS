#version 450
layout(set = 0, binding = 0) uniform UIUniforms {
  vec4 viewport; // xy = size in px, z = uv origin top (0/1)
} ui;
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aUV;
layout(location = 2) in vec4 aColor;
layout(location = 0) out vec2 vUV;
layout(location = 1) out vec4 vColor;
void main() {
  vUV = aUV;
  vColor = aColor;
  vec2 ndc = aPos / ui.viewport.xy * 2.0 - 1.0;
  gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
}
