# Data folder

This is the only folder you need to touch to update the site. Drop your reanalyzed
files in here following the formats below, then run:

```bash
python3 scripts/build_db.py
```

from the repo root. That regenerates `site/data/ckr.sqlite` (and copies structures/
figures into `site/data/`), which is everything the static site reads at runtime.
Nothing else needs to change.

## Tables (CSV files, one row per record)

### `receptors.csv`
| column | meaning |
|---|---|
| `receptor_id` | short unique key, e.g. `CXCR4` |
| `name` | display name |
| `gene_name` | |
| `family` | e.g. "Class A GPCR" |
| `uniprot_id` | |
| `notes` | free text |

### `chemokines.csv`
| column | meaning |
|---|---|
| `chemokine_id` | short unique key, e.g. `CXCL12` |
| `name` | display name |
| `systematic_name` | e.g. "SDF-1" |
| `class` | CXC / CC / CX3C / XC |
| `uniprot_id` | |
| `notes` | free text |

### `pairs.csv` — one row per receptor–chemokine pair you have a model for
| column | meaning |
|---|---|
| `pair_id` | short unique key, e.g. `CXCR4_CXCL12` |
| `receptor_id` | must match a row in `receptors.csv` |
| `chemokine_id` | must match a row in `chemokines.csv` |
| `pair_type` | e.g. `validated`, `predicted`, `known`, `novel` |
| `model_confidence` | numeric score from your modeling pipeline, if you have one |
| `structure_file` | filename of the PDB model, must exist in `data/structures/` |
| `receptor_chain` | chain ID of the receptor in that PDB, e.g. `A` |
| `chemokine_chain` | chain ID of the chemokine in that PDB, e.g. `B` |
| `notes` | free text |

### `binding.csv` — one row per binding/pharmacology result
| column | meaning |
|---|---|
| `binding_id` | short unique key |
| `pair_id` | must match a row in `pairs.csv` |
| `assay_type` | e.g. "competition binding", "SPR", "FP" |
| `kd_nm` | Kd in nM, if applicable |
| `ic50_nm` | IC50 in nM, if applicable |
| `n_replicates` | |
| `analysis_method` | whatever software/pipeline produced the number, for provenance |
| `raw_data_file` | filename in `data/raw_binding/`, if you want the raw file linked |
| `legacy_figure` | filename in `data/legacy_figures/`, if there's an old static figure to keep around |
| `notes` | free text |

Leave numeric fields blank rather than guessing — the site renders blanks as
"pending" instead of a number.

## Structure files

Put every PDB model referenced by `pairs.csv` in `data/structures/`.

## Contact overrides (optional)

By default the build script computes real inter-chain residue contacts directly
from each pair's PDB file (heavy-atom distance cutoff, see `scripts/build_db.py`),
so the chord/network plot on each pair's page reflects the actual structure —
not placeholder data. If you've already computed contacts yourself (e.g. a
different distance cutoff or a different contact-scoring method) and want to use
those instead, drop a CSV at `data/contacts/<pair_id>.csv` with columns
`receptor_resnum,receptor_resname,chemokine_resnum,chemokine_resname,distance_angstrom`
and the build script will use that file instead of recomputing.
