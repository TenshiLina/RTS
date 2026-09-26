//STAGE
// wildfire, then a tidal surge rolls through it: the fire is doused in a burst of steam
const [cx, cz] = openSpot(20, 34);
const fire = spawnGroup('azure_fire_adept', 0, cx - 6, cz - 1, 1);
const water = spawnGroup('azure_water_adept', 0, cx - 5, cz + 1, 1);
const foes = spawnGroup('azure_halberdier', 1, cx + 0.5, cz - 1.5, 9, 3, 0.8);
for (const u of foes) { u.hp = u.maxHp = 1500; }
focus(cx - 1, cz);
const [fx, fz] = center(foes);
W.issue(0, { t: 'cast', ids: [fire[0].id], x: fx, z: fz });
step(1 / 15, 36);
W.issue(0, { t: 'cast', ids: [water[0].id], x: fx, z: fz });
step(1 / 15, 6);
return { frames: 50, dt: 1 / 15 };
