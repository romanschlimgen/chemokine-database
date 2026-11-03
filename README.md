# Data associated with the manuscript ""

Interactive and downloadable data/models available in this repository or at romanschlimgen.github.io/ckrmodeling/website

## Repo layout (in progress revamp)

- `data/` — source-of-truth CSVs (receptors, chemokines, pairs, binding results) and the
  PDB models/figures they reference. See [`data/README.md`](data/README.md) for the format.
  **This is the only folder that needs editing to add or update data.**
- `scripts/build_db.py` — reads `data/` and builds `site/data/ckr.sqlite`, the database the
  site queries at runtime. Run `python3 scripts/build_db.py` after changing anything in `data/`.
- `site/` — the static database-backed site (plain HTML/JS, no build step; sql.js, NGL, and
  D3 loaded from CDN). This is what gets deployed to GitHub Pages. Searchable table of all
  receptor–chemokine pairs on `index.html`, with a detail page per pair (`pair.html?pair=...`)
  showing the structure model, binding data, and real inter-chain contacts computed from the
  model coordinates.
- `docs/` — the original R/distill site. Left in place for reference during the revamp; not
  currently deployed.

Currently seeded with only the original CXCR4–CXCL12 example while the rest of the dataset is
being reanalyzed.
