#!/usr/bin/env python3
"""Fits BRET saturation-binding curves from data/raw_binding/*.csv and writes
the results into data/binding.csv, plus the raw (concentration, BRET) points
per pair into data/binding_curves/<pair_id>.csv so the site can plot both the
real data points and the fitted curve.

Run from the repo root, after dropping raw CSVs into data/raw_binding/:
    python3 scripts/analyze_binding.py
then rebuild the database as usual:
    python3 scripts/build_db.py

Input format (data/raw_binding/<RECEPTOR_ID>.csv) — see data/README.md:
    first column = ligand concentration in M, one further column per
    chemokine's BRET ratio at that concentration, column header
    "<CHEMOKINE_ID>-<tracer>" (e.g. "CXCL12-AZ568").

Model: this is a direct (saturation) binding assay — an NLuc-tagged receptor
(BRET donor) titrated with an AZDye-labeled chemokine (acceptor) — not a
competition assay, so it yields an apparent Kd (reported here as EC50, the
concentration at half-maximal BRET), not an IC50. Each chemokine's
BRET-ratio-vs-concentration curve is fit with a three-parameter logistic,
Hill slope fixed at 1 (GraphPad's "log(agonist) vs. response", standard
slope), with X = log10(concentration in M):

    Y = Bottom + (Top - Bottom) / (1 + 10**(LogEC50 - X))

giving Bottom (baseline), Top (Bmax), and LogEC50 per chemokine.
"""
import csv
import re
from pathlib import Path

import numpy as np
from scipy.optimize import curve_fit

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
RAW_DIR = DATA_DIR / "raw_binding"
CURVES_DIR = DATA_DIR / "binding_curves"
BINDING_CSV = DATA_DIR / "binding.csv"

# A fitted curve whose dynamic range (Bmax - baseline) falls below this is
# treated as "no detectable binding" rather than a real affinity — see the
# note where it's used.
MIN_DYNAMIC_RANGE = 1.0

BINDING_FIELDS = [
    "binding_id", "pair_id", "assay_type", "kd_nm", "ic50_nm", "n_replicates",
    "analysis_method", "raw_data_file", "legacy_figure",
    "fit_bottom", "fit_top", "fit_r2", "notes",
]


def logistic(logx, bottom, top, logec50):
    return bottom + (top - bottom) / (1 + 10 ** (logec50 - logx))


def fit_curve(conc_m, bret):
    logconc = np.log10(conc_m)
    p0 = [1.0, bret.max(), float(np.median(logconc))]
    bounds = ([-np.inf, 0, logconc.min() - 4], [np.inf, np.inf, logconc.max() + 4])
    popt, _ = curve_fit(logistic, logconc, bret, p0=p0, bounds=bounds, maxfev=20000)
    bottom, top, logec50 = (float(v) for v in popt)
    pred = logistic(logconc, *popt)
    ss_res = float(np.sum((bret - pred) ** 2))
    ss_tot = float(np.sum((bret - bret.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    extrapolated = logec50 > logconc.max() or logec50 < logconc.min()
    return {"bottom": bottom, "top": top, "ec50_m": 10 ** logec50, "r2": r2, "extrapolated": extrapolated}


def chemokine_id_from_column(column_header):
    # "CXCL12-AZ568" -> "CXCL12"
    return re.split(r"[-_]", column_header)[0]


def main():
    if not RAW_DIR.exists() or not any(RAW_DIR.glob("*.csv")):
        print(f"No files in {RAW_DIR.relative_to(REPO_ROOT)}/ yet — nothing to analyze.")
        return

    CURVES_DIR.mkdir(exist_ok=True)

    # Carry over hand-maintained fields (currently just legacy_figure) from
    # the existing binding.csv before regenerating it from the raw data.
    legacy_by_pair = {}
    if BINDING_CSV.exists():
        with open(BINDING_CSV, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("legacy_figure"):
                    legacy_by_pair[row["pair_id"]] = row["legacy_figure"]

    rows_out = []
    for raw_file in sorted(RAW_DIR.glob("*.csv")):
        receptor_id = raw_file.stem
        with open(raw_file, newline="", encoding="utf-8") as f:
            reader = csv.reader(f)
            header = next(reader)
            columns = header[1:]
            data_rows = [r for r in reader if r and r[0] != ""]

        conc_m = np.array([float(r[0]) for r in data_rows])

        for i, col in enumerate(columns):
            chemokine_id = chemokine_id_from_column(col)
            bret = np.array([float(r[i + 1]) for r in data_rows])
            pair_id = f"{receptor_id}_{chemokine_id}"

            try:
                fit = fit_curve(conc_m, bret)
                dynamic_range = fit["top"] - fit["bottom"]
                if dynamic_range < MIN_DYNAMIC_RANGE:
                    # The curve never rises meaningfully above baseline, so a
                    # sigmoid fit to it is fitting noise, not binding -
                    # reporting a numeric Kd here would look precise but be
                    # meaningless. Leave it blank ("pending"/not-detected)
                    # instead of a fabricated-looking affinity.
                    kd_nm = None
                    notes = (
                        f"No detectable binding: BRET ratio vs. log[{col}] never rose "
                        f"meaningfully above baseline (fitted dynamic range "
                        f"{dynamic_range:.2f}, below the {MIN_DYNAMIC_RANGE:.1f} cutoff), "
                        "so an EC50 was not reported rather than fitting noise."
                    )
                    fit_fields = {"kd_nm": "", "fit_bottom": "", "fit_top": "", "fit_r2": ""}
                    print(f"  {pair_id}: no detectable binding (dynamic range {dynamic_range:.2f})")
                else:
                    kd_nm = fit["ec50_m"] * 1e9
                    caveat = (
                        " This EC50 extrapolates beyond the concentration range actually "
                        "tested, so it's a rough estimate from the curve's rising portion, "
                        "not a directly observed plateau."
                        if fit["extrapolated"]
                        else ""
                    )
                    notes = (
                        f"LogEC50 from a three-parameter logistic fit (Hill slope fixed at 1; "
                        f"scipy nonlinear regression) of BRET ratio vs. log[{col}]. "
                        f"Bmax={fit['top']:.2f}, baseline={fit['bottom']:.2f}, R²={fit['r2']:.4f}."
                        f"{caveat}"
                    )
                    fit_fields = {
                        "kd_nm": f"{kd_nm:.4g}",
                        "fit_bottom": f"{fit['bottom']:.4g}",
                        "fit_top": f"{fit['top']:.4g}",
                        "fit_r2": f"{fit['r2']:.4g}",
                    }
                    print(f"  {pair_id}: EC50={kd_nm:.2f} nM  Bmax={fit['top']:.2f}  R2={fit['r2']:.4f}{' [extrapolated]' if fit['extrapolated'] else ''}")
            except RuntimeError as e:
                notes = f"Curve fit failed to converge for {col} ({e}); raw data is still available."
                fit_fields = {"kd_nm": "", "fit_bottom": "", "fit_top": "", "fit_r2": ""}
                print(f"  {pair_id}: FIT FAILED")

            rows_out.append({
                "binding_id": f"{pair_id}_bret",
                "pair_id": pair_id,
                "assay_type": "BRET saturation binding (NLuc receptor / AZDye568 chemokine)",
                "ic50_nm": "",
                "n_replicates": "",
                "analysis_method": "Three-parameter logistic fit, Hill slope fixed at 1 (scipy.optimize.curve_fit); scripts/analyze_binding.py",
                "raw_data_file": raw_file.name,
                "legacy_figure": legacy_by_pair.get(pair_id, ""),
                "notes": notes,
                **fit_fields,
            })

            curve_path = CURVES_DIR / f"{pair_id}.csv"
            with open(curve_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["conc_m", "bret"])
                for c, b in zip(conc_m, bret):
                    writer.writerow([c, b])

    with open(BINDING_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=BINDING_FIELDS)
        writer.writeheader()
        writer.writerows(rows_out)

    print(f"\nWrote {len(rows_out)} binding rows -> {BINDING_CSV.relative_to(REPO_ROOT)}")
    print(f"Raw points -> {CURVES_DIR.relative_to(REPO_ROOT)}/<pair_id>.csv")


if __name__ == "__main__":
    main()
