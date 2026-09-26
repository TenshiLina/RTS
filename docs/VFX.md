# Magic VFX — audit and visual grammar

Magic is one of the game's visual pillars. This document is the spec the effects are built
and reviewed against. Every spell is judged **in gameplay at the default RTS camera**
(distance 82 m, 30° FOV, 52° pitch), where an infantryman is ~20 px tall on a 1280×800 screen.
Close-ups do not count.

## 1. Audit of M1 (before this pass)

| Effect | What it was | Problems at RTS zoom |
|---|---|---|
| Daoist talisman (projectile) | 0.3 m paper sprite + orange glow + embers | Reads as a 3-px yellow dot. No arc, no anticipation at the caster. |
| Talisman burst | orange flare, sparks, paper scraps, smoke puff, gold shock ring | Generic flare; same vocabulary as a building explosion. |
| Heaven's Wrath — gather | dark smoke sprites 12–16 m up, rune ring on the ground | Clouds read as a faint smudge; nothing builds tension. |
| Heaven's Wrath — strike | 4 thin bolts, a 3.5× white glow, white shock ring, sparks | White bloom blowout hides the bolts; the glow sprite is cut by the ground in a hard line; the ground is unchanged afterwards. |
| Fire / Ice / Water / Air | **not implemented** | The four elemental schools did not exist yet. |

Engine gaps found: no dynamic lights (fire does not light its surroundings), no way to change
the ground (scorch/frost/wet), no distortion (heat haze, air), no 3D effect meshes (ice, waves,
funnels), particles clip hard against terrain, foliage ignores local wind, and no sound.

## 2. Readability rules (all schools)

1. **Silhouette first.** Each school owns a shape family that survives at 20 px: the shape must
   read in a greyscale thumbnail before colour is considered.
2. **Value structure, not just hue.** Fire is emissive with dark smoke; Ice is reflective with
   white highlights and navy shadows; Water is glossy and translucent with white foam; Air is
   nearly colourless and is shown by what it carries and distorts.
3. **Beats.** Every spell has anticipation at the caster (0.3–0.6 s) → release → travel →
   impact → linger → dissipate. Anticipation uses the school's colour on the caster so the
   player can tell *who* is casting.
4. **The world remembers.** Every school leaves a mark on the ground that outlasts the particles.
5. **No white-outs.** Peak brightness is reserved for cores; bloom must never hide the shape.
6. **Combat clarity.** Lingering zones (burning ground, frost, whirlwinds) show their gameplay
   area honestly: their edge is where the effect is.

## 3. The four schools

| | **Fire 火** | **Ice 冰** | **Water 水** | **Air 风** |
|---|---|---|---|---|
| Shape family | Upward tongues, teardrops, billowing columns | Straight lines, sharp triangles, hexagonal crystals, spikes | Arcs, crescents of spray, concentric rings, droplets | Spirals, long streaks, rotating rings |
| Motion | Accelerates upward, flickers, chaotic; slow-out smoke | Sudden appearance, then stillness; holds, then *snaps* | Smooth ease-in-out arcs, follow-through, gravity | Fastest travel, constant rotation, whip-like; weightless until released |
| Value / colour | White core → yellow → orange → deep red → black smoke | White glints, cyan body, navy depth; low emission | Aquamarine body, white foam, glossy highlights, translucent | Colourless: distortion, pale streaks, carried dust/leaves |
| Particles | Flame tongues, rising embers, heat haze, smoke | Snow crystals, glitter, frost mist hugging the ground, shard fragments | Droplets with gravity, spray, foam, ripple rings | Speed lines, dust, leaves and petals from nearby trees |
| Environment | Scorches ground, burning patches, lights up surroundings, smoke seen from afar | Frost spreads in crystalline patterns, freezes water surfaces, encases units | Wets ground (dark, glossy), puddles with ripples, extinguishes fire | Bends trees, kicks dust from the ground, pushes smoke |
| Impact | Explosive expansion, ember spray, flame patch | Crack → shatter into bouncing fragments, frost burst | Splash crown, droplets, ripples, knockback | Slash streak, dust ring blown outward, push |
| Linger | Burning ground → glowing embers → char | Spikes stand, then shatter; frost melts into wet ground | Wet ground evaporates in wisps; puddles | Dust haze settles, leaves drift down |
| Sound | Roar + crackle (broadband, low-mid), whoosh | Crystalline chimes (inharmonic), sharp cracks, glass tinkle | Liquid gurgles (resonant sweeps), splashes, wash | Band-passed whooshes, howls, whistles |
| Anticipation | Hands ignite, flame spirals up the arms | Frost mist gathers, crystals form around the hand | Water rises from the ground in threads and coils around the caster | Leaves and dust start circling, robes flutter |

## 4. Spells (Five Elements Academy, tier 1.5 in the prototype)

| Unit | Basic attack | Signature spell (auto-cast, or **Q** + click) |
|---|---|---|
| **Fire Adept 火术士** | **Fire Serpent** — an undulating fireball with a long flame tail; bursts, ignites the target (burning 3 s) | **Wildfire 燎原** — flame snakes out of the ground and races outward into a ring of tall fire; the area burns for 6 s (damage over time), then chars |
| **Ice Adept 冰术士** | **Frost Lance** — a crystal spear flies straight and fast, shatters into fragments; chills (−35% speed, 3 s) | **Glacier Spikes 冰封** — spikes erupt in sequence along a line; enemies caught are frozen solid for 2.5 s; spikes stand, then shatter; water under the line freezes |
| **Water Adept 水术士** | **Water Whip** — a sinuous tendril lashes out and retracts; splash, small knockback, target is wet (8 s) | **Tidal Surge 怒涛** — a wave rises and rolls forward, knocking enemies back and soaking the ground; puts out fires in a burst of steam |
| **Air Adept 风术士** | **Gale Blade** — a spinning crescent of compressed air, visible as a warp with white edges; pushes the target | **Whirlwind 旋风** — a funnel wanders through the target area for 4 s, lifting and spinning enemies before dropping them; bends trees, drags dust and leaves |

**Elemental reactions** (the systems talk to each other):
* Wet + Ice → frozen solid (a chill becomes a freeze; freezes last longer).
* Wet + lightning (Heaven's Wrath) → +50% damage, arcs crawl across wet ground.
* Water on burning ground → extinguished in a steam burst.
* Whirlwind through burning ground → **fire whirl** (the funnel ignites and burns what it lifts).
* Fire on a frozen unit → thaw with steam.

## 5. Heaven's Wrath and the Daoist talisman (reworked)

* **Heaven's Wrath (Heaven/Air):** a storm disk spirals in overhead with internal lightning,
  wind gusts outward, the ground rune ring charges; then a main bolt plus branches, a hard light
  flash (not a white-out), fused glowing ground that cools, and electric arcs over wet ground.
* **Talisman (Qi):** the paper spins, trailing golden script; it bursts into a ring of burning
  glyphs. Qi gold is kept distinct from fire orange.

## 6. Engine features that serve the grammar

* Dynamic point lights (up to 16) in terrain, mesh and water shading, with flicker.
* A ground-effects map (scorch / frost / wet / heat) read by the terrain, mesh and water shaders.
* Local wind gusts that bend foliage.
* A screen-space distortion pass (heat haze, air blades, shock rings).
* Particle shader modes (living flame, crystal glitter, droplets, dissolve), soft intersection with
  terrain, ground collision (droplets splash, fragments bounce), orbiting particles, textured
  trails.
* Procedural 3D effect meshes: ice shards, spikes and blocks, the wave, the funnel, flame columns.
* Procedural audio synthesised at startup (no sample files) behind `Platform.audio`.
