# Checkpoints

Known-good states to return to. Each is a commit on `claude/friendly-turing-osxq6l` (history on
this branch is never rewritten) plus the matching published build of the playable artifact.

| Name | Commit | Artifact version | State |
|---|---|---|---|
| `pre-humanoid-detail` | `2600b22` | 5 (`1790503206-1215`) | M1 prototype + magic VFX pass, shared build queues with primary buildings, new archer SFX, four switchable music tracks — before the detailed humanoid models |

Return to a checkpoint:

```sh
git checkout 2600b22            # look around (detached)
git switch -c restore 2600b22   # or branch from it
# or put a tag on it where tags can be pushed:
git tag checkpoint/pre-humanoid-detail 2600b22 && git push origin checkpoint/pre-humanoid-detail
```
