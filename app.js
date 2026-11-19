/* Adiposity-Burden explorer — lcap-style modular SPA */
const SSP_COLORS = { historical: "#747C80", ssp126: "#1B9E77", ssp245: "#2676A8",
                     ssp370: "#E8871E", ssp585: "#B2182B" };
const SSP_LABELS = { ssp126: "SSP1-2.6", ssp245: "SSP2-4.5", ssp370: "SSP3-7.0", ssp585: "SSP5-8.5" };
const BMI_YEARS = [2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050];
const MERC_BOUNDS = [[-85.0511287798066, -180], [85.0511287798066, 180]];

let meta = null, countriesLayer = null, overlay = null;
let selectedIso = null;
const cache = { burden: {}, paf: {} };

const state = {
  page: "home",
  bmi: { metric: "meanbmi", sex: "Both", age: "All", scenario: "ssp245", yearIdx: 7 },
  paf: { disease: "CRC", yearIdx: 1 },
  gbd: { disease: "CRC", measure: "deaths", sex: "Both", yearIdx: 7 },
  rank: { disease: "CRC", measure: "deaths", sex: "Both", scenario: "ssp245", year: 2050, topN: 20 },
  sub: "figure",
};

/* ================= utils ================= */
function loadData(src, globalName) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => window[globalName] !== undefined ? resolve(window[globalName])
                                                     : reject(new Error("no data: " + src));
    s.onerror = () => reject(new Error("load failed: " + src));
    document.head.appendChild(s);
  });
}
function fmtNum(v) {
  if (v == null || !isFinite(v)) return "-";
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + "k";
  if (a >= 100) return Math.round(v).toLocaleString();
  return (Math.round(v * 100) / 100).toLocaleString();
}
function range(a, b) { const o = []; for (let y = a; y <= b; y++) o.push(y); return o; }
function pchipSlopes(xs, ys) {
  const n = xs.length, m = new Array(n);
  if (n < 2) return m.fill(0);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return m;
}
function pchipEval(xs, ys, m, x) {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i]
       + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
}
function smoothPoints(xs, ys, years) {
  const m = pchipSlopes(xs, ys);
  return years.map(x => [x, pchipEval(xs, ys, m, x)]);
}

/* ================= series (hist + 8年混合过渡 + proj) ================= */
function buildSeries(rec, idx, histLast, sspOnly) {
  const out = [];
  const yearsSet = new Set();
  const hist = (rec && rec.historical) || {};
  const hYears = Object.keys(hist).map(Number).filter(y => y <= histLast).sort((a, b) => a - b);
  const sspOrder = sspOnly ? ["ssp245"] : ["ssp126", "ssp245", "ssp370", "ssp585"];
  let histDrawn = false;
  sspOrder.forEach(s => {
    const r = rec && rec[s];
    if (!r) return;
    const pYears = Object.keys(r).map(Number).filter(y => y >= histLast + 1).sort((a, b) => a - b);
    if (!pYears.length) return;
    const y0 = hYears.length ? hYears[hYears.length - 1] : null;
    const blendEnd = y0 !== null ? Math.min(Math.max(pYears[0], y0 + 8), pYears[pYears.length - 1]) : pYears[0];
    if (y0 !== null) {
      const pkx = [blendEnd, Math.min(blendEnd + 2, pYears[pYears.length - 1])];
      const pky = pkx.map(y => r[String(y)][idx]);
      const kx2 = hYears.concat(pkx);
      const ky2 = hYears.map(y => hist[String(y)][idx]).concat(pky);
      const dense = [];
      for (let x = hYears[0]; x < y0; x += 1) dense.push(x);
      dense.push(y0);
      for (let x = y0 + 0.5; x < blendEnd; x += 0.5) dense.push(x);
      dense.push(blendEnd);
      const pts2 = smoothPoints(kx2, ky2, dense);
      if (!histDrawn) {
        histDrawn = true;
        out.push({ name: "Historical", kind: "hist", data: pts2.filter(p => p[0] <= y0) });
        out.push({ name: "Transition", kind: "bridge", data: pts2.filter(p => p[0] >= y0 && p[0] <= blendEnd) });
      }
      out.push({ name: SSP_LABELS[s], kind: "proj", color: SSP_COLORS[s],
                 data: pYears.filter(y => y >= blendEnd).map(y => [y, r[String(y)][idx]]) });
      pts2.forEach(p => yearsSet.add(p[0]));
    } else {
      const pts2 = pYears.map(y => [y, r[String(y)][idx]]);
      pts2.forEach(p => yearsSet.add(p[0]));
      out.push({ name: SSP_LABELS[s], kind: "proj", color: SSP_COLORS[s], data: pts2 });
    }
  });
  if (!out.length && hYears.length) {
    const xs = hYears.map(Number), ys = xs.map(y => hist[String(y)][idx]);
    const pts = xs.length >= 2 ? smoothPoints(xs, ys, range(xs[0], xs[xs.length - 1])) : [[xs[0], ys[0]]];
    pts.forEach(p => yearsSet.add(p[0]));
    out.push({ name: "Historical", kind: "hist", data: pts });
  }
  return { years: [...yearsSet].sort((a, b) => a - b), series: out };
}

/* ================= 地图 ================= */
function initMap() {
  window.map = L.map("map", {
    minZoom: 2, maxZoom: 7, worldCopyJump: false, zoomControl: true, attributionControl: false,
    maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1.0,
  });
  map.fitBounds([[-58, -170], [82, 185]]);
  loadData("data/countries.js", "COUNTRIES").then(gj => {
    countriesLayer = L.geoJSON(gj, {
      style: { color: "#9AA4AA", weight: 0.4, fill: true, fillColor: "#ffffff", fillOpacity: 0.01, interactive: true },
      onEachFeature: (f, layer) => {
        layer.on("mouseover", () => { layer.bindTooltip(f.properties.name, { className: "country-tip", sticky: true }).openTooltip(); });
        layer.on("click", () => { selectedIso = f.properties.iso3; refreshTrend(); });
      },
    }).addTo(map);
  });
  window.overallMap = L.map("overall-map", {
    minZoom: 2, maxZoom: 6, worldCopyJump: false, zoomControl: true, attributionControl: false,
    maxBounds: [[-85, -180], [85, 180]], maxBoundsViscosity: 1.0,
  });
  overallMap.fitBounds([[-58, -170], [82, 185]]);
  loadData("data/countries.js", "COUNTRIES").then(gj => {
    L.geoJSON(gj, { style: { color: "#9AA4AA", weight: 0.4, fill: false } }).addTo(overallMap);
    L.imageOverlay("maps/burden_COMBINED23_deaths_ssp245_2050.webp", MERC_BOUNDS, { opacity: 1 }).addTo(overallMap);
  });
}

/* ================= 图表 ================= */
function initCharts() {
  window.chart = echarts.init(document.getElementById("chart"), null, { renderer: "canvas" });
  window.chartAge = echarts.init(document.getElementById("chart-age"), null, { renderer: "canvas" });
  window.chartOverall = echarts.init(document.getElementById("overall-chart"), null, { renderer: "canvas" });
  window.addEventListener("resize", () => { chart.resize(); chartAge.resize(); chartOverall.resize(); });
}

function tooltipFormatter(params) {
  const yv = params.length ? params[0].value[0] : 0;
  const yr = Number.isInteger(yv) ? String(yv) : yv.toFixed(1);
  let html = `<div style="font-weight:600;margin-bottom:2px">${yr}</div>`;
  params.forEach(p => { if (p.value[1] != null) html += `${p.marker} ${p.seriesName}: <b>${fmtNum(p.value[1])}</b><br/>`; });
  return html;
}

function renderChart(instance, spec) {
  const seriesOut = spec.series.map(s => ({
    name: s.name, type: "line", showSymbol: s.kind === "bridge",
    symbol: "circle", symbolSize: s.kind === "bridge" ? 3.2 : 2.2, smooth: false,
    data: s.data,
    lineStyle: { width: s.kind === "hist" ? 2.2 : 1.7, type: s.kind === "bridge" ? [6, 4] : "solid" },
    color: s.kind === "proj" ? s.color : SSP_COLORS.historical,
    emphasis: { focus: "series" }, z: s.kind === "proj" ? 3 : 4,
  }));
  instance.setOption({
    animation: false,
    grid: { left: 62, right: 18, top: 34, bottom: 38 },
    legend: { top: 2, right: 8, textStyle: { fontSize: 11 }, itemWidth: 16, itemHeight: 2 },
    xAxis: { type: "value", min: 2015, max: 2050,
             axisLabel: { formatter: v => String(Math.round(v)), fontSize: 11 }, name: "Year", nameLocation: "middle", nameGap: 24 },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: v => fmtNum(v), fontSize: 11 },
             splitLine: { lineStyle: { color: "#E9ECEE" } } },
    series: seriesOut,
    tooltip: { trigger: "axis", formatter: tooltipFormatter },
  }, true);
}

function renderBars(instance, groups, vals, color) {
  instance.setOption({
    animation: false,
    grid: { left: 58, right: 12, top: 18, bottom: 30 },
    xAxis: { type: "category", data: groups, axisLabel: { fontSize: 9, rotate: 30 } },
    yAxis: { type: "value", scale: true, axisLabel: { formatter: v => fmtNum(v), fontSize: 10 } },
    series: [{ type: "bar", data: vals, itemStyle: { color }, barWidth: "62%" }],
    tooltip: { trigger: "axis", formatter: p => `${p[0].name}: <b>${fmtNum(p[0].value)}</b>` },
  }, true);
}

/* ================= 模块定义 ================= */
const MODULES = {
  bmi: {
    title: "BMI exposure",
    sub: "Mean BMI and obesity prevalence (BMI ≥ 30) at 0.1° resolution, 2015–2050, by country, sex and age group.",
    histLast: 2024,
    fourSSP: true,
    controlDefs: [
      { id: "metric", label: "Metric", options: [["meanbmi", "Mean BMI"], ["obesity", "Obesity prevalence (BMI ≥ 30)"]], value: "meanbmi" },
      { id: "sex", label: "Sex", options: [["Both", "Both"], ["Male", "Male"], ["Female", "Female"]], value: "Both" },
      { id: "age", label: "Age", options: "AGE", value: "All" },
      { id: "scenario", label: "Scenario", options: "SSP", value: "ssp245" },
      { id: "yearIdx", label: "Year", slider: BMI_YEARS, value: 7 },
    ],
    overlayUrl: s => `maps/bmi_${s.metric}_${s.yearIdx === 7 ? s.scenario : "ssp245"}_${BMI_YEARS[s.yearIdx]}.webp`,
    legend: s => { const cb = meta.colorbar[s.metric]; return { label: cb.label, vmin: cb.vmin, vmax: cb.vmax, power: false }; },
    trendRecord: iso => window.BMI_TRENDS_V3.overall[iso],
    trendRecordDim: (iso, s) => {
      const T = window.BMI_TRENDS_V3;
      if (s.sex === "Both" && s.age === "All") return T.overall[iso];
      if (s.sex !== "Both" && s.age === "All") return (T.sex[s.sex] || {})[iso];
      if (s.sex === "Both") return (T.age[s.age] || {})[iso];
      return ((T.sexage[s.sex] || {})[s.age] || {})[iso];
    },
    trendIdx: s => s.metric === "meanbmi" ? 0 : 1,
    trendUnit: s => (s.metric === "meanbmi" ? "Mean BMI (kg/m²)" : "Obesity prevalence (%)")
                  + (s.sex === "Both" ? "" : ", " + s.sex) + (s.age === "All" ? "" : ", age " + s.age),
    dataColumns: [
      { key: "mean_bmi", label: "Mean BMI (kg/m²)", idx: 0 },
      { key: "obesity", label: "Obesity (%)", idx: 1 },
    ],
    dataRecord: () => window.BMI_TRENDS_V3.overall,
    description: `
      <h3>Data sources</h3>
      <p>Historical exposure (2015–2024) is produced by the MRP model fitted to NCD-RisC national BMI distributions; projections (2025–2050) are anchored to the GBD adult overweight/obesity forecast with national BMI-7-category anchors, then downscaled to 0.1° by the full-covariate MRP production line.</p>
      <h3>Definitions</h3>
      <p>BMI is modelled in seven categories (&lt;18.5, 18.5–20, 20–25, 25–30, 30–35, 35–40, ≥40 kg/m²). Mean BMI uses category midpoints (17.0, 19.25, 22.5, 27.5, 32.5, 37.5, 42.5). Obesity is BMI ≥ 30 kg/m²; overweight is BMI ≥ 25 kg/m².</p>
      <h3>Coverage note</h3>
      <p>Historical maps (2015/2020) cover fewer grid cells than projections because the historical MRP layer is restricted to areas with sufficient training support. National and global totals are unaffected.</p>`,
    code: [
      ["code/s03_national_bmi_anchors/", "National BMI-7-category anchors, 2025–2050"],
      ["code/s04_mrp_model/", "Future-capable MRP model (Stan/CmdStan) and validation gates"],
      ["code/s05_historical_bmi/", "Historical BMI layer, 2015–2024"],
      ["code/s06_future_bmi_production/", "Annual 0.1° BMI production, 4 SSPs × 2025–2050"],
    ],
  },
  paf: {
    title: "Population-attributable fraction",
    sub: "Share of disease burden attributable to high BMI, by cause, country and year.",
    histLast: 2021,
    fourSSP: false,
    controlDefs: [
      { id: "disease", label: "Disease", options: "DISEASES", value: "CRC" },
      { id: "yearIdx", label: "Year", slider: [2025, 2050], value: 1 },
    ],
    overlayUrl: s => `maps/paf_${s.disease}_ssp245_${[2025, 2050][s.yearIdx]}.webp`,
    legend: s => {
      const vmax = (meta.paf_norms || {})[s.disease] || 20;
      return { label: "PAF (%)", vmin: 0, vmax, power: true };
    },
    trendRecord: iso => null,
    trendRecordDim: (iso, s) => (cache.paf[s.disease] || {})[iso === "_GLOBAL" ? "_global" : ""],
    trendIdx: () => 0,
    trendUnit: () => "PAF (%)",
    needLoad: async s => {
      if (!cache.paf[s.disease]) cache.paf[s.disease] = await loadData(`data/trends_paf_${s.disease}.js`, `PAF_${s.disease}`);
      return cache.paf[s.disease];
    },
    dataColumns: [{ key: "paf", label: "PAF (%)", idx: 0 }],
    dataRecord: s => cache.paf[s.disease],
    description: `
      <h3>Definition</h3>
      <p>The population-attributable fraction (PAF) is the share of a disease's burden that would be avoided if the population's BMI distribution were at the theoretical-minimum-risk level. It is computed from BMI-category probabilities and published relative risks (RRs).</p>
      <h3>Dose–response sources</h3>
      <p>Colorectal cancer: WCRF/AICR 2024 dose–response by BMI category. Remaining causes: GBD high-BMI relative-risk crosswalk, harmonised to the same category scale.</p>
      <h3>Computation</h3>
      <p>PAF is computed at national scale and at 0.1° grid scale (population × PAF weights), then applied to GBD reference burdens to obtain attributable deaths and DALYs.</p>`,
    code: [
      ["code/s07_rr_crosswalk/", "RR freeze (data-only step)"],
      ["code/s08_crc_paf/", "Colorectal-cancer PAF production (104 scenario-year tasks)"],
      ["code/s11_all_disease_extension/", "All-cause PAF and grid PAF (23 causes)"],
    ],
  },
  gbd: {
    title: "Attributable disease burden (GBD)",
    sub: "Deaths and DALYs attributable to high BMI for 23 headline causes plus their aggregate.",
    histLast: 2021,
    fourSSP: false,
    ageProfile: true,
    controlDefs: [
      { id: "disease", label: "Disease", options: "DISEASES", value: "CRC" },
      { id: "measure", label: "Measure", options: [["deaths", "Deaths"], ["dalys", "DALYs"]], value: "deaths" },
      { id: "sex", label: "Sex", options: [["Both", "Both"], ["Male", "Male"], ["Female", "Female"]], value: "Both" },
      { id: "yearIdx", label: "Year", slider: "BURDEN_YEARS", value: 7 },
    ],
    overlayUrl: s => `maps/burden_${s.disease}_${s.measure}_ssp245_${burdenYears(s)[s.yearIdx]}.webp`,
    legend: s => {
      const vmax = meta.burden_norms[`${s.disease}_${s.measure}`] || 1;
      return { label: `Attributable ${s.measure === "deaths" ? "deaths" : "DALYs"} per 0.25° cell`, vmin: 0, vmax, power: true };
    },
    trendRecord: iso => null,
    trendRecordDim: (iso, s) => null,
    trendIdx: s => s.measure === "deaths" ? 0 : 1,
    trendUnit: s => (s.measure === "deaths" ? "Attributable deaths" : "Attributable DALYs")
                  + (s.sex === "Both" ? "" : ", " + s.sex),
    needLoad: async s => {
      if (!cache.burden[s.disease]) cache.burden[s.disease] = await loadData(`data/trends_burden_${s.disease}.js`, `BURDEN_${s.disease}`);
      return cache.burden[s.disease];
    },
    dataColumns: [
      { key: "deaths", label: "Attributable deaths", idx: 0 },
      { key: "dalys", label: "Attributable DALYs", idx: 1 },
    ],
    dataRecord: s => cache.burden[s.disease],
    description: `
      <h3>Definition</h3>
      <p>Attributable burden is the number of deaths and DALYs (disability-adjusted life years) caused by high BMI exposure: PAF × reference disease burden. Historical values (2015–2021) use GBD 2021 totals; projections (2025–2050) use the shared GBD Foresight reference burden.</p>
      <h3>Benchmark</h3>
      <p>Historical study estimates reproduce official GBD high-BMI-attributable estimates at national level (2015–2021); 0.1° grids conserve national totals within 0.002%.</p>
      <h3>Interpretation</h3>
      <p>Scenario differences in attributable burden are small by design — the reference burden is common across SSPs, so differences enter only through BMI exposure.</p>`,
    code: [
      ["code/s09_crc_burden/", "CRC attributable deaths/DALYs, 2025–2050"],
      ["code/s10_gbd_benchmark/", "Historical benchmark vs GBD 2021"],
      ["code/s11_all_disease_extension/", "65-disease burden benchmark and 0.1° density allocation"],
    ],
  },
  rank: {
    title: "Country rankings",
    sub: "Country rankings of attributable burden by disease, measure, scenario, year and sex.",
    histLast: 2021,
    fourSSP: false,
    isRank: true,
    controlDefs: [
      { id: "disease", label: "Disease", options: "DISEASES", value: "CRC" },
      { id: "measure", label: "Measure", options: [["deaths", "Deaths"], ["dalys", "DALYs"]], value: "deaths" },
      { id: "sex", label: "Sex", options: [["Both", "Both"], ["Male", "Male"], ["Female", "Female"]], value: "Both" },
      { id: "scenario", label: "Scenario", options: "SSP", value: "ssp245" },
      { id: "year", label: "Year", options: "RANK_YEARS", value: 2050 },
    ],
    needLoad: async s => {
      if (!cache.burden[s.disease]) cache.burden[s.disease] = await loadData(`data/trends_burden_${s.disease}.js`, `BURDEN_${s.disease}`);
      return cache.burden[s.disease];
    },
    dataRecord: s => cache.burden[s.disease],
    dataColumns: [
      { key: "deaths", label: "Attributable deaths", idx: 0 },
      { key: "dalys", label: "Attributable DALYs", idx: 1 },
    ],
    description: `
      <h3>Method</h3>
      <p>Countries are ranked by attributable burden (deaths or DALYs) for the selected disease, measure, scenario, year and sex. Values come directly from the national attribution product — no weighting or scaling is applied.</p>
      <h3>Reading the ranking</h3>
      <p>The bar chart shows the top 20 countries; the Data tab lists the full ranking. The ranking shifts strongly with sex for causes with large male–female gaps (e.g., liver cancer, IHD).</p>`,
    code: [
      ["code/s12_figures/", "Figure production, incl. top-20 country panels"],
      ["code/s16_web_export/", "Explorer data export (trends, maps, ranking sources)"],
    ],
  },
};

function burdenYears(s) {
  return (meta.burden_map_years_by_code && meta.burden_map_years_by_code[s.disease || "CRC"])
         || [2015, 2020, 2025, 2030, 2035, 2040, 2045, 2050];
}

/* ================= 路由 ================= */
const PAGES = ["home", "overall", "bmi", "paf", "gbd", "rank"];
function router() {
  const hash = (location.hash || "#home").replace("#", "").split("/");
  const page = PAGES.includes(hash[0]) ? hash[0] : "home";
  state.page = page;
  const sub = ["figure", "data", "description", "code"].includes(hash[1]) ? hash[1] : "figure";
  state.sub = sub;
  document.querySelectorAll(".nav-link[data-page]").forEach(a =>
    a.classList.toggle("active", a.dataset.page === page));
  document.getElementById("page-home").classList.toggle("hidden", page !== "home");
  document.getElementById("page-overall").classList.toggle("hidden", page !== "overall");
  document.getElementById("page-module").classList.toggle("hidden", !MODULES[page]);
  if (MODULES[page]) showModule(page, sub);
  if (page === "overall") showOverall();
}

/* ================= 模块渲染 ================= */
function showModule(page, sub) {
  const mod = MODULES[page];
  document.getElementById("mod-title").textContent = mod.title;
  document.getElementById("mod-sub").textContent = mod.sub;
  document.querySelectorAll(".subtab").forEach(b => b.classList.toggle("active", b.dataset.sub === sub));
  ["figure", "data", "description", "code"].forEach(k =>
    document.getElementById("sub-" + k).classList.toggle("hidden", k !== sub));
  if (sub === "figure") renderFigure(mod, page);
  else if (sub === "data") renderData(mod, page);
  else if (sub === "description") document.getElementById("description-body").innerHTML = mod.description;
  else if (sub === "code") renderCode(mod);
}

function buildControls(mod, page) {
  const el = document.getElementById("controls");
  el.innerHTML = "";
  mod.controlDefs.forEach(def => {
    const lab = document.createElement("label");
    lab.textContent = def.label + " ";
    if (def.slider) {
      const years = Array.isArray(def.slider) ? def.slider : (def.slider === "BURDEN_YEARS" ? burdenYears(state[page]) : []);
      const input = document.createElement("input");
      input.type = "range"; input.min = 0; input.max = String(years.length - 1); input.step = 1;
      input.value = String(state[page][def.id]);
      const span = document.createElement("span");
      span.className = "year-label"; span.textContent = years[state[page][def.id]];
      lab.appendChild(span); lab.appendChild(input);
      input.addEventListener("input", () => {
        state[page][def.id] = +input.value;
        span.textContent = years[state[page][def.id]];
        renderFigure(mod, page);
      });
    } else {
      const sel = document.createElement("select");
      const opts = def.options === "SSP" ? meta.scenarios.map(s => [s.code, s.label])
        : def.options === "DISEASES" ? meta.diseases.map(d => [d.code, d.name])
        : def.options === "AGE" ? [["All", "All ages 25+"], ...meta.age_groups.map(a => [a, a])]
        : def.options === "RANK_YEARS" ? burdenYears(state[page]).map(y => [y, y])
        : def.options;
      opts.forEach(([v, t]) => {
        const o = document.createElement("option");
        o.value = String(v); o.textContent = t;
        if (String(v) === String(state[page][def.id])) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", () => {
        state[page][def.id] = sel.value;
        renderFigure(mod, page);
      });
      lab.appendChild(sel);
    }
    el.appendChild(lab);
  });
}

function renderFigure(mod, page) {
  buildControls(mod, page);
  // 排名页：条形图全宽，隐藏地图卡片（注意限定到本模块页，避免误选 OVERALL 页卡片）
  const mapCard = document.querySelector("#page-module .map-card");
  if (mod.isRank) {
    mapCard.style.display = "none";
    document.querySelector("#page-module .card-row .card:last-child").style.flex = "1";
    renderRank(mod, page);
    return;
  }
  mapCard.style.display = "";
  document.querySelector("#page-module .card-row .card:last-child").style.flex = "2";
  // 地图
  const url = mod.overlayUrl(state[page]);
  if (overlay) overlay.setUrl(url);
  else overlay = L.imageOverlay(url, MERC_BOUNDS, { opacity: 1 }).addTo(map);
  if (countriesLayer) countriesLayer.bringToFront();
  refreshLegend(mod, page);
  refreshTrend();
  document.getElementById("figure-note").textContent =
    page === "paf" ? "PAF maps show SSP2-4.5 at 0.1°; available for 2025 and 2050."
    : page === "gbd" ? "Burden maps for 2030–2045 interpolate the spatial pattern between 2025 and 2050 (national totals exact)."
    : "Maps show overall (both sexes, all ages) SSP2-4.5; sex/age selections apply to the trend chart.";
}

function refreshLegend(mod, page) {
  const spec = mod.legend(state[page]);
  const isPower = !!spec.power;
  const ticks = [0, 0.0625, 0.25, 1].map(f => spec.vmin + f * (spec.vmax - spec.vmin));
  const pos = ticks.map(t => {
    const u = (t - spec.vmin) / (spec.vmax - spec.vmin);
    return (isPower ? Math.sqrt(u) : u) * 100;
  });
  const el = document.getElementById("legend-ticks");
  el.innerHTML = "";
  ticks.forEach((t, i) => {
    const s = document.createElement("span");
    s.style.left = pos[i] + "%";
    s.textContent = fmtNum(Math.round(t * 100) / 100);
    el.appendChild(s);
  });
  document.getElementById("legend-label").textContent = spec.label;
}

async function refreshTrend() {
  const page = state.page, mod = MODULES[page];
  if (!mod || mod.isRank) return;
  const s = state[page];
  let rec;
  if (page === "bmi") {
    const key = selectedIso || "_GLOBAL";
    rec = mod.trendRecordDim(key, s);
  } else {
    const data = await mod.needLoad(s);
    if (page === "paf") {
      const r245 = selectedIso ? (data.ssp245 || {})[selectedIso] : (data._global || {}).ssp245;
      const wrap = rec => Object.fromEntries(Object.entries(rec || {}).map(([y, v]) => [y, [v]]));
      const hist = {}, fut = {};
      Object.keys(r245 || {}).forEach(y => (Number(y) <= mod.histLast ? hist : fut)[y] = r245[y]);
      rec = { historical: wrap(hist), ssp245: wrap(fut) };
    } else {
      // gbd：Both 拆历史；sex 分支取 _sex
      if (s.sex === "Both") {
        const r245 = selectedIso ? data.ssp245[selectedIso] : data._global.ssp245;
        const hist = {}, fut = {};
        Object.keys(r245 || {}).forEach(y => (Number(y) <= mod.histLast ? hist : fut)[y] = r245[y]);
        rec = { historical: hist, ssp245: fut };
      } else {
        const sr = (data._sex || {})[s.sex] || {};
        rec = {};
        if (sr.ssp245) rec.ssp245 = selectedIso ? (sr.ssp245.countries || {})[selectedIso] : sr.ssp245._global;
      }
    }
  }
  // 统一：若 rec 顶层直接是 {ssp*:...}，补 historical 拆分
  if (rec && !rec.historical && !rec.ssp245 && page === "bmi") {
    // BMI rec = {historical, ssp126, ssp245, ssp370, ssp585} — 直接可用
  }
  document.getElementById("chart-title").textContent =
    (selectedIso ? (meta.country_names[selectedIso] || selectedIso) : "Global") + " — " + mod.trendUnit(s);
  renderChart(chart, buildSeries(rec, mod.trendIdx(s), mod.histLast, !mod.fourSSP));
  if (mod.ageProfile) {
    const wrap = document.getElementById("chart-age-wrap");
    wrap.classList.remove("hidden");
    const data = cache.burden[s.disease];
    const snap = (data._age2050_global || {})[s.sex] || (data._age2050_global || {}).Both;
    document.getElementById("chart-age-title").textContent =
      `Attributable ${s.measure === "deaths" ? "deaths" : "DALYs"} by age group, 2050 (SSP2-4.5, ${s.sex.toLowerCase()})`;
    renderBars(chartAge, meta.age_groups,
      meta.age_groups.map(g => (snap && snap[g]) ? snap[g][s.measure === "deaths" ? 0 : 1] : 0), "#2676A8");
  } else {
    document.getElementById("chart-age-wrap").classList.add("hidden");
  }
}

function sspOf() { return "ssp245"; }

/* ================= Rank 模块 ================= */
async function renderRank(mod, page) {
  const s = state[page];
  await mod.needLoad(s);
  const data = cache.burden[s.disease];
  // 控制条之外：隐藏地图，把 chart 用作排行图
  const dataRec = s.sex === "Both"
    ? (data[s.scenario] || data.ssp245)
    : (((data._sex || {})[s.sex] || {})[s.scenario] || {}).countries || {};
  const idx = s.measure === "deaths" ? 0 : 1;
  const rows = Object.entries(dataRec || {})
    .filter(([iso]) => iso !== "_global")
    .map(([iso, rec]) => ({ iso, name: meta.country_names[iso] || iso, v: (rec[String(s.year)] || [0, 0])[idx] }))
    .filter(r => r.v > 0)
    .sort((a, b) => b.v - a.v);
  const top = rows.slice(0, s.topN);
  document.getElementById("chart-title").textContent =
    `Top ${s.topN} countries — attributable ${s.measure === "deaths" ? "deaths" : "DALYs"}, ${s.year} (${SSP_LABELS[s.scenario]}, ${s.sex.toLowerCase()})`;
  const yCat = top.map(r => r.name).reverse();
  const yVal = top.map(r => r.v).reverse();
  chart.setOption({
    animation: false,
    grid: { left: 120, right: 40, top: 30, bottom: 30 },
    xAxis: { type: "value", scale: true, axisLabel: { formatter: v => fmtNum(v), fontSize: 11 } },
    yAxis: { type: "category", data: yCat, axisLabel: { fontSize: 11 } },
    series: [{ type: "bar", data: yVal, itemStyle: { color: "#2676A8" }, barWidth: "60%",
               label: { show: true, position: "right", fontSize: 10, formatter: p => fmtNum(p.value) } }],
    tooltip: { trigger: "axis", formatter: p => `${p[0].name}: <b>${fmtNum(p[0].value)}</b>` },
  }, true);
  // 地图卡片显示全部排行的迷你提示
  document.getElementById("figure-note").textContent =
    `Full ranking in the Data tab (${rows.length} countries).`;
  if (overlay) { overlay.remove(); overlay = null; }
}

/* ================= Data 子页 ================= */
async function renderData(mod, page) {
  const s = state[page];
  if (mod.needLoad) await mod.needLoad(s);
  let rec = mod.dataRecord(s) || {};
  if (page === "paf") rec = rec.ssp245 || {};
  else if (page === "gbd" || page === "rank") {
    rec = s.sex === "Both" ? (rec.ssp245 || {})
        : ((((rec._sex || {})[s.sex] || {}).ssp245 || {}).countries || {});
  }
  const year = page === "rank" ? s.year
             : page === "bmi" ? BMI_YEARS[s.yearIdx]
             : page === "paf" ? [2025, 2050][s.yearIdx]
             : burdenYears(s)[s.yearIdx];
  const idxs = mod.dataColumns;
  const rows = [];
  Object.entries(rec).forEach(([iso, r]) => {
    if (iso === "_global" || iso.startsWith("_")) return;
    // BMI 记录按年解析到 historical / ssp245 子层
    let v;
    if (page === "bmi") {
      const layer = year <= 2024 ? r.historical : r[s.scenario];
      v = layer && layer[String(year)];
    } else {
      v = r[String(year)];
    }
    if (!v) return;
    const row = { iso, name: meta.country_names[iso] || iso };
    idxs.forEach((c, i) => { row[c.key] = Array.isArray(v) ? v[c.idx] : v; });
    rows.push(row);
  });
  rows.sort((a, b) => (b[idxs[0].key] ?? -1) - (a[idxs[0].key] ?? -1));
  document.getElementById("data-title").textContent =
    `${mod.title} — ${year}` + (page === "rank" ? "" : "");
  const tbl = document.getElementById("data-table");
  let html = "<tr><th data-k='rank'>#</th><th data-k='name'>Country</th><th data-k='iso'>ISO</th>";
  idxs.forEach(c => html += `<th data-k='${c.key}'>${c.label}</th>`);
  html += "</tr>";
  rows.forEach((r, i) => {
    html += `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.iso}</td>` +
      idxs.map(c => `<td>${fmtNum(r[c.key])}</td>`).join("") + "</tr>";
  });
  tbl.innerHTML = html;
  // 排序
  let sortK = idxs[0].key, dir = -1;
  tbl.querySelectorAll("th").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    dir = (sortK === k) ? -dir : -1;
    sortK = k;
    const sorted = [...rows].sort((a, b) => {
      if (k === "rank") return 0;
      if (k === "name" || k === "iso") return dir * String(a[k]).localeCompare(String(b[k]));
      return dir * ((b[k] ?? -1) - (a[k] ?? -1));
    });
    let h = "<tr><th>#</th><th>Country</th><th>ISO</th>" + idxs.map(c => `<th>${c.label}</th>`).join("") + "</tr>";
    sorted.forEach((r, i) => {
      h += `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.iso}</td>` +
        idxs.map(c => `<td>${fmtNum(r[c.key])}</td>`).join("") + "</tr>";
    });
    tbl.innerHTML = h;
  }));
  // 搜索过滤
  document.getElementById("data-search").oninput = e => {
    const q = e.target.value.toLowerCase();
    tbl.querySelectorAll("tr").forEach((tr, i) => {
      if (i === 0) return;
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

/* ================= Code 子页 ================= */
function renderCode(mod) {
  const base = "https://github.com/Eros-c/adiposity-burden-replication/tree/main/";
  let html = `<h3>Replication code — ${mod.title}</h3>
    <p>Complete pipeline: <a href="${base}" target="_blank">${base.replace("https://", "")}</a></p>
    <h3>Module scripts</h3><ul class="code-list">`;
  mod.code.forEach(([p, d]) => {
    html += `<li><div class="path"><a href="${base}${p}" target="_blank">${p}</a></div><div class="desc">${d}</div></li>`;
  });
  html += `</ul>
    <h3>Explorer code</h3>
    <ul class="code-list">
      <li><div class="path"><a href="${base}code/s16_web_export/" target="_blank">code/s16_web_export/</a></div><div class="desc">Data export behind this explorer (trends, maps, ranking sources)</div></li>
    </ul>
    <p>Reproduction guide: <a href="${base}docs/PIPELINE.md" target="_blank">docs/PIPELINE.md</a>;
    external data sources: <a href="${base}docs/DATA.md" target="_blank">docs/DATA.md</a>.</p>`;
  document.getElementById("code-body").innerHTML = html;
}

/* ================= Overall 页 ================= */
function showOverall() {
  loadData("data/trends_burden_COMBINED23.js", "BURDEN_COMBINED23").then(data => {
    const r245 = data._global.ssp245;
    const hist = {}, fut = {};
    Object.keys(r245 || {}).forEach(y => (Number(y) <= 2021 ? hist : fut)[y] = r245[y]);
    const rec = { historical: hist, ssp245: fut };
    renderChart(chartOverall, buildSeries(rec, 0, 2021, true));
    // 图例
    const vmax = meta.burden_norms["COMBINED23_deaths"] || 1;
    const el = document.getElementById("overall-legend-ticks");
    el.innerHTML = "";
    [0, vmax * 0.0625, vmax * 0.25, vmax].forEach((v, i) => {
      const s = document.createElement("span");
      s.style.left = Math.sqrt([0, 0.0625, 0.25, 1][i]) * 100 + "%";
      s.textContent = fmtNum(Math.round(v * 100) / 100);
      el.appendChild(s);
    });
  });
}

/* ================= Home 数字 ================= */
function fillHomeNums() {
  const g = window.BMI_TRENDS_V3.overall._GLOBAL;
  const nums = [
    ["25.0", "Mean adult BMI, 2015 (kg/m²)"],
    [g.ssp245["2050"][0].toFixed(1), "Mean adult BMI, 2050 (kg/m²)"],
    [g.historical["2015"][1] + "%", "Obesity prevalence, 2015"],
    [g.ssp245["2050"][1] + "%", "Obesity prevalence, 2050 (SSP2-4.5)"],
  ];
  document.getElementById("hero-nums").innerHTML = nums.map(([n, t]) =>
    `<div class="hero-num"><div class="n">${n}</div><div class="t">${t}</div></div>`).join("");
  // hero 背景：用 2050 合计死亡地图
  document.getElementById("hero-bg").style.backgroundImage =
    "url('maps/burden_COMBINED23_deaths_ssp245_2050.webp')";
}

/* ================= 事件 ================= */
document.querySelectorAll(".subtab").forEach(b => b.addEventListener("click", () => {
  location.hash = `${state.page}/${b.dataset.sub}`;
}));
document.getElementById("reset-country").addEventListener("click", () => {
  selectedIso = null; refreshTrend();
});
window.addEventListener("hashchange", router);

/* ================= 启动 ================= */
async function init() {
  meta = await loadData("data/meta.js", "META");
  await loadData("data/trends_bmi_v3.js", "BMI_TRENDS_V3");
  initMap();
  initCharts();
  router();
  fillHomeNums();
}
init().catch(e => { document.body.innerHTML = "<pre style='padding:40px'>" + e.stack + "</pre>"; });
