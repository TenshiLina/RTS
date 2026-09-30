# Headless Blender (character authoring)

`bash tools/blender/setup.sh` installs, idempotently (~1 min fresh, ~2 s when present):

* **Blender 5.2 LTS** as the official `bpy` wheel from PyPI, in a Python 3.13 venv at
  `$RTS_TOOLS/blender` (default `~/.cache/rts-tools`). Run scripts with
  `$RTS_TOOLS/blender/bin/python script.py`.
* **Mesa software OpenGL/EGL** so Eevee/Workbench render without a GPU. Cycles (CPU) is the
  preferred review renderer: ~6 s per 360×440 view with OpenImageDenoise; software Eevee is
  slower (~30 s).
* **MakeHuman 1.x CC0 assets** into `$RTS_TOOLS/makehuman`: base mesh, default skeleton and
  weights, modifier list, and the morph targets listed in `makehuman-targets.txt`.
* **ICT-FaceKit's face model** (ICT Face Model Light, MIT licence, copyright USC Institute for
  Creative Technologies; its `LICENSE` is kept beside the data) into `$RTS_TOOLS/ict`: the
  neutral head and 100 identity shapes from light-stage scans, converted to `ict.npz`.
  `lib/ict.py` registers the MakeHuman head to it and builds the characters' faces from it
  (natural faces fitted to the concept; see `character/fit_face.py`). Credit it with the
  characters.

Verified in the cloud environment: scene built with `bpy`, rendered headlessly (Workbench,
Eevee, Cycles), inspected, edited, re-rendered; MakeHuman base imported with targets as shape
keys and rendered in Cycles. `download.blender.org` is not reachable under the default network
policy; PyPI is, and carries current Blender releases.
