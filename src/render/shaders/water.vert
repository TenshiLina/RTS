#version 450
#include "common.glsl"
layout(location = 0) in vec3 aPos;
layout(location = 0) out vec3 vWorldPos;
void main() {
  vWorldPos = aPos;
  gl_Position = frame.viewProj * vec4(aPos, 1.0);
}
