#version 450
#include "common.glsl"
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 0) out vec4 vColor;
void main() {
  vColor = aColor;
  gl_Position = frame.viewProj * vec4(aPos, 1.0);
}
