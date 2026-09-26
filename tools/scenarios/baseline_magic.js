// Baseline: the M1 magic as shipped — 4 Daoist Initiates vs 8 Halberdiers, then Heaven's Wrath.
const W = g.world, L = 256;
W.controllers[1] = undefined; // no AI: a staged fight
// find an open 14x10 cell area near the middle of our half
let spot = null;
for (let r = 0; r < 20 && !spot; r++) for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r && !spot; dx++) {
  const cx = 20 + dx, cz = 34 + dz;
  let ok = true;
  for (let z = cz - 5; z < cz + 5 && ok; z++) for (let x = cx - 7; x < cx + 7 && ok; x++) ok = W.inBounds(x, z) && W.passable(W.cellIndex(x, z));
  if (ok) spot = [cx, cz];
}
const [cx, cz] = spot;
const mine = [], theirs = [];
for (let i = 0; i < 4; i++) mine.push(W.spawnUnit('azure_daoist', 0, (cx - 5) * L + 128, (cz - 2 + i * 1.3) * L));
for (let i = 0; i < 8; i++) theirs.push(W.spawnUnit('azure_halberdier', 1, (cx + 3 + (i % 2) * 1.2) * L, (cz - 3 + (i >> 1) * 1.4) * L));
for (const u of theirs) W.issue(1, { t: 'move', ids: [u.id], x: (cx - 1) * L, z: cz * L, attackMove: true });
g.cam.target = [g.wx(cx * L), 0, g.wz(cz * L) - 4];
g.cam.distance = 82;
step(1 / 30, 45);
const P = W.players[0];
P.mandateMilli = 200000; P.powerCharge.heavens_wrath = 0;
g.issue({ t: 'power', power: 'heavens_wrath', x: (cx + 2) * L, z: cz * L });
return { frames: 120, dt: 1 / 30 };
