// Renders a two-column "bipartite" contact diagram from real inter-chain
// residue contacts (computed from structure coordinates in build_db.py — not
// placeholder data). Each curve is an actual contact; curve opacity scales
// with how close the contact is.
function renderContactDiagram(svgSelector, contacts, labels) {
  const receptorLabel = labels.receptor;
  const chemokineLabel = labels.chemokine;

  const svg = d3.select(svgSelector);
  svg.selectAll("*").remove();

  if (!contacts.length) {
    svg
      .append("text")
      .attr("x", 20)
      .attr("y", 24)
      .attr("fill", "var(--text-dim)")
      .text("No contacts within cutoff for this pair.");
    return;
  }

  const width = svg.node().clientWidth || 600;
  const rowHeight = 16;
  const margin = { top: 30, bottom: 20 };

  const receptorResidues = [...new Set(contacts.map((c) => c.receptor_resnum))].sort((a, b) => a - b);
  const chemokineResidues = [...new Set(contacts.map((c) => c.chemokine_resnum))].sort((a, b) => a - b);
  const maxRows = Math.max(receptorResidues.length, chemokineResidues.length);
  const height = margin.top + margin.bottom + maxRows * rowHeight;
  svg.attr("height", height);

  const xLeft = 110;
  const xRight = width - 110;

  const yFor = (list) => {
    const scale = d3.scalePoint().domain(list).range([margin.top, height - margin.bottom]);
    return scale;
  };
  const yLeft = yFor(receptorResidues);
  const yRight = yFor(chemokineResidues);

  const resnameByReceptor = new Map(contacts.map((c) => [c.receptor_resnum, c.receptor_resname]));
  const resnameByChemokine = new Map(contacts.map((c) => [c.chemokine_resnum, c.chemokine_resname]));

  const maxDist = d3.max(contacts, (c) => c.distance_angstrom);
  const minDist = d3.min(contacts, (c) => c.distance_angstrom);
  const opacity = d3
    .scaleLinear()
    .domain([minDist, maxDist])
    .range([0.85, 0.15])
    .clamp(true);

  const color = "#1d4e89";

  const link = d3
    .linkHorizontal()
    .x((d) => d.x)
    .y((d) => d.y);

  svg
    .selectAll("path.contact")
    .data(contacts)
    .join("path")
    .attr("class", "contact")
    .attr("d", (c) =>
      link({
        source: { x: xLeft + 6, y: yLeft(c.receptor_resnum) },
        target: { x: xRight - 6, y: yRight(c.chemokine_resnum) },
      })
    )
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", 1.2)
    .attr("stroke-opacity", (c) => opacity(c.distance_angstrom))
    .append("title")
    .text((c) => `${receptorLabel} ${c.receptor_resname}${c.receptor_resnum} — ${chemokineLabel} ${c.chemokine_resname}${c.chemokine_resnum} (${c.distance_angstrom} Å)`);

  svg
    .selectAll("circle.left")
    .data(receptorResidues)
    .join("circle")
    .attr("class", "left")
    .attr("cx", xLeft)
    .attr("cy", (d) => yLeft(d))
    .attr("r", 3)
    .attr("fill", "#1d4e89");

  svg
    .selectAll("text.left-label")
    .data(receptorResidues)
    .join("text")
    .attr("class", "left-label")
    .attr("x", xLeft - 10)
    .attr("y", (d) => yLeft(d) + 3)
    .attr("text-anchor", "end")
    .attr("font-size", 10)
    .attr("fill", "var(--text-dim)")
    .text((d) => `${resnameByReceptor.get(d)}${d}`);

  svg
    .selectAll("circle.right")
    .data(chemokineResidues)
    .join("circle")
    .attr("class", "right")
    .attr("cx", xRight)
    .attr("cy", (d) => yRight(d))
    .attr("r", 3)
    .attr("fill", "#7fb3e0");

  svg
    .selectAll("text.right-label")
    .data(chemokineResidues)
    .join("text")
    .attr("class", "right-label")
    .attr("x", xRight + 10)
    .attr("y", (d) => yRight(d) + 3)
    .attr("text-anchor", "start")
    .attr("font-size", 10)
    .attr("fill", "var(--text-dim)")
    .text((d) => `${resnameByChemokine.get(d)}${d}`);

  svg
    .append("text")
    .attr("x", xLeft)
    .attr("y", margin.top - 14)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("font-weight", 600)
    .attr("fill", "#1d4e89")
    .text(receptorLabel);

  svg
    .append("text")
    .attr("x", xRight)
    .attr("y", margin.top - 14)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .attr("font-weight", 600)
    .attr("fill", "#3a6d9e")
    .text(chemokineLabel);
}
