//STAGE
// wildfire, then a whirlwind driven through it becomes a fire whirl
const [cx, cz] = openSpot(20, 34);
const fire = spawnGroup('azure_fire_adept', 0, cx - 6, cz - 1, 1);
const air = spawnGroup('azure_air_adept', 0, cx - 6, cz + 1, 1);
const foes = spawnGroup('azure_halberdier', 1, cx + 0.5, cz - 1.5, 9, 3, 0.8);
for (const u of foes) { u.hp = u.maxHp = 1500; }
focus(cx - 1, cz);
const [fx, fz] = center(foes);
W.issue(0, { t: 'cast', ids: [fire[0].id], x: fx, z: fz });
step(1 / 15, 30);
W.issue(0, { t: 'cast', ids: [air[0].id], x: fx, z: fz });
step(1 / 15, 12);
return { frames: 45, dt: 1 / 15 };
