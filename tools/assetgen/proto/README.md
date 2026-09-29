# MakeHuman base-mesh prototype (evaluation only)

Throwaway scripts used to evaluate the CC0 MakeHuman base mesh as the foundation for human
characters (see `docs/art/factions/human/review/foundation-*.webp`). Not part of the build.

* `fit.ts` — loads `base.obj` + macro/modifier targets, poses arms and legs with the default
  skeleton weights, and fits modifier weights to the concept sheet's silhouettes.
* `view.ts`, `heads.ts` — review renders. `fit2.json` — the bounded body-only fit.

The scripts expect the MakeHuman data (base mesh, targets, `default_weights.mhw`) in a scratch
directory; it is not committed. Source: github.com/makehumancommunity/makehuman (assets CC0 1.0).
