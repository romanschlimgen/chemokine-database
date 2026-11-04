// Renders a BRET saturation-binding chart: the real (concentration, BRET)
// data points from data/raw_binding/ (via build_db.py -> binding_curve_points)
// plus the fitted three-parameter logistic curve (Hill slope fixed at 1)
// from scripts/analyze_binding.py, on a log concentration axis. If there's
// no fit (e.g. no detectable binding), just the points are drawn.
//   Y = bottom + (top - bottom) / (1 + 10^(logEC50 - X)), X = log10(concM)
//
// Styled to match the manuscript's own binding-curve panels: bare log10
// exponents on the x-axis (no unit-converted tick labels), a colored label
// on the curve itself rather than a boxed legend, and open axes.
const CURVE_COLOR = "#0f5fa6";

function logistic3pl(concM, bottom, top, ec50Nm) {
  const logx = Math.log10(concM);
  const logec50 = Math.log10(ec50Nm * 1e-9);
  return bottom + (top - bottom) / (1 + Math.pow(10, logec50 - logx));
}

// Pulls the exact raw-data column header (e.g. "CXCL12-AZ568") back out of
// analyze_binding.py's notes text, so the axis label matches the real tracer
// used in this assay rather than a generic chemokine name.
function tracerLabel(bindingRows, fallbackName) {
  for (const r of bindingRows) {
    const m = r.notes && r.notes.match(/log\[([^\]]+)\]/);
    if (m) return m[1];
  }
  return fallbackName;
}

function renderBindingChart(svgSelector, points, fit, meta) {
  const svg = d3.select(svgSelector);
  svg.selectAll("*").remove();
  if (!points.length) return;

  const chemokineLabel = (meta && meta.chemokineLabel) || "ligand";

  const width = Math.max(svg.node().clientWidth || 480, 480);
  const height = 260;
  const margin = { top: 18, right: 24, bottom: 46, left: 50 };
  svg.attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

  const [loRaw, hiRaw] = d3.extent(points, (p) => p.conc_m);
  // Pad the plotted domain a bit beyond the tested range ("slightly longer
  // x-axis") so the end points don't sit flush against the axis — the curve
  // itself is still only drawn across the concentrations actually tested.
  const pad = 0.4;
  const lo = Math.pow(10, Math.log10(loRaw) - pad);
  const hi = Math.pow(10, Math.log10(hiRaw) + pad);
  const x = d3.scaleLog().domain([lo, hi]).range([margin.left, width - margin.right]);

  const yMax = Math.max(d3.max(points, (p) => p.bret), fit ? fit.top : 0) * 1.1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - margin.bottom, margin.top]);

  const tickExpLo = Math.ceil(Math.log10(lo));
  const tickExpHi = Math.floor(Math.log10(hi));
  const tickValues = d3.range(tickExpLo, tickExpHi + 1).map((e) => Math.pow(10, e));

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickValues).tickFormat((d) => Math.round(Math.log10(d))).tickSizeOuter(0))
    .selectAll("text")
    .attr("font-size", 11);

  svg
    .append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", "var(--text-dim)")
    .text(`log[${chemokineLabel}], M`);

  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));

  svg
    .append("text")
    .attr("x", -(height - margin.top - margin.bottom) / 2 - margin.top)
    .attr("y", 14)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("font-weight", 600)
    .attr("fill", "var(--text)")
    .text("BRET Ratio");

  if (fit) {
    const steps = 80;
    const curvePoints = d3.range(steps + 1).map((i) => {
      const logc = Math.log10(loRaw) + (i / steps) * (Math.log10(hiRaw) - Math.log10(loRaw));
      const c = Math.pow(10, logc);
      return [c, logistic3pl(c, fit.bottom, fit.top, fit.kd_nm)];
    });
    const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
    svg
      .append("path")
      .datum(curvePoints)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", CURVE_COLOR)
      .attr("stroke-width", 2.5);

    // Direct on-chart label near the curve's plateau, in the curve's own
    // color, in place of a separate legend box.
    const labelX = curvePoints[curvePoints.length - 1][0];
    svg
      .append("text")
      .attr("x", x(labelX))
      .attr("y", y(fit.top) - 8)
      .attr("text-anchor", "end")
      .attr("font-size", 12)
      .attr("font-weight", 600)
      .attr("fill", CURVE_COLOR)
      .text(chemokineLabel);
  }

  svg
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (p) => x(p.conc_m))
    .attr("cy", (p) => y(p.bret))
    .attr("r", 4)
    .attr("fill", fit ? "#ffffff" : CURVE_COLOR)
    .attr("stroke", CURVE_COLOR)
    .attr("stroke-width", 1.5)
    .append("title")
    .text((p) => `${p.conc_m.toExponential(1)} M — BRET ${p.bret}`);
}
