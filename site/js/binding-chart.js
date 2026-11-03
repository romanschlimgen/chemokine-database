// Renders a BRET saturation-binding chart: the real (concentration, BRET)
// data points from data/raw_binding/ (via build_db.py -> binding_curve_points)
// plus the fitted four-parameter logistic curve from scripts/analyze_binding.py,
// on a log concentration axis. If there's no fit (e.g. no detectable binding),
// just the points are drawn.
function logistic4pl(concM, bottom, top, kdNm, hill) {
  const logx = Math.log10(concM);
  const logkd = Math.log10(kdNm * 1e-9);
  return bottom + (top - bottom) / (1 + Math.pow(10, (logkd - logx) * hill));
}

function formatConc(m) {
  if (m >= 1e-3) return `${(m * 1e3).toPrecision(2)} mM`;
  if (m >= 1e-6) return `${(m * 1e6).toPrecision(2)} µM`;
  if (m >= 1e-9) return `${(m * 1e9).toPrecision(2)} nM`;
  if (m >= 1e-12) return `${(m * 1e12).toPrecision(2)} pM`;
  return `${m.toExponential(1)} M`;
}

function renderBindingChart(svgSelector, points, fit) {
  const svg = d3.select(svgSelector);
  svg.selectAll("*").remove();
  if (!points.length) return;

  const width = Math.max(svg.node().clientWidth || 420, 320);
  const height = 260;
  const margin = { top: 16, right: 20, bottom: 40, left: 52 };
  svg.attr("height", height).attr("viewBox", `0 0 ${width} ${height}`);

  const concExtent = d3.extent(points, (p) => p.conc_m);
  const x = d3.scaleLog().domain(concExtent).range([margin.left, width - margin.right]);
  const yMax = Math.max(d3.max(points, (p) => p.bret), fit ? fit.top : 0) * 1.1;
  const y = d3.scaleLinear().domain([0, yMax]).nice().range([height - margin.bottom, margin.top]);

  const tickValues = [...new Set(points.map((p) => p.conc_m))].sort((a, b) => a - b);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(tickValues).tickFormat(formatConc))
    .selectAll("text")
    .attr("font-size", 9)
    .attr("transform", "rotate(-35)")
    .attr("text-anchor", "end");

  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5));

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", 12)
    .attr("font-size", 10)
    .attr("fill", "var(--text-dim)")
    .text("BRET ratio");

  if (fit) {
    const [lo, hi] = concExtent;
    const steps = 80;
    const curvePoints = d3.range(steps + 1).map((i) => {
      const logc = Math.log10(lo) + (i / steps) * (Math.log10(hi) - Math.log10(lo));
      const c = Math.pow(10, logc);
      return [c, logistic4pl(c, fit.bottom, fit.top, fit.kd_nm, fit.hill)];
    });
    const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
    svg
      .append("path")
      .datum(curvePoints)
      .attr("d", line)
      .attr("fill", "none")
      .attr("stroke", "#0066cc")
      .attr("stroke-width", 2);
  }

  svg
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (p) => x(p.conc_m))
    .attr("cy", (p) => y(p.bret))
    .attr("r", 3.5)
    .attr("fill", "#1d4e89")
    .append("title")
    .text((p) => `${formatConc(p.conc_m)} — BRET ${p.bret}`);
}
