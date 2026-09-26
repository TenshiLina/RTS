//STAGE
const [cx, cz] = openSpot(20, 34);
const mages = spawnGroup('azure_air_adept', 0, cx - 6, cz - 0.5, 2, 1, 1.2);
const foes = spawnGroup('azure_halberdier', 1, cx + 0.5, cz - 1.5, 9, 3, 0.8);
for (const u of foes) { u.hp = u.maxHp = 400; }
focus(cx - 1, cz);
step(1 / 15, 8);
const [fx, fz] = center(foes);
W.issue(0, { t: 'cast', ids: [mages[0].id], x: fx, z: fz });
return { frames: 90, dt: 1 / 15 };
