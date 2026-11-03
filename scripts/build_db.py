#!/usr/bin/env python3
"""Builds site/data/ckr.sqlite (and copies structures/figures) from the CSVs in data/.

Run from the repo root:
    python3 scripts/build_db.py

See data/README.md for the expected input format.
"""
import csv
import shutil
import sqlite3
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
SITE_DATA_DIR = REPO_ROOT / "site" / "data"
CONTACT_CUTOFF_ANGSTROM = 4.0


def read_csv(path):
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def parse_pdb_atoms(pdb_path, chain_id):
    """Returns dict: resnum -> {"resname": str, "coords": list of (x, y, z)}"""
    residues = {}
    with open(pdb_path, encoding="utf-8") as f:
        for line in f:
            if not line.startswith(("ATOM", "HETATM")):
                continue
            if line[21] != chain_id:
                continue
            resname = line[17:20].strip()
            resnum = int(line[22:26])
            x, y, z = (
                float(line[30:38]),
                float(line[38:46]),
                float(line[46:54]),
            )
            entry = residues.setdefault(resnum, {"resname": resname, "coords": []})
            entry["coords"].append((x, y, z))
    return residues


def compute_contacts(pdb_path, chain_a, chain_b, cutoff=CONTACT_CUTOFF_ANGSTROM):
    """Real inter-chain residue contacts from atomic coordinates (min heavy-atom
    distance <= cutoff), not placeholder data."""
    res_a = parse_pdb_atoms(pdb_path, chain_a)
    res_b = parse_pdb_atoms(pdb_path, chain_b)
    contacts = []
    for resnum_a, info_a in res_a.items():
        coords_a = np.array(info_a["coords"])
        for resnum_b, info_b in res_b.items():
            coords_b = np.array(info_b["coords"])
            dists = np.linalg.norm(coords_a[:, None, :] - coords_b[None, :, :], axis=-1)
            min_dist = dists.min()
            if min_dist <= cutoff:
                contacts.append(
                    {
                        "receptor_resnum": resnum_a,
                        "receptor_resname": info_a["resname"],
                        "chemokine_resnum": resnum_b,
                        "chemokine_resname": info_b["resname"],
                        "distance_angstrom": round(float(min_dist), 2),
                    }
                )
    return contacts


def main():
    SITE_DATA_DIR.mkdir(parents=True, exist_ok=True)
    (SITE_DATA_DIR / "structures").mkdir(exist_ok=True)
    (SITE_DATA_DIR / "legacy_figures").mkdir(exist_ok=True)

    db_path = SITE_DATA_DIR / "ckr.sqlite"
    if db_path.exists():
        db_path.unlink()
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute(
        """CREATE TABLE receptors (
            receptor_id TEXT PRIMARY KEY, name TEXT, gene_name TEXT,
            family TEXT, uniprot_id TEXT, notes TEXT)"""
    )
    cur.execute(
        """CREATE TABLE chemokines (
            chemokine_id TEXT PRIMARY KEY, name TEXT, systematic_name TEXT,
            class TEXT, uniprot_id TEXT, notes TEXT)"""
    )
    cur.execute(
        """CREATE TABLE pairs (
            pair_id TEXT PRIMARY KEY, receptor_id TEXT, chemokine_id TEXT,
            pair_type TEXT, model_confidence REAL, structure_file TEXT,
            receptor_chain TEXT, chemokine_chain TEXT, notes TEXT)"""
    )
    cur.execute(
        """CREATE TABLE binding (
            binding_id TEXT PRIMARY KEY, pair_id TEXT, assay_type TEXT,
            kd_nm REAL, ic50_nm REAL, n_replicates INTEGER,
            analysis_method TEXT, raw_data_file TEXT, legacy_figure TEXT, notes TEXT)"""
    )
    cur.execute(
        """CREATE TABLE contacts (
            pair_id TEXT, receptor_resnum INTEGER, receptor_resname TEXT,
            chemokine_resnum INTEGER, chemokine_resname TEXT, distance_angstrom REAL)"""
    )

    receptors = read_csv(DATA_DIR / "receptors.csv")
    cur.executemany(
        "INSERT INTO receptors VALUES (:receptor_id,:name,:gene_name,:family,:uniprot_id,:notes)",
        receptors,
    )

    chemokines = read_csv(DATA_DIR / "chemokines.csv")
    cur.executemany(
        "INSERT INTO chemokines VALUES (:chemokine_id,:name,:systematic_name,:class,:uniprot_id,:notes)",
        chemokines,
    )

    pairs = read_csv(DATA_DIR / "pairs.csv")
    cur.executemany(
        """INSERT INTO pairs VALUES (:pair_id,:receptor_id,:chemokine_id,:pair_type,
           :model_confidence,:structure_file,:receptor_chain,:chemokine_chain,:notes)""",
        [{**p, "model_confidence": p["model_confidence"] or None} for p in pairs],
    )

    binding_csv = DATA_DIR / "binding.csv"
    if binding_csv.exists():
        binding = read_csv(binding_csv)
        cur.executemany(
            """INSERT INTO binding VALUES (:binding_id,:pair_id,:assay_type,:kd_nm,
               :ic50_nm,:n_replicates,:analysis_method,:raw_data_file,:legacy_figure,:notes)""",
            [
                {
                    **b,
                    "kd_nm": b["kd_nm"] or None,
                    "ic50_nm": b["ic50_nm"] or None,
                    "n_replicates": b["n_replicates"] or None,
                }
                for b in binding
            ],
        )

    # structures + contacts (real contacts computed from coordinates unless overridden)
    for p in pairs:
        src = DATA_DIR / "structures" / p["structure_file"]
        if not src.exists():
            print(f"  WARNING: structure file missing for {p['pair_id']}: {src}")
            continue
        shutil.copy(src, SITE_DATA_DIR / "structures" / p["structure_file"])

        override = DATA_DIR / "contacts" / f"{p['pair_id']}.csv"
        if override.exists():
            contacts = read_csv(override)
            print(f"  {p['pair_id']}: using provided contact override ({len(contacts)} rows)")
        else:
            contacts = compute_contacts(src, p["receptor_chain"], p["chemokine_chain"])
            print(f"  {p['pair_id']}: computed {len(contacts)} real contacts from structure")
        cur.executemany(
            """INSERT INTO contacts VALUES (:pair_id,:receptor_resnum,:receptor_resname,
               :chemokine_resnum,:chemokine_resname,:distance_angstrom)""",
            [{**c, "pair_id": p["pair_id"]} for c in contacts],
        )

    legacy_dir = DATA_DIR / "legacy_figures"
    if legacy_dir.exists():
        for fig in legacy_dir.iterdir():
            if fig.is_file():
                shutil.copy(fig, SITE_DATA_DIR / "legacy_figures" / fig.name)

    conn.commit()
    conn.close()
    print(f"Built {db_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
