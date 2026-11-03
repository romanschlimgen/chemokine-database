import { createStructureViewer } from "./molstar-viewer.js";

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function fmtNum(v, unit) {
  if (v === null || v === undefined || v === "") {
    return '<span class="pending">pending</span>';
  }
  return `${v} ${unit}`;
}

(async function main() {
  const content = document.getElementById("content");
  const pairId = new URLSearchParams(location.search).get("pair");
  if (!pairId) {
    content.innerHTML = '<div class="loading">No pair specified.</div>';
    return;
  }

  let db;
  try {
    db = await loadDB();
  } catch (err) {
    content.innerHTML = `<div class="loading">Could not load the database: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const pair = queryOne(
    db,
    `SELECT p.*, r.name AS receptor_name, r.family, r.gene_name, r.uniprot_id AS receptor_uniprot,
            c.name AS chemokine_name, c.systematic_name, c.class AS chemokine_class, c.uniprot_id AS chemokine_uniprot
     FROM pairs p
     JOIN receptors r ON p.receptor_id = r.receptor_id
     JOIN chemokines c ON p.chemokine_id = c.chemokine_id
     WHERE p.pair_id = ?`,
    [pairId]
  );

  if (!pair) {
    content.innerHTML = '<div class="loading">Pair not found.</div>';
    return;
  }

  const binding = queryAll(db, "SELECT * FROM binding WHERE pair_id = ?", [pairId]);
  const contacts = queryAll(db, "SELECT * FROM contacts WHERE pair_id = ?", [pairId]);

  content.innerHTML = `
    <h2 class="pair-title">${escapeHtml(pair.receptor_name)} &ndash; ${escapeHtml(pair.chemokine_name)}</h2>
    <div class="pair-meta">
      <span><strong>Pair type:</strong> ${escapeHtml(pair.pair_type || "—")}</span>
      <span><strong>Model confidence:</strong> ${pair.model_confidence !== null && pair.model_confidence !== undefined ? pair.model_confidence : '<span class="pending">pending</span>'}</span>
      <span><strong>Receptor:</strong> ${escapeHtml(pair.family || "")} ${pair.receptor_uniprot ? `(UniProt ${escapeHtml(pair.receptor_uniprot)})` : ""}</span>
      <span><strong>Chemokine class:</strong> ${escapeHtml(pair.chemokine_class || "")} ${pair.chemokine_uniprot ? `(UniProt ${escapeHtml(pair.chemokine_uniprot)})` : ""}</span>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2>Structure model</h2>
        <div id="viewport"></div>
        <div class="note">
          ${escapeHtml(pair.receptor_name)} = chain ${escapeHtml(pair.receptor_chain)},
          ${escapeHtml(pair.chemokine_name)} = chain ${escapeHtml(pair.chemokine_chain)}.
          Hover the contact diagram below to highlight residues here.
        </div>
      </div>

      <div class="panel">
        <h2>Binding / pharmacology</h2>
        ${renderBinding(binding)}
      </div>
    </div>

    <div class="panel">
      <h2>Inter-chain contacts (&le; 4 &#8491;, computed from the model coordinates)</h2>
      <svg id="contactSvg" width="100%"></svg>
      ${pair.notes ? `<div class="note">${escapeHtml(pair.notes)}</div>` : ""}
    </div>
  `;

  // Structure viewer (Mol*)
  const structureViewer = createStructureViewer("viewport", `data/structures/${pair.structure_file}`).catch(
    (err) => {
      document.getElementById("viewport").innerHTML =
        `<div class="loading">Could not load the structure viewer: ${escapeHtml(err.message)}</div>`;
      return null;
    }
  );

  renderContactDiagram(
    "#contactSvg",
    contacts,
    {
      receptor: pair.receptor_name,
      chemokine: pair.chemokine_name,
      receptorChain: pair.receptor_chain,
      chemokineChain: pair.chemokine_chain,
    },
    {
      onHover: async (residues) => {
        const sv = await structureViewer;
        if (sv) sv.highlightResidues(residues);
      },
      onLeave: async () => {
        const sv = await structureViewer;
        if (sv) sv.clearHighlight();
      },
    }
  );

  function renderBinding(rows) {
    if (!rows.length) {
      return '<p class="pending">No binding data yet.</p>';
    }
    const numeric = rows.filter((r) => r.kd_nm !== null || r.ic50_nm !== null);
    const parts = [];
    if (numeric.length) {
      parts.push(
        numeric
          .map(
            (r) => `
          <p>
            <strong>${escapeHtml(r.assay_type || "Assay")}:</strong>
            K<sub>d</sub> ${fmtNum(r.kd_nm, "nM")}, IC<sub>50</sub> ${fmtNum(r.ic50_nm, "nM")}
            ${r.n_replicates ? `(n=${r.n_replicates})` : ""}
            ${r.analysis_method ? `<br><span class="note">Analysis: ${escapeHtml(r.analysis_method)}</span>` : ""}
          </p>`
          )
          .join("")
      );
    } else {
      parts.push('<p class="pending">Numeric values pending reanalysis.</p>');
    }
    const legacy = rows.find((r) => r.legacy_figure);
    if (legacy) {
      parts.push(`
        <img class="legacy-figure" src="data/legacy_figures/${encodeURIComponent(legacy.legacy_figure)}" alt="Legacy binding figure" />
        <p class="note">Legacy figure from the original site (not yet digitized into numeric values).</p>
      `);
    }
    return parts.join("");
  }
})();
