#version 450
layout(location = 0) in vec4 vColor;
layout(location = 0) out vec4 outColor;
void main() {
  // premultiplied; HDR-friendly (values > 1 bloom)
  outColor = vec4(vColor.rgb * vColor.a * 1.6, vColor.a);
}
