// Engine smoke test: ground FX channels, point lights, new sprites, effect meshes, distortion.
const W = g.world, L = 256;
W.controllers[1] = undefined;
const cx = 20, cz = 34;
const X = g.wx(cx * L), Z = g.wz(cz * L);
g.cam.target = [X, 0, Z - 4];
g.cam.distance = 82;
const h = (x, z) => g.h(x, z);
const v = g.vfx, G = g.groundFx;
// ground channels: scorch+heat (left), frost (mid), wet (right)
G.stamp(0, X - 12, Z, 4, 1); G.stamp(3, X - 12, Z, 3, 1);
G.stamp(1, X, Z, 4.5, 1);
G.stamp(2, X + 12, Z, 4.5, 1);
v.light([X - 12, h(X - 12, Z) + 2, Z], [1, 0.45, 0.12], 30, 12, 99, { flicker: 1 });
// flames on the scorch
v.run(99, (k, dt) => {
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * 6.28, r = Math.random() * 3;
    const x = X - 12 + Math.cos(a) * r, z = Z + Math.sin(a) * r;
    v.ps.spawn({ pos: [x, h(x, z) + 0.9, z], vel: [0, 1.5, 0], life: 0.7, size: [1.0, 0.6], aspect: 0.55, color: [1, 1, 1, 1], cell: 13, mode: 1, additive: true, intensity: [2.2, 1.2] });
  }
  if (Math.random() < 0.3) v.ps.spawn({ pos: [X - 12, h(X - 12, Z) + 1.5, Z], vel: [0, 1.2, 0], life: 1.2, size: [1.2, 2], color: [1, 1, 1, 0.4], cell: 13, mode: 1, distort: true, distortKind: 1, intensity: [1, 1] });
});
// ice spikes + block on the frost
const M4 = (x, y, z, s, sy, ry) => { const c = Math.cos(ry), sn = Math.sin(ry); return new Float32Array([c * s, 0, -sn * s, 0, 0, sy, 0, 0, sn * s, 0, c * s, 0, x, y, z, 1]); };
for (let i = 0; i < 7; i++) {
  const x = X - 3 + i, z = Z + Math.sin(i) * 1.2, s = 0.5 + Math.random() * 0.4;
  v.mesh(1, 0, [1, 1, 1, 0], 99, (m) => { m.matrix = M4(x, h(x, z) - 0.1, z, s, 2.2 + Math.random() * 0.1, i); });
}
v.mesh(2, 0, [1, 1, 1, 0], 99, (m) => { m.matrix = M4(X + 1, h(X + 1, Z + 3), Z + 3, 1.1, 2.1, 0.3); });
// wave + funnel + column
v.mesh(3, 1, [0.12, 0.55, 0.6, 1], 99, (m) => { m.matrix = M4(X + 12, h(X + 12, Z + 3), Z + 3, 7, 2.6, 0); });
v.mesh(4, 3, [0.62, 0.52, 0.38, 0.9], 99, (m) => { m.matrix = M4(X + 6, h(X + 6, Z - 8), Z - 8, 3.2, 9, 0); });
v.mesh(4, 2, [0.9, 0.95, 1, 1], 99, (m) => { m.matrix = M4(X + 6, h(X + 6, Z - 8), Z - 8, 3.5, 9.5, 0); });
v.mesh(5, 4, [1, 1, 1, 1], 99, (m) => { m.matrix = M4(X - 6, h(X - 6, Z - 8), Z - 8, 1.4, 6, 0); });
// sprites: snowflakes, droplets, leaves, crescent, splash, shock distortion
for (let i = 0; i < 20; i++) v.ps.spawn({ pos: [X + Math.random() * 4 - 2, h(X, Z) + 2 + Math.random() * 3, Z - 6 + Math.random() * 2], life: 99, size: [0.3, 0.3], color: [0.85, 0.95, 1, 1], cell: 15, additive: true, intensity: [1.5, 1.5], rot: Math.random() * 6, vrot: 1, mode: 3 });
v.ps.spawn({ pos: [X + 12, h(X + 12, Z - 6) + 1.2, Z - 6], life: 99, size: [1.4, 1.4], color: [0.8, 0.95, 1, 0.9], cell: 18 });
v.ps.spawn({ pos: [X + 16, h(X + 16, Z - 6) + 1.5, Z - 6], life: 99, size: [1.4, 1.4], color: [1, 1, 1, 0.8], cell: 23, additive: true, intensity: [1.4, 1.4] });
v.ps.spawn({ pos: [X - 18, h(X - 18, Z - 6) + 1.5, Z - 6], life: 99, size: [1.6, 1.6], color: [0.6, 0.8, 1, 1], cell: 32, additive: true, mode: 4, intensity: [3, 3] });
v.ps.spawn({ pos: [X + 16, h(X + 16, Z + 8) + 0.2, Z + 8], life: 99, size: [4, 4], color: [1, 1, 1, 1], cell: 10, flat: true, distort: true, intensity: [3, 3] });
step(1 / 30, 20);
return { frames: 30, dt: 1 / 30 };
