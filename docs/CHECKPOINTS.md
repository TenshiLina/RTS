# Checkpoints

Known-good states to return to. Each is a commit on `claude/friendly-turing-osxq6l` (history on
this branch is never rewritten) plus the matching published build of the playable artifact.

| Name | Commit | Artifact version | State |
|---|---|---|---|
| `pre-humanoid-detail` | `2600b22` | 5 (`1790503206-1215`) | M1 prototype + magic VFX pass, shared build queues with primary buildings, new archer SFX, four switchable music tracks — before the detailed humanoid models |
| `humanoid-v2` | `b0bbe2d` | 6 (`1790592778-9df1`) | Humanoid v2 (blended skinning, sculpted heads with faces, hands, boots) accepted as an intermediate milestone and published; unit-content freeze in place while the character pipeline is upgraded |
| `base-woman-blender-r2` | `5f300ae` | — (tooling only; unit freeze) | Blender character pipeline, round 2 of the base woman: body fitted to the concept sheet in the posed stance (shape modifiers + profile warp), MakeHuman's own breast, jaw/neck and face fitted to explicit silhouettes in the close-ups, head-only macro blend, eyeballs. Face features (eyes, lips) not yet at the concept's level. Review images: `docs/art/factions/human/review/blender-r2-*.webp`. Kept alongside for reference: `62eab69`, the same round with the parametric bust (rejected) |
| `base-woman-face-r3a` | `f525892` | — (tooling only; unit freeze) | Face round 3, intermediate (kept to return to on regressions; the face is not yet approved): ICT-FaceKit's face model on the MakeHuman head fitted to the close-ups, the eye pitch experiment reverted, the neck straightened (the head 1.2 cm back over the torso, a straight column as the concept's), three-view landmark comparison tool. Known gaps: iris and eyeball far too large, eye openings too long, nose radix low, lower face broad. Review images: `docs/art/factions/human/review/blender-r3a-*.webp` |
| `base-woman-face-r3b` | `99f7bfb` | — (tooling only; unit freeze) | Face round 3b, intermediate ("eyes17": accepted as a meaningful improvement, kept to return to on regressions). The lid margins laid along a re-measured trace (the liner band's lower edge; the old trace was bent by the liner's gradient) by a new margin warp and solver (`character/fit_margin.py`); irises placed (4° down); lid contact shadow, medial white lift, corner recess and caruncle shading. Known gaps: reads hooded (deep crease, plus the concept's liner), eyeball small for its socket (dark gaps at the corners), outer corner hooks below the lash line. Review images: `docs/art/factions/human/review/blender-r3b-*.webp` |
| `base-woman-face-r3c` | `9be8a5c` | — (tooling only; unit freeze) | Face round 3c, intermediate: the trace corrected by an adversarial review (outer corner on the lash line, lower lid at the iris' limbus, inner corner by the caruncle); eyeball 13 mm (lids draped to it) with the reference's 11.5 mm iris, filling the opening; the outer corner's crumpled skin relaxed. Known gaps: convex fold and deep crease above the lid, 0.8 px corner recess, clipped catchlights, a margin speck, whisker-like outer lower lashes. Review images: `docs/art/factions/human/review/blender-r3c-*.webp` |
| `base-woman-face-r3d` | `6f5319f` | — (tooling only; unit freeze) | Face round 3d, intermediate (current best eyes): r3c with the deep lid crease removed (the crease where and as deep as the concept's, no hooding fold) and the corner conjunctiva white, so the eyeball reads as filling its socket; with the makeup preview (`RTS_MAKEUP=1`) the eyes read close to the concept. Known gaps: clipped catchlights, a margin specular speck, whisker-like outer lower lashes, irises placed by gaze pending a refit of the front frame's pupil row; nose and jaw to do. Review images: `docs/art/factions/human/review/blender-r3d-*.webp` |

Return to a checkpoint:

```sh
git checkout 2600b22            # look around (detached)
git switch -c restore 2600b22   # or branch from it
# or put a tag on it where tags can be pushed:
git tag checkpoint/pre-humanoid-detail 2600b22 && git push origin checkpoint/pre-humanoid-detail
```
