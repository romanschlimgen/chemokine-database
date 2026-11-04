// Renders a BRET saturation-binding chart in the manuscript's own style:
// every chemokine tested against this receptor is drawn as a thin grey
// context curve (data from data/raw_binding/ -> binding_curve_points), with
// only the chemokine on the current pair's page highlighted in blue and
// labeled. Curves are the fitted three-parameter logistic (Hill slope fixed
// at 1) from scripts/analyze_binding.py; series with no fit just show
// scatter points.
//   Y = bottom + (top - bottom) / (1 + 10^(logEC50 - X)), X = log10(concM)
const ACCENT_COLOR = "#0f5fa6";
const OTHER_COLOR = "#9aa0a8";
const CURVE_WIDTH = 5;

function logistic3pl(concM, bottom, top, ec50Nm) {
  const logx = Math.log10(concM);
  const logec50 = Math.log10(ec50Nm * 1e-9);
  return bottom + (top - bottom) / (1 + Math.pow(10, logec50 - logx));
}

// Pulls the exact raw-data column header (e.g. "CXCL12-AZ568") back out of
// analyze_binding.py's notes text, so axis/curve labels match the real
// tracer used in this assay rather than a generic chemokine name.
function tracerLabel(bindingRows, fallbackName) {
  for (const r of bindingRows) {
    const m = r.notes && r.notes.match(/log\[([^\]]+)\]/);
    if (m) return m[1];
  }
  return fallbackName;
}

function renderBindingChart(svgSelector, series) {
  const svg = d3.select(svgSelector);
  svg.selectAll("*").remove();
  const allPoints = series.flatMap((s) => s.points);
  if (!allPoints.length) return;

  const current = series.find((s) => s.isCurrent) || series[0];

  // A fixed internal coordinate system (not a fixed pixel size) — the
  // viewBox lets the SVG scale fluidly to whatever width CSS gives it
  // (site/css/style.css caps/floors that), instead of a hardcoded pixel
  // width that overflowed or looked cramped depending on the browser's
  // actual width.
  const width = 420;
  const height = 260;
  const margin = { top: 18, right: 20, bottom: 44, left: 50 };
  // Gap between the two axis lines and the plot content, matching the
  // manuscript's detached-spine style (seaborn/ggplot "offset axes").
  const axisOffset = 7;
  svg.attr("viewBox", `0 0 ${width} ${height}`);

  const [lo, hi] = d3.extent(allPoints, (p) => p.conc_m);
  const x = d3.scaleLog().domain([lo, hi]).range([margin.left, width - margin.right]);

  // Each series' curve, precomputed here (not just inferred from the fit's
  // asymptotic "top" parameter, which an extrapolated fit may never actually
  // reach within the plotted range) so the y-axis max reflects what's really
  // drawn on screen.
  const seriesCurves = series.map((s) => {
    if (!s.fit) return { series: s, curvePoints: null };
    const [sLo, sHi] = d3.extent(s.points, (p) => p.conc_m);
    const steps = 80;
    const curvePoints = d3.range(steps + 1).map((i) => {
      const logc = Math.log10(sLo) + (i / steps) * (Math.log10(sHi) - Math.log10(sLo));
      const c = Math.pow(10, logc);
      return [c, logistic3pl(c, s.fit.bottom, s.fit.top, s.fit.kd_nm)];
    });
    return { series: s, curvePoints };
  });
  const plottedMax = Math.max(
    d3.max(allPoints, (p) => p.bret),
    d3.max(seriesCurves.flatMap((sc) => (sc.curvePoints ? sc.curvePoints.map((d) => d[1]) : [])))
  );
  const yMax = plottedMax * 1.1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - margin.bottom, margin.top]);

  const tickExpLo = Math.ceil(Math.log10(lo));
  const tickExpHi = Math.floor(Math.log10(hi));
  const tickValues = d3.range(tickExpLo, tickExpHi + 1).map((e) => Math.pow(10, e));

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom + axisOffset})`)
    .call(d3.axisBottom(x).tickValues(tickValues).tickFormat((d) => Math.round(Math.log10(d))).tickSizeOuter(0))
    .selectAll("text")
    .attr("font-size", 11);

  svg
    .append("text")
    .attr("x", (margin.left + width - margin.right) / 2)
    .attr("y", height - 4)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("fill", "var(--text-dim)")
    .text(`log[${current.chemokineLabel}], M`);

  svg
    .append("g")
    .attr("transform", `translate(${margin.left - axisOffset},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0));

  svg
    .append("text")
    .attr("x", -(height - margin.top - margin.bottom) / 2 - margin.top)
    .attr("y", 12)
    .attr("transform", "rotate(-90)")
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .attr("font-weight", 600)
    .attr("fill", "var(--text)")
    .text("BRET Ratio");

  function drawSeries(sc) {
    const s = sc.series;
    const color = s.isCurrent ? ACCENT_COLOR : OTHER_COLOR;
    const line = sc.curvePoints
      ? d3.line().x((d) => x(d[0])).y((d) => y(d[1]))
      : d3.line().x((p) => x(p.conc_m)).y((p) => y(p.bret));
    const pathData = sc.curvePoints || s.points;

    const g = svg.append("g");
    // Other ligands tested against this receptor: hovering names the
    // chemokine, clicking jumps to its own pair page.
    const isLinked = !s.isCurrent && s.pairId;
    if (isLinked) {
      g.style("cursor", "pointer").on("click", () => {
        location.href = `pair.html?pair=${encodeURIComponent(s.pairId)}`;
      });
      g.append("title").text(`${s.chemokineLabel} — click to view this pair`);
      // A fat invisible stroke widens the hover/click target beyond the
      // thin visible line, without changing how the curve looks.
      g.append("path")
        .datum(pathData)
        .attr("d", line)
        .attr("fill", "none")
        .attr("stroke", "transparent")
        .attr("stroke-width", 16);
    }

    g.append("path")
      .datum(pathData)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", CURVE_WIDTH);

    g.selectAll(null)
      .data(s.points)
      .join("circle")
      .attr("cx", (p) => x(p.conc_m))
      .attr("cy", (p) => y(p.bret))
      .attr("r", s.isCurrent ? 3.5 : 2.5)
      .attr("fill", "#ffffff")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .append("title")
      .text((p) => `${s.chemokineLabel}: ${p.conc_m.toExponential(1)} M — BRET ${p.bret}`);
  }

  // Context curves first, the highlighted one last so it sits on top.
  seriesCurves.filter((sc) => !sc.series.isCurrent).forEach(drawSeries);
  const currentCurve = seriesCurves.find((sc) => sc.series === current);
  if (currentCurve) drawSeries(currentCurve);

  // Single direct label for the highlighted curve, on the left side of the
  // chart (in its open low-concentration region) rather than a legend box.
  if (current) {
    const labelX = margin.left + (width - margin.left - margin.right) * 0.1;
    const labelConc = Math.pow(10, Math.log10(lo) + (Math.log10(hi) - Math.log10(lo)) * 0.1);
    const labelY = current.fit
      ? logistic3pl(labelConc, current.fit.bottom, current.fit.top, current.fit.kd_nm)
      : d3.mean(current.points, (p) => p.bret);
    svg
      .append("text")
      .attr("x", labelX)
      .attr("y", Math.max(margin.top + 10, y(labelY) - 10))
      .attr("text-anchor", "start")
      .attr("font-size", 12)
      .attr("font-weight", 700)
      .attr("fill", ACCENT_COLOR)
      .text(current.chemokineLabel);
  }
}
