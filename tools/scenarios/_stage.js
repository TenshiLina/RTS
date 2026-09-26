// shared staging helper, prepended to school scenarios by tools/capture.ts (see STAGE marker)
const W = g.world, L = 256;
W.controllers[1] = undefined;
function openSpot(cx0, cz0, hw = 7, hh = 5) {
  for (let r = 0; r < 20; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const cx = cx0 + dx, cz = cz0 + dz;
    let ok = true;
    for (let z = cz - hh; z < cz + hh && ok; z++) for (let x = cx - hw; x < cx + hw && ok; x++) ok = W.inBounds(x, z) && W.passable(W.cellIndex(x, z));
    if (ok) return [cx, cz];
  }
  return [cx0, cz0];
}
function spawnGroup(type, owner, cx, cz, n, cols = 3, gap = 0.55) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(W.spawnUnit(type, owner, Math.round((cx + (i % cols) * gap) * L), Math.round((cz + Math.floor(i / cols) * gap) * L)));
  return out;
}
function focus(cx, cz, dist = 82) {
  g.cam.target = [g.wx(cx * L), 0, g.wz(cz * L) - 4];
  g.cam.distance = dist;
}
const center = (us) => [Math.round(us.reduce((a, u) => a + u.x, 0) / us.length), Math.round(us.reduce((a, u) => a + u.z, 0) / us.length)];
