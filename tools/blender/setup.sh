#!/usr/bin/env bash
# Headless Blender for character authoring in cloud sessions (idempotent; ~1-2 min on a fresh
# container, a few seconds when already installed).
#
#   bash tools/blender/setup.sh            # install into $RTS_TOOLS (default ~/.cache/rts-tools)
#   $RTS_TOOLS/blender/bin/python my.py    # run a bpy script (Blender 5.2 LTS as a Python module)
#
# Installs:
#   * Blender 5.2 LTS as the official `bpy` wheel from PyPI, in a Python 3.13 venv
#     (download.blender.org is not reachable from this environment; PyPI is)
#   * Mesa's software OpenGL/EGL, so Eevee and Workbench render without a GPU (Cycles needs none)
#   * the MakeHuman 1.x CC0 assets the character pipeline uses: base mesh, skeleton + weights,
#     modifier list and the morph targets in tools/blender/makehuman-targets.txt
set -euo pipefail
TOOLS="${RTS_TOOLS:-$HOME/.cache/rts-tools}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BPY_VERSION="5.2.2"
MH_RAW="https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data"
mkdir -p "$TOOLS"

# --- system libraries for software rendering (EGL surfaceless via Mesa llvmpipe)
if ! ldconfig -p | grep -q libEGL.so.1; then
  if command -v apt-get >/dev/null; then
    SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
    $SUDO apt-get update -qq
    DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq --no-install-recommends \
      libegl1 libegl-mesa0 libgl1-mesa-dri libgbm1 libxi6 libxkbcommon0 libsm6 libxrender1 libxxf86vm1 >/dev/null
  fi
fi

# --- Blender as a Python module
if ! "$TOOLS/blender/bin/python" -c "import bpy, sys; sys.exit(0 if bpy.app.version_string.startswith('$BPY_VERSION') else 1)" 2>/dev/null; then
  PY=$(command -v python3.13 || true)
  [ -z "$PY" ] && { echo "python3.13 is required for bpy $BPY_VERSION" >&2; exit 1; }
  rm -rf "$TOOLS/blender"
  "$PY" -m venv "$TOOLS/blender"
  "$TOOLS/blender/bin/pip" install -q --disable-pip-version-check "bpy==$BPY_VERSION" numpy pillow
fi

# --- MakeHuman CC0 assets
MH="$TOOLS/makehuman"
mkdir -p "$MH/targets"
fetch() { [ -s "$2" ] || curl -fsSL --retry 3 -o "$2" "$1"; }
fetch "$MH_RAW/3dobjs/base.obj" "$MH/base.obj"
fetch "$MH_RAW/rigs/default.mhskel" "$MH/default.mhskel"
fetch "$MH_RAW/rigs/default_weights.mhw" "$MH/default_weights.mhw"
fetch "$MH_RAW/modifiers/modeling_modifiers.json" "$MH/modeling_modifiers.json"
# targets: ~500 small files, fetched 12 at a time
grep -v '^#' "$HERE/makehuman-targets.txt" | grep . | while read -r t; do mkdir -p "$MH/targets/$(dirname "$t")"; echo "$t"; done |
  MH_RAW="$MH_RAW" MH="$MH" xargs -P 12 -I{} sh -c '[ -s "$MH/targets/{}.target" ] || curl -fsSL --retry 3 -o "$MH/targets/{}.target" "$MH_RAW/targets/{}.target"'

"$TOOLS/blender/bin/python" -c "import bpy; print('bpy', bpy.app.version_string, 'ok')"
echo "makehuman assets: $(find "$MH" -type f | wc -l) files in $MH"
