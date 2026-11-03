// Renders a two-column "bipartite" contact diagram from real inter-chain
// residue contacts (computed from structure coordinates in build_db.py — not
// placeholder data). Each curve is an actual contact; curve opacity scales
// with how close the contact is. Hovering an edge or a residue node calls
// options.onHover(residues) / options.onLeave() so the caller can mirror the
// highlight onto the 3D structure viewer.
function renderContactDiagram(svgSelector, contacts, labels, options) {
  const { receptor: receptorLabel, chemokine: chemokineLabel, receptorChain, chemokineChain } = labels;
  const onHover = (options && options.onHover) || (() => {});
  const onLeave = (options && options.onLeave) || (() => {});

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

  const yFor = (list) => d3.scalePoint().domain(list).range([margin.top, height - margin.bottom]);
  const yLeft = yFor(receptorResidues);
  const yRight = yFor(chemokineResidues);

  const resnameByReceptor = new Map(contacts.map((c) => [c.receptor_resnum, c.receptor_resname]));
  const resnameByChemokine = new Map(contacts.map((c) => [c.chemokine_resnum, c.chemokine_resname]));

  const maxDist = d3.max(contacts, (c) => c.distance_angstrom);
  const minDist = d3.min(contacts, (c) => c.distance_angstrom);
  const baseOpacity = d3.scaleLinear().domain([minDist, maxDist]).range([0.85, 0.15]).clamp(true);

  const color = "#1d4e89";
  const DIM_OPACITY = 0.06;

  const link = d3.linkHorizontal().x((d) => d.x).y((d) => d.y);

  const contactPaths = svg
    .selectAll("path.contact")
    .data(contacts)
    .join("path")
    .attr("class", "contact")
    .attr("data-receptor", (c) => c.receptor_resnum)
    .attr("data-chemokine", (c) => c.chemokine_resnum)
    .attr("d", (c) =>
      link({
        source: { x: xLeft + 6, y: yLeft(c.receptor_resnum) },
        target: { x: xRight - 6, y: yRight(c.chemokine_resnum) },
      })
    )
    .attr("fill", "none")
    .attr("stroke", color)
    .attr("stroke-width", 1.2)
    .attr("stroke-opacity", (c) => baseOpacity(c.distance_angstrom))
    .style("cursor", "pointer");

  contactPaths
    .append("title")
    .text((c) => `${receptorLabel} ${c.receptor_resname}${c.receptor_resnum} — ${chemokineLabel} ${c.chemokine_resname}${c.chemokine_resnum} (${c.distance_angstrom} Å)`);

  function resetEmphasis() {
    contactPaths.attr("stroke-width", 1.2).attr("stroke-opacity", (c) => baseOpacity(c.distance_angstrom));
    svg.selectAll("circle.left,circle.right").attr("opacity", 1);
  }

  function emphasizeContacts(matching) {
    const matchSet = new Set(matching);
    contactPaths
      .attr("stroke-width", (c) => (matchSet.has(c) ? 2.5 : 1.2))
      .attr("stroke-opacity", (c) => (matchSet.has(c) ? 0.95 : DIM_OPACITY));
  }

  function residuesForContacts(matching) {
    const residues = [];
    const seen = new Set();
    for (const c of matching) {
      const rKey = `R${c.receptor_resnum}`;
      const cKey = `C${c.chemokine_resnum}`;
      if (!seen.has(rKey)) {
        seen.add(rKey);
        residues.push({ chain: receptorChain, resnum: c.receptor_resnum });
      }
      if (!seen.has(cKey)) {
        seen.add(cKey);
        residues.push({ chain: chemokineChain, resnum: c.chemokine_resnum });
      }
    }
    return residues;
  }

  contactPaths
    .on("mouseenter", function (event, c) {
      emphasizeContacts([c]);
      onHover(residuesForContacts([c]));
    })
    .on("mouseleave", function () {
      resetEmphasis();
      onLeave();
    });

  function addNodes(className, residues, x, resnameMap, anchor, labelDx, side) {
    const circles = svg
      .selectAll(`circle.${className}`)
      .data(residues)
      .join("circle")
      .attr("class", className)
      .attr("cx", x)
      .attr("cy", (d) => (side === "left" ? yLeft(d) : yRight(d)))
      .attr("r", 3)
      .attr("fill", side === "left" ? "#1d4e89" : "#7fb3e0")
      .style("cursor", "pointer");

    circles
      .on("mouseenter", function (event, resnum) {
        const matching = contacts.filter((c) =>
          side === "left" ? c.receptor_resnum === resnum : c.chemokine_resnum === resnum
        );
        emphasizeContacts(matching);
        onHover(residuesForContacts(matching));
      })
      .on("mouseleave", function () {
        resetEmphasis();
        onLeave();
      });

    svg
      .selectAll(`text.${className}-label`)
      .data(residues)
      .join("text")
      .attr("class", `${className}-label`)
      .attr("x", x + labelDx)
      .attr("y", (d) => (side === "left" ? yLeft(d) : yRight(d)) + 3)
      .attr("text-anchor", anchor)
      .attr("font-size", 10)
      .attr("fill", "var(--text-dim)")
      .text((d) => `${resnameMap.get(d)}${d}`);
  }

  addNodes("left", receptorResidues, xLeft, resnameByReceptor, "end", -10, "left");
  addNodes("right", chemokineResidues, xRight, resnameByChemokine, "start", 10, "right");

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
