# Characters — the humanoid system (v2, published; v3 in progress)

Checkpoint before this work: `pre-humanoid-detail` (see [CHECKPOINTS.md](CHECKPOINTS.md)).

## Engine

* **Linear-blend skinning, up to four joints per vertex.** Vertex layout grew from 48 to 52 bytes
  (`weights unorm8x4 @48` next to `joints u8x4 @44`); `mesh.vert` blends the joints' affine rows.
  Rigid models (buildings, props) are unchanged: one joint, weight 1.
* **Skin weights at build time** (`tools/assetgen/kit/skin.ts`). Pieces are still authored bound
  to one joint; pieces marked `soft` (skin and cloth) are blended across each joint inside a zone
  (half-width along the bone, reach around it — `SKIN_ZONES` in `humanoid.ts`). The weights depend
  only on position, so two pieces meeting at an elbow bend identically and never crack.

## Skeleton (18 joints, parents first)

root · pelvis · chest · **neck** · head · arm/fore/**hand** L R · thigh/shin/**foot** L R.
New joints give wrists, ankles (heel-strike / toe-off in the walk) and a neck.

## Figure kit (`tools/assetgen/recipes/figure.ts`)

| Part | Detail |
|---|---|
| Head | Sculpted surface: brow ridge, eye sockets, cheekbones and hollows, temples, jaw, chin, occiput. Face shape per character (`width`, `jaw`, `nose`, `eyes`, `lips`, `brow`) and `age`. |
| Face | Nose ridge with tip and nostril wings; eyeballs with iris and pupil; almond upper lids with a lash line; lower lids; brows (stern / calm / arched); lips with a cupid's bow; ears with lobes. |
| Hair | Combed-strand shell that thins to nothing at the hairline; topknot (髻) with ribbon and jade pin, low bun, loops or cropped; grey with age; moustache, goatee or long beard. |
| Body | Shaped torso (waist, chest, shoulder blades, sloping shoulders), neck, hips; crossed collar (交领) and sash. |
| Limbs | Upper arm / forearm and thigh / shin with muscle profiles and cloth folds; cuffs. |
| Hands | Palm, four three-segment fingers and a thumb; poses relaxed / fist / open. |
| Feet | Chinese boots with an upturned toe, heel, and a sole. |

Triangle budget: ≈ 13–16k per infantry model (was ≈ 2.4–2.8k).

## Known follow-ups (after review)

* **LOD** for the RTS camera: a light mesh for far zoom (faces and fingers are invisible there).
* Hands wrap weapons only approximately (fist pose); per-weapon grips.
* Faces are geometry and flat colour; painted detail (skin variation, eyebrows, eyeliner) would
  need a texture path for characters.
* Bell sleeves and armour pieces are rigid; they swing with the forearm/pelvis.
