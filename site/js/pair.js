import { createStructureViewer } from "./molstar-viewer.js";

// Matches site/assets/chemokinedb.png (the logo): grey blob = receptor, blue
// blob = chemokine. Sampled directly from the image's dominant pixel colors.
const RECEPTOR_RGB = [147, 149, 152];
const CHEMOKINE_RGB = [15, 117, 188];

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
  const bindingCurvePoints = queryAll(
    db,
    "SELECT conc_m, bret FROM binding_curve_points WHERE pair_id = ? ORDER BY conc_m",
    [pairId]
  );
  const hasStructure = !!pair.structure_file;
  const contacts = hasStructure ? queryAll(db, "SELECT * FROM contacts WHERE pair_id = ?", [pairId]) : [];
  const receptorResidues = hasStructure
    ? queryAll(db, "SELECT resnum, resname FROM residues WHERE pair_id = ? AND chain_role = 'receptor' ORDER BY resnum", [pairId])
    : [];
  const chemokineResidues = hasStructure
    ? queryAll(db, "SELECT resnum, resname FROM residues WHERE pair_id = ? AND chain_role = 'chemokine' ORDER BY resnum", [pairId])
    : [];

  content.innerHTML = `
    <h2 class="pair-title">${escapeHtml(pair.receptor_name)} &ndash; ${escapeHtml(pair.chemokine_name)}</h2>
    <div class="pair-meta">
      <span><strong>Pair type:</strong> ${escapeHtml(pair.pair_type || "—")}</span>
      <span><strong>Model confidence:</strong> ${pair.model_confidence !== null && pair.model_confidence !== undefined ? pair.model_confidence : '<span class="pending">pending</span>'}</span>
      <span><strong>Receptor:</strong> ${escapeHtml(pair.family || "")} ${pair.receptor_uniprot ? `(UniProt ${escapeHtml(pair.receptor_uniprot)})` : ""}</span>
      <span><strong>Chemokine class:</strong> ${escapeHtml(pair.chemokine_class || "")} ${pair.chemokine_uniprot ? `(UniProt ${escapeHtml(pair.chemokine_uniprot)})` : ""}</span>
    </div>

    ${
      hasStructure
        ? `
    <div class="grid-2">
      <div class="panel">
        <h2>Structure model</h2>
        <div id="viewport"></div>
        <div class="note">
          ${escapeHtml(pair.receptor_name)} = chain ${escapeHtml(pair.receptor_chain)},
          ${escapeHtml(pair.chemokine_name)} = chain ${escapeHtml(pair.chemokine_chain)}.
          Hover the contact diagram to highlight residues here; click a contact or residue
          to show its side chains (click again, or empty space, to clear).
        </div>
      </div>

      <div class="panel">
        <h2>Inter-chain contacts (&le; 4 &#8491;, computed from the model coordinates)</h2>
        <svg id="contactSvg" width="100%"></svg>
      </div>
    </div>

    <div class="download-row">
      <a class="btn-download" href="data/structures/${encodeURIComponent(pair.structure_file)}" download="${escapeHtml(pair.structure_file)}">
        &#8681; Download structure (${escapeHtml(pair.structure_file.split(".").pop().toUpperCase())})
      </a>
    </div>
    `
        : `
    <div class="panel">
      <h2>Structure model</h2>
      <p class="pending">No structural model for this pair yet.</p>
    </div>
    `
    }

    <div class="panel">
      <h2>Binding / pharmacology</h2>
      ${renderBinding(binding, bindingCurvePoints)}
      ${pair.notes ? `<div class="note">${escapeHtml(pair.notes)}</div>` : ""}
    </div>
  `;

  if (bindingCurvePoints.length) {
    const fitRow = binding.find((r) => r.fit_top !== null && r.fit_top !== undefined);
    const fit = fitRow
      ? { bottom: fitRow.fit_bottom, top: fitRow.fit_top, hill: fitRow.fit_hill, kd_nm: fitRow.kd_nm }
      : null;
    renderBindingChart("#bindingChart", bindingCurvePoints, fit);
  }

  // Structure viewer (Mol*), colored to match the receptor/chemokine logo —
  // only when there's actually a model for this pair.
  const structureViewer = hasStructure
    ? createStructureViewer("viewport", `data/structures/${pair.structure_file}`, [
        { chain: pair.receptor_chain, rgb: RECEPTOR_RGB },
        { chain: pair.chemokine_chain, rgb: CHEMOKINE_RGB },
      ]).catch((err) => {
        document.getElementById("viewport").innerHTML =
          `<div class="loading">Could not load the structure viewer: ${escapeHtml(err.message)}</div>`;
        return null;
      })
    : Promise.resolve(null);

  if (hasStructure) renderContactDiagram(
    "#contactSvg",
    { receptorResidues, chemokineResidues, contacts },
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
      onClick: async (residues) => {
        const sv = await structureViewer;
        if (sv) sv.showSideChains(residues);
      },
      onClickClear: async () => {
        const sv = await structureViewer;
        if (sv) sv.clearSideChains();
      },
    }
  );

  growStructurePanelToMatchContacts();

  // The circular diagram is already cropped tightly to its own content, but
  // its panel can still end up a bit taller than the structure panel next
  // to it (different header/content shapes). Grow the Mol* viewport to make
  // up the difference rather than cropping the diagram further — the
  // diagram's own margins are already tight against its label content, so
  // trimming more risks clipping the outer ring itself.
  function growStructurePanelToMatchContacts() {
    const panels = document.querySelectorAll(".grid-2 .panel");
    const viewportEl = document.getElementById("viewport");
    if (panels.length < 2 || !viewportEl) return;
    const structureHeight = panels[0].getBoundingClientRect().height;
    const contactsHeight = panels[1].getBoundingClientRect().height;
    const extra = contactsHeight - structureHeight;
    if (extra <= 0) return;
    const currentViewportHeight = viewportEl.getBoundingClientRect().height;
    viewportEl.style.height = `${currentViewportHeight + extra}px`;
  }

  function renderBinding(rows, curvePoints) {
    if (!rows.length) {
      return '<p class="pending">No binding data yet.</p>';
    }
    const numeric = rows.filter((r) => r.kd_nm !== null || r.ic50_nm !== null);
    const parts = [];

    if (curvePoints.length) {
      parts.push('<svg id="bindingChart" width="100%"></svg>');
    }

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
            ${r.notes ? `<br><span class="note">${escapeHtml(r.notes)}</span>` : ""}
          </p>`
          )
          .join("")
      );
    } else {
      parts.push(
        rows
          .map(
            (r) => `<p class="pending">${r.notes ? escapeHtml(r.notes) : "Numeric values pending reanalysis."}</p>`
          )
          .join("")
      );
    }
    const legacy = rows.find((r) => r.legacy_figure);
    if (legacy) {
      parts.push(`
        <img class="legacy-figure" src="data/legacy_figures/${encodeURIComponent(legacy.legacy_figure)}" alt="Legacy binding figure" />
        <p class="note">Legacy figure from the original site, kept for reference${curvePoints.length ? " (superseded by the chart above, fit from the same underlying data)" : ""}.</p>
      `);
    }
    return parts.join("");
  }
})();
