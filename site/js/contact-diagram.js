// Renders a circular contact diagram: every residue of both chains gets a
// position around the circle (grouped into a receptor arc and a chemokine
// arc, sized proportionally to each chain's length), and real inter-chain
// contacts (computed from structure coordinates in build_db.py, not
// placeholder data) are drawn as curves through the center. Residue labels
// are hidden by default and only shown for whatever's under the cursor, to
// keep a ~350-residue chain readable; every residue still gets a tick mark
// and is hoverable. Hovering an edge or a residue calls
// options.onHover(residues) / options.onLeave() so the caller can mirror the
// highlight onto the 3D structure viewer.
function renderContactDiagram(svgSelector, data, labels, options) {
  const { receptorResidues, chemokineResidues, contacts } = data;
  const { receptor: receptorLabel, chemokine: chemokineLabel, receptorChain, chemokineChain } = labels;
  const onHover = (options && options.onHover) || (() => {});
  const onLeave = (options && options.onLeave) || (() => {});

  const svg = d3.select(svgSelector);
  svg.selectAll("*").remove();

  if (!receptorResidues.length || !chemokineResidues.length) {
    svg.append("text").attr("x", 20).attr("y", 24).attr("fill", "var(--text-dim)").text("No structure data for this pair.");
    return;
  }

  const size = Math.max(svg.node().clientWidth || 600, 500);
  const height = size;
  svg.attr("height", height).attr("viewBox", `0 0 ${size} ${height}`);

  const cx = size / 2;
  const cy = height / 2;
  const outerRadius = Math.min(size, height) / 2 - 70;
  const tickRadius = outerRadius;
  const bandInner = tickRadius + 5;
  const bandOuter = tickRadius + 12;
  const labelRadius = bandOuter + 8;

  const GAP_DEG = 6;
  const total = receptorResidues.length + chemokineResidues.length;
  const receptorSpan = (360 - 2 * GAP_DEG) * (receptorResidues.length / total);
  const chemokineSpan = (360 - 2 * GAP_DEG) * (chemokineResidues.length / total);

  // receptor arc starts at the top (-90deg) and runs clockwise; chemokine
  // arc follows after the first gap.
  const receptorStart = -90;
  const receptorEnd = receptorStart + receptorSpan;
  const chemokineStart = receptorEnd + GAP_DEG;
  const chemokineEnd = chemokineStart + chemokineSpan;

  function angleScaleFor(residues, startDeg, endDeg) {
    const scale = d3.scalePoint().domain(residues.map((r) => r.resnum)).range([startDeg, endDeg]);
    return (resnum) => scale(resnum);
  }

  const receptorAngle = angleScaleFor(receptorResidues, receptorStart, receptorEnd);
  const chemokineAngle = angleScaleFor(chemokineResidues, chemokineStart, chemokineEnd);

  function pointFor(angleDeg, radius) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }

  const receptorResnameByNum = new Map(receptorResidues.map((r) => [r.resnum, r.resname]));
  const chemokineResnameByNum = new Map(chemokineResidues.map((r) => [r.resnum, r.resname]));
  const receptorHasContact = new Set(contacts.map((c) => c.receptor_resnum));
  const chemokineHasContact = new Set(contacts.map((c) => c.chemokine_resnum));

  const maxDist = d3.max(contacts, (c) => c.distance_angstrom) || 1;
  const minDist = d3.min(contacts, (c) => c.distance_angstrom) || 0;
  const baseOpacity = d3.scaleLinear().domain([minDist, maxDist]).range([0.8, 0.12]).clamp(true);
  const DIM_OPACITY = 0.04;
  const edgeColor = "#1d4e89";
  const BASE_STROKE = 1.6;
  const EMPHASIS_STROKE = 3.2;

  const root = svg.append("g");

  // Thick group-arc outlines, one per chain, sitting just outside the
  // residue dots so they read as a distinct ring rather than crowding them.
  const groupArc = d3.arc().innerRadius(bandInner).outerRadius(bandOuter).cornerRadius(3);
  root
    .append("path")
    .attr("d", groupArc({ startAngle: (receptorStart * Math.PI) / 180, endAngle: (receptorEnd * Math.PI) / 180 }))
    .attr("transform", `translate(${cx},${cy})`)
    .attr("fill", "#1d4e89")
    .attr("opacity", 0.9);
  root
    .append("path")
    .attr("d", groupArc({ startAngle: (chemokineStart * Math.PI) / 180, endAngle: (chemokineEnd * Math.PI) / 180 }))
    .attr("transform", `translate(${cx},${cy})`)
    .attr("fill", "#7fb3e0")
    .attr("opacity", 0.9);

  // Labels: created once, hidden by default, shown only for whatever's
  // currently hovered (a residue, or the two residues of a hovered edge).
  const labelByKey = new Map();
  function keyFor(side, resnum) {
    return `${side}${resnum}`;
  }
  function showLabels(keys) {
    for (const [key, el] of labelByKey) el.attr("opacity", keys.has(key) ? 1 : 0);
  }
  function hideAllLabels() {
    for (const [, el] of labelByKey) el.attr("opacity", 0);
  }

  // Contact curves, through a control point pulled toward the center.
  const contactPaths = root
    .selectAll("path.contact")
    .data(contacts)
    .join("path")
    .attr("class", "contact")
    .attr("d", (c) => {
      const [x1, y1] = pointFor(receptorAngle(c.receptor_resnum), tickRadius);
      const [x2, y2] = pointFor(chemokineAngle(c.chemokine_resnum), tickRadius);
      return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
    })
    .attr("fill", "none")
    .attr("stroke", edgeColor)
    .attr("stroke-width", BASE_STROKE)
    .attr("stroke-opacity", (c) => baseOpacity(c.distance_angstrom))
    .style("cursor", "pointer");

  contactPaths
    .append("title")
    .text((c) => `${receptorLabel} ${c.receptor_resname}${c.receptor_resnum} — ${chemokineLabel} ${c.chemokine_resname}${c.chemokine_resnum} (${c.distance_angstrom} Å)`);

  function resetEmphasis() {
    contactPaths.attr("stroke-width", BASE_STROKE).attr("stroke-opacity", (c) => baseOpacity(c.distance_angstrom));
  }

  function emphasizeContacts(matching) {
    const matchSet = new Set(matching);
    contactPaths
      .attr("stroke-width", (c) => (matchSet.has(c) ? EMPHASIS_STROKE : BASE_STROKE))
      .attr("stroke-opacity", (c) => (matchSet.has(c) ? 0.95 : DIM_OPACITY));
  }

  function residuesForContacts(matching) {
    const residues = [];
    const seen = new Set();
    for (const c of matching) {
      const rKey = keyFor("R", c.receptor_resnum);
      const cKey = keyFor("C", c.chemokine_resnum);
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
      showLabels(new Set([keyFor("R", c.receptor_resnum), keyFor("C", c.chemokine_resnum)]));
      onHover(residuesForContacts([c]));
    })
    .on("mouseleave", function () {
      resetEmphasis();
      hideAllLabels();
      onLeave();
    });

  function addGroup(groupClass, residues, angleFn, resnameMap, hasContactSet, chain, side, dotColor) {
    const g = root.append("g").attr("class", `group-${groupClass}`);

    g.selectAll("circle")
      .data(residues)
      .join("circle")
      .attr("cx", (d) => pointFor(angleFn(d.resnum), tickRadius)[0])
      .attr("cy", (d) => pointFor(angleFn(d.resnum), tickRadius)[1])
      .attr("r", (d) => (hasContactSet.has(d.resnum) ? 2.8 : 1.4))
      .attr("fill", (d) => (hasContactSet.has(d.resnum) ? dotColor : "#c7ccd1"))
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        const matching = contacts.filter((c) =>
          chain === receptorChain ? c.receptor_resnum === d.resnum : c.chemokine_resnum === d.resnum
        );
        emphasizeContacts(matching);
        const activeKeys = new Set([keyFor(side, d.resnum)]);
        matching.forEach((c) => {
          activeKeys.add(keyFor("R", c.receptor_resnum));
          activeKeys.add(keyFor("C", c.chemokine_resnum));
        });
        showLabels(activeKeys);
        const residues_ = matching.length ? residuesForContacts(matching) : [{ chain, resnum: d.resnum }];
        onHover(residues_);
      })
      .on("mouseleave", function () {
        resetEmphasis();
        hideAllLabels();
        onLeave();
      })
      .append("title")
      .text((d) => `${resnameMap.get(d.resnum)}${d.resnum}`);

    g.selectAll("text")
      .data(residues)
      .join("text")
      .each(function (d) {
        const angleDeg = angleFn(d.resnum);
        const [x, y] = pointFor(angleDeg, labelRadius);
        const flip = angleDeg > 90 && angleDeg < 270;
        d3.select(this)
          .attr("x", x)
          .attr("y", y)
          .attr("text-anchor", flip ? "end" : "start")
          .attr("transform", `rotate(${flip ? angleDeg + 180 : angleDeg}, ${x}, ${y})`)
          .attr("font-size", 10)
          .attr("font-weight", 600)
          .attr("fill", "var(--text)")
          .attr("opacity", 0)
          .style("pointer-events", "none")
          .text(`${resnameMap.get(d.resnum)}${d.resnum}`);
        labelByKey.set(keyFor(side, d.resnum), d3.select(this));
      });
  }

  addGroup("receptor", receptorResidues, receptorAngle, receptorResnameByNum, receptorHasContact, receptorChain, "R", "#1d4e89");
  addGroup("chemokine", chemokineResidues, chemokineAngle, chemokineResnameByNum, chemokineHasContact, chemokineChain, "C", "#7fb3e0");

  // Group labels, centered over each arc.
  const receptorMid = (receptorStart + receptorEnd) / 2;
  const chemokineMid = (chemokineStart + chemokineEnd) / 2;
  const [rlx, rly] = pointFor(receptorMid, outerRadius + 32);
  const [clx, cly] = pointFor(chemokineMid, outerRadius + 32);

  root.append("text").attr("x", rlx).attr("y", rly).attr("text-anchor", "middle").attr("font-size", 13).attr("font-weight", 700).attr("fill", "#1d4e89").text(receptorLabel);
  root.append("text").attr("x", clx).attr("y", cly).attr("text-anchor", "middle").attr("font-size", 13).attr("font-weight", 700).attr("fill", "#3a6d9e").text(chemokineLabel);
}
