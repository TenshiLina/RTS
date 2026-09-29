# Checkpoints

Known-good states to return to. Each is a commit on `claude/friendly-turing-osxq6l` (history on
this branch is never rewritten) plus the matching published build of the playable artifact.

| Name | Commit | Artifact version | State |
|---|---|---|---|
| `pre-humanoid-detail` | `2600b22` | 5 (`1790503206-1215`) | M1 prototype + magic VFX pass, shared build queues with primary buildings, new archer SFX, four switchable music tracks — before the detailed humanoid models |
| `humanoid-v2` | `b0bbe2d` | 6 (`1790592778-9df1`) | Humanoid v2 (blended skinning, sculpted heads with faces, hands, boots) accepted as an intermediate milestone and published; unit-content freeze in place while the character pipeline is upgraded |
| `base-woman-blender-r2` | `5f300ae` | — (tooling only; unit freeze) | Blender character pipeline, round 2 of the base woman: body fitted to the concept sheet in the posed stance (shape modifiers + profile warp), MakeHuman's own breast, jaw/neck and face fitted to explicit silhouettes in the close-ups, head-only macro blend, eyeballs. Face features (eyes, lips) not yet at the concept's level. Review images: `docs/art/factions/human/review/blender-r2-*.webp`. Kept alongside for reference: `62eab69`, the same round with the parametric bust (rejected) |

Return to a checkpoint:

```sh
git checkout 2600b22            # look around (detached)
git switch -c restore 2600b22   # or branch from it
# or put a tag on it where tags can be pushed:
git tag checkpoint/pre-humanoid-detail 2600b22 && git push origin checkpoint/pre-humanoid-detail
```
