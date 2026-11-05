function fmtNum(v, unit) {
  if (v === null || v === undefined || v === "") {
    return '<span class="pending">pending</span>';
  }
  return `${v} ${unit}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderTable(rows) {
  const container = document.getElementById("tableContainer");
  if (!rows.length) {
    container.innerHTML = '<div class="loading">No pairs match this filter.</div>';
    return;
  }
  const body = rows
    .map(
      (r) => `
    <tr>
      <td><a class="pair-link" href="pair.html?pair=${encodeURIComponent(r.pair_id)}">${escapeHtml(r.receptor_name)}</a></td>
      <td>${escapeHtml(r.chemokine_name)}</td>
      <td>${escapeHtml(r.pair_type || "")}</td>
      <td>${r.model_confidence !== null && r.model_confidence !== undefined ? r.model_confidence : '<span class="pending">pending</span>'}</td>
      <td>${fmtNum(r.kd_nm, "nM")}</td>
      <td>${fmtNum(r.ic50_nm, "nM")}</td>
    </tr>`
    )
    .join("");
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Receptor</th>
          <th>Chemokine</th>
          <th>Pair type</th>
          <th>Model confidence</th>
          <th>K<sub>d</sub></th>
          <th>IC<sub>50</sub></th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

(async function main() {
  let db;
  try {
    db = await loadDB();
  } catch (err) {
    document.getElementById("tableContainer").innerHTML =
      `<div class="loading">Could not load the database: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const allRows = queryAll(
    db,
    `SELECT p.pair_id, r.name AS receptor_name, c.name AS chemokine_name,
            p.pair_type, p.model_confidence, b.kd_nm, b.ic50_nm
     FROM pairs p
     JOIN receptors r ON p.receptor_id = r.receptor_id
     JOIN chemokines c ON p.chemokine_id = c.chemokine_id
     LEFT JOIN binding b ON b.pair_id = p.pair_id
     ORDER BY r.name, c.name`
  );

  // Arriving from the navbar's search box or a Receptor/Chemokine dropdown
  // link (index.html?q=...) pre-fills the on-page search with that term.
  const initialQuery = new URLSearchParams(location.search).get("q");
  if (initialQuery) document.getElementById("search").value = initialQuery;

  const pairTypeFilter = document.getElementById("pairTypeFilter");
  const types = [...new Set(allRows.map((r) => r.pair_type).filter(Boolean))].sort();
  for (const t of types) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    pairTypeFilter.appendChild(opt);
  }

  function applyFilters() {
    const q = document.getElementById("search").value.trim().toLowerCase();
    const type = pairTypeFilter.value;
    const filtered = allRows.filter((r) => {
      const matchesQuery =
        !q ||
        r.receptor_name.toLowerCase().includes(q) ||
        r.chemokine_name.toLowerCase().includes(q);
      const matchesType = !type || r.pair_type === type;
      return matchesQuery && matchesType;
    });
    renderTable(filtered);
  }

  document.getElementById("search").addEventListener("input", applyFilters);
  pairTypeFilter.addEventListener("change", applyFilters);
  applyFilters();
})();
