//STAGE
// water adepts soak a squad, then Heaven's Wrath: lightning should race across the wet ground
const [cx, cz] = openSpot(20, 34);
const mages = spawnGroup('azure_water_adept', 0, cx - 5, cz - 0.5, 2, 1, 1.2);
const foes = spawnGroup('azure_halberdier', 1, cx + 0.5, cz - 1.5, 9, 3, 0.8);
for (const u of foes) { u.hp = u.maxHp = 1200; }
focus(cx - 1, cz);
const [fx, fz] = center(foes);
W.issue(0, { t: 'cast', ids: [mages[0].id], x: fx, z: fz });
step(1 / 15, 45);
const P = W.players[0];
P.mandateMilli = 200000; P.powerCharge.heavens_wrath = 0;
const [gx, gz] = center(foes);
W.issue(0, { t: 'power', power: 'heavens_wrath', x: gx, z: gz });
step(1 / 15, 8);
return { frames: 45, dt: 1 / 15 };
