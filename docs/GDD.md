# Mandate of Heaven 天命 — Game Design Document (v0.2)

> *Working title.* A base-building RTS in the Command & Conquer tradition, set in a mythic
> East Asia inspired by *Romance of the Three Kingdoms*: geomancers, clockwork oxen, elemental
> academies, and — at the top of the tech tree — magitech that mirrors modern weapons.

## 1. Pillars

1. **Builders beat rushers.** The economy, tech gates and super-weapons all feed on *standing
   structures*. A well-planned base snowballs; a rush against a walled, towered base stalls.
2. **Red Alert 2, remastered.** Saturated, readable, a little cheeky. Chunky silhouettes you can
   identify from the default camera, team colour where the eye lands first (roof glaze, banners),
   modern lighting (soft shadows, baked AO, bloom on magic) without losing the toy-box charm.
3. **Mythic-industrial East Asia.** Han-era palaces and Three Kingdoms war camps meet Mohist
   siege engineering, Zhuge Liang's inventions and Daoist elemental arts. Not generic Western
   fantasy with a coat of paint: the architecture, units, names and mechanics come from the setting.
4. **C&C UX.** Sidebar build frames with cameo portraits and clock-wipe progress, *ready → place*
   structure flow, power bar, a production queue per building, drag-to-place walls, rally points.

## 2. Setting & factions

The Han court has fractured. Warlords, a mountain realm of immortals and whatever wakes beneath
the eastern sea contest the **Mandate of Heaven** — the cosmic right to rule, made literal: it
flows to whoever builds, harmonises and holds the land.

| Faction | Race | Identity | Tier-4 fantasy |
|---|---|---|---|
| **Azure Dynasty 苍朝** (prototype) | Humans | Artificers (Mohist engineering, Zhuge Liang clockwork), gunpowder alchemy, the Academies of the Five Elements. Defensive, industrial. | Lightning arrays, steam armour, dragon-vein reactors |
| **Xian of Kunlun 昆仑仙** | Elves (immortals) | Mountain-dwelling immortals: elemental benders, spirit beasts, living jade architecture, flying swords. Mobile, elite, expensive. | Nine-Heavens flying-sword array, Kun-Peng leviathan |
| *Third faction (TBD)* | — | Candidates: **Dragon King's Court 龙宫** (sea / storms, naval & amphibious) or **Yaoguai Horde 妖** (shapeshifting demons, swarm). | — |

## 3. Economy

| Resource | Role | Source | Notes |
|---|---|---|---|
| **Spirit Jade 灵玉** | Currency ("credits") | Jade veins, harvested by **Wooden Oxen**, refined at the **Jade Refinery** | Veins regrow slowly (RA2 ore). |
| **Qi 气** | Power | **Qi Shrines** (+100) | Low Qi → production ×0.5, defences & radar offline. |
| **Mandate 天命** | Meta resource | Accrues per minute from *standing structures* × Harmony | Gates tiers, charges super-weapons. Drops when structures fall. |

## 4. How the design favours base builders

1. **Mandate gates tiers.** Tier 2 needs the Observatory *and* 150 Mandate; Tier 3 needs 500,
   Tier 4 needs 1200. Mandate only comes from structures, so a pure unit rush cannot tech.
2. **Harmony (feng shui) adjacency.** Structures beside their listed neighbours (a Qi Shrine by
   water, the Garrison Camp by the Yamen…) raise base Harmony (×0.75 – ×1.35), which multiplies
   Mandate income and grants up to +25% production speed. Planned layouts win; sprawl is punished.
3. **Armour classes.** Tier-1 infantry deal ×0.15 damage to *fortified* structures. Taking a base
   needs tier-2 siege (catapults, fire-lance carts, elementalists), which needs a base.
4. **Cheap strong walls + efficient towers.** Walls cost 40 and have 600 HP; Arrow Towers
   out-trade their cost against tier-1 infantry and take garrisons (RA2-style) for bonus fire.
5. **Self-defending core.** The Yamen's terrace archers (garrison 4) repel scouts and early raids.
6. **Maturing economy.** Refineries mature after 5 minutes (+20% refine rate); structures
   self-repair when not recently damaged.
7. **Super-weapons are the payoff**, charged by Mandate — the longer you hold a prosperous base,
   the faster your ultimate arrives.

## 5. UX — the C&C build frame

* **Sidebar** (right side): radar/minimap on top, Jade counter, **Qi bar** (vertical, C&C style),
  **Mandate gauge** (jade-and-gold ring with tier pips).
* **Four tabs**: Structures · Defence · Infantry · Machines. Structures and defences: one queue per
  tab (C&C). Units: **every production building has its own queue** (C&C 3 / StarCraft style) —
  a second Garrison Camp doubles infantry output and its units walk out of its own doors. A new
  order goes to the least busy building, or to the selected one; the selection panel shows (and
  cancels) a building's queue; losing a building refunds what it had in production.
* **Portrait screens**: the sidebar docks along the bottom as a command bar (radar and resources
  left, tabs and a 2–4 column build grid right) so the map keeps the full width.
* **Cameo build frames** rendered from the actual 3D assets (the viewer has a `cameo=1` mode that
  already produces them), framed in lacquered wood with a gold edge. Progress is a radial
  clock-wipe; a completed structure flashes **"Ready"** and follows the cursor for placement over
  the cell grid (green/red footprint, Harmony preview showing which adjacencies light up).
* **Queueing**: left-click queue (up to 5), right-click cancel/hold; walls are **drag-placed** and
  auto-connect.
* **Construction**: placed structures rise out of the ground with a glowing build line (the mesh
  shader already supports this via per-instance clip height).
* **Commands**: attack-move, guard, scatter, deploy (Caravan ↔ Yamen), sell, repair, garrison,
  rally points per factory, control groups, waypoint queues.

## 6. Tech tree

### Tier 1 — *Garrison 营* (prototype scope)

| Structure | Cells | Cost | Qi | Prereq | Produces / role |
|---|---|---|---|---|---|
| Governor's Yamen 衙门 | 4×4 | (Caravan) | +20 | — | Construction yard, garrison archers |
| Qi Shrine 风水坛 | 2×2 | 600 | +100 | Yamen | Power |
| Garrison Camp 兵营 | 3×3 | 500 | −20 | Qi Shrine | Infantry |
| Jade Refinery 玉坊 | 4×3 | 1800 | −30 | Qi Shrine | Refinery (+free Wooden Ox) |
| Artificer Workshop 工坊 | 4×4 | 2000 | −40 | Refinery | Machines |
| Five Elements Academy 五行书院 | 4×4 | 1500 | −30 | Garrison Camp + Qi Shrine | Adepts (tier-2 building pulled forward in the prototype) |
| Jade Vault 玉库 | 1×1 | 150 | −5 | Refinery | Storage |
| Arrow Tower 箭楼 | 1×1 | 500 | −10 | Garrison Camp | Defence |
| Rammed-Earth Wall 城墙 | 1×1 | 40 | 0 | Yamen | Wall (drag) |

| Unit | Cost | From | Role |
|---|---|---|---|
| Halberdier 戟兵 | 100 | Garrison Camp | Line infantry, anti-cavalry |
| Archer 弓手 | 150 | Garrison Camp | Ranged, hits air, tower garrison |
| Daoist Initiate 道士 | 300 | Garrison Camp (+Qi Shrine) | Talisman splash, *Ward* ability |
| Artificer 工匠 | 500 | Garrison Camp | Capture / repair (engineer) |
| Fire Adept 火术士 | 450 | Academy | Fire Serpent (burns) · **Wildfire** (burning ground) |
| Ice Adept 冰术士 | 450 | Academy | Frost Lance (chills; wet → freeze) · **Glacier Spikes** (line freeze) |
| Water Adept 水术士 | 400 | Academy | Water Whip (soaks, shoves) · **Tidal Surge** (knockback, douses fire) |
| Air Adept 风术士 | 450 | Academy | Gale Blade (shoves) · **Whirlwind** (lifts and drops infantry) |
| Wooden Ox 木牛 | 1200 | Workshop (+Refinery) | Harvester |
| Gliding Horse 流马 | 500 | Workshop | Fast clockwork scout |
| Imperial Caravan 御辇 | 3000 | Workshop | MCV → deploys into Yamen |

Full numbers live in [`content/factions/azure_dynasty.json`](../content/factions/azure_dynasty.json).

### Tier 2 — *Prefecture 郡* (Observatory 观星台 + 150 Mandate)
* **Observatory** (radar analogue) · **Academy of the Five Elements** (unlocks elementalists)
  · **Siege Yard** · **Kongming Lantern Loft** (scout balloons).
* Units: **Repeating Crossbowman** (诸葛连弩), **Fire / Water / Ice / Air Adepts** (entry
  elementalists), **Thunderbolt Catapult**, **Fire-Lance Cart** (early gunpowder), **Kongming
  Lantern** (air scout).

### Tier 3 — *Province 州* (Five Elements Academy + 500 Mandate)
* **Sky Dock** (steam airships), **Dragon Kiln** (advanced gunpowder), **Bell of Heaven** (area
  defence that stuns).
* Units: **Elemental Masters** — *Emberlord* (fire), *Tidecaller* (water), *Frostwarden* (ice),
  *Stormdancer* (air); **Clockwork Guardian** (walker mech); **Cloud Junk** (armed airship);
  **Rocket Wagon** (神机箭 artillery).

### Tier 4 — *Mandate 天命* (Hall of Heaven + 1200 Mandate): modern analogues × elemental magic
| Modern analogue | Azure Dynasty version | Element |
|---|---|---|
| Main battle tank | **Thunder Carriage** — steam-armoured carriage with a lightning coil | Air |
| Attack helicopter | **Iron Crane** — rotor ornithopter with fire rockets | Fire |
| MLRS / artillery | **Hailstorm Battery** — launches frozen shards | Ice |
| Hovercraft | **Tide Engine** — amphibious water-jet carriage | Water |
| Tesla coil | **Storm Pagoda** — lightning-rod defence tower | Air |
| Railgun | **Qi Rail Cannon** — magnetised jade slug | Qi |
| Nuclear missile | **Dragon Vein Reactor → Sunfire Descent** (pillar of fire) | Fire |
| Weather control | **Tidal Mirror → Typhoon** | Water + Air |
| Chronosphere | **Frozen Mandate** (stops time in an area) | Ice |

Xian of Kunlun tier 4 (sketch): **Nine-Heavens Sword Array** (orbital strike of flying swords),
**Kun-Peng Leviathan** (carrier), **Phoenix Reactor**, **Celestial Mirror**.

## 7. Biomes (release candidate)
1. **Peach Garden Valley** (prototype) — lush spring meadows, pines, bamboo, peach blossom.
2. **Snowbound Pass** — winter Great-Wall passes, frozen rivers (ice-walkable in winter).
3. **Red Cliffs** — autumn river gorge; naval/amphibious play (Battle of Red Cliffs).
4. **Southern Bamboo Marsh** — dense jungle, fog, rivers.
5. **Silk Road Desert** — dunes, oasis towns, sandstorms.
6. **Kunlun Heights** — floating mountains (Xian home biome).

## 8. Modes
* **Skirmish** vs AI (1v1 → 4-player FFA/teams), map picker by biome.
* **Campaign** — two arcs (Azure / Xian), ~12 missions each, loosely following the Three Kingdoms
  story beats (Peach Garden Oath, Red Cliffs, Wuzhang Plains…), briefings as ink-painting scrolls.
* **Multiplayer** — deterministic lockstep (see ARCHITECTURE.md), 2–8 players, replays.

## 9. M1 prototype — what is in
* **Map**: *Peach Garden Pass* (Peach Garden Valley biome), 64×64 cells of 3 m, two mirrored
  start positions, a contested central jade field plus three fields per side, ponds, streams,
  roads through the middle and both flanks, forested hills at the edges.
* **Flow**: Imperial Caravan → deploy into the Yamen → Qi Shrine → Garrison Camp / Jade Refinery
  → Artificer Workshop (more Wooden Oxen, a second Caravan) · Arrow Towers and walls on the
  Defence tab. Units: Halberdier, Archer, Daoist Initiate (talisman splash), Wooden Ox.
* **Economy**: Oxen seek the nearest field with enough jade, harvest, return to the nearest
  refinery; fields regrow slowly. A player's oxen drive through one another and take turns at
  the dock (the rest wait nearby), and an ox that finds only regrowth trickle nearby delivers what
  it carries instead of shuttling between near-empty nodes. Low Qi halves production and disables towers.
* **Mandate**: each standing structure adds `mandatePerMin` × Harmony. The first power,
  **Heaven's Wrath** (100 Mandate, 45 s recharge): the storm gathers for 1.6 s, then lightning
  strikes a 2.2-cell radius (260 damage, ×0.45 vs structures — anti-army, not a base-killer).
* **Harmony**: listed adjacencies raise it (e.g. Garrison Camp beside the Yamen); isolated
  structures in a base of 3+ lower it. The placement ghost previews it.
* **AI**: builds the same order a player would (power → barracks → refinery → workshop →
  second refinery, towers when threatened), keeps its harvesters busy, masses infantry and
  attacks in growing waves, and casts Heaven's Wrath on your densest group. Normal thinks twice
  as often, attacks sooner (≈2:50 vs 4:30) and with larger waves. It runs *inside* the simulation, issuing the same commands as the player.
* **Design check (builders vs rushers)**: tier-1 infantry deal ×0.15–0.2 to fortified structures,
  towers out-trade infantry, structures self-repair after 12 s, and Mandate only comes from
  buildings — an early rush on a Yamen with towers stalls.

### Magic (added after M1 review)
The four schools, their visual grammar and every spell's beats are specified in
[VFX.md](VFX.md). Signature spells auto-cast on a good cluster or are aimed with **Q**; statuses
are burning, chilled, frozen, wet, knocked back and lifted; reactions tie the schools together
(wet + ice → frozen solid, wet + lightning → bonus damage and arcs, water/ice → douse fire,
whirlwind + fire → fire whirl, fire → thaws ice).

## 10. Milestones
| # | Milestone | Content |
|---|---|---|
| M0 | Foundation + first assets ✓ | Portable engine skeleton, asset pipeline, 17 tier-1 assets, viewer/diorama |
| **M1** | **Playable prototype ✓** *(this drop)* | Caravan deploy, sidebar build/place, harvesting loop, Qi & Mandate, Heaven's Wrath, infantry combat, skirmish AI (Easy/Normal), one map |
| M2 | Tier 1 complete + art pass | Artificer, Gliding Horse, Vault; garrison, walls drag-place, fog of war, sound; detailed humanoids, more building variety, richer spell/super-weapon VFX |
| M3 | Tier 2 + Xian tier 1 | Elementalists, siege, second faction |
| M4 | Multiplayer alpha | Lockstep netcode, lobby, replays |
| M5 | Tiers 3–4, super-weapons | |
| M6 | Campaign vertical slice, more biomes | |
| RC | Content-complete | 3 factions, 6 biomes, 2 campaigns, skirmish + MP; native builds |
