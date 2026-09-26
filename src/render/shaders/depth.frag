#version 450
// Depth-only pass (shadow map). Honours the construction clip so half-built structures cast
// correctly shaped shadows.
layout(location = 6) in vec3 vObjPos;
layout(location = 7) flat in vec4 vInst;

void main() {
  if (vObjPos.y > vInst.w) discard;
}
