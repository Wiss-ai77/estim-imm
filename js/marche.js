/* marche.js — analyse du marché par commune à partir de data/stats.json */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const DEPS = { "75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise" };
  const fmtEur = (n) => isFinite(n) ? n.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €" : "—";
  const fmtPct = (p) => isFinite(p) ? (p > 0 ? "+" : p < 0 ? "−" : "") + Math.abs(p * 100).toFixed(1).replace(".", ",") + " %" : "—";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cls = (p) => !isFinite(p) ? "" : p > .02 ? "up" : p < -.02 ? "down" : "flat";
  const color = (p) => !isFinite(p) ? "#9aa0a6" : p >= .06 ? "#0b6b3a" : p >= .02 ? "#5cb85c" : p > -.02 ? "#b0b7bd" : p > -.06 ? "#e8923a" : "#c0392b";

  let DATA = null, rows = [], sortKey = "evol1", sortDir = -1, selectedDeps = new Set(Object.keys(DEPS));
  const map = L.map("m-map", { scrollWheelZoom: false }).setView([48.78, 2.5], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  // Chips de départements
  $("m-deps").innerHTML = Object.entries(DEPS).map(([d, n]) => `<label class="chip"><input type="checkbox" value="${d}" checked> ${d} <small>${esc(n)}</small></label>`).join("");
  $("m-deps").addEventListener("change", (e) => { const v = e.target.value; e.target.checked ? selectedDeps.add(v) : selectedDeps.delete(v); compute(); });
  ["m-type", "m-min"].forEach(id => $(id).addEventListener("change", compute));
  $("m-search").addEventListener("input", renderTable);
  document.querySelectorAll("#m-table th[data-k]").forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" || k === "dep" ? 1 : -1; }
    renderTable();
  }));

  async function load() {
    $("m-status").textContent = "Chargement des statistiques…";
    const r = await fetch(new URL("data/stats.json", location.href), { cache: "no-cache" });
    if (!r.ok) { $("m-status").className = "status err"; $("m-status").textContent = "data/stats.json introuvable : relancez la génération des données (scripts/build-data.mjs)."; return; }
    DATA = await r.json();
    compute();
  }

  function compute() {
    if (!DATA) return;
    const type = $("m-type").value, min = +$("m-min").value;
    const allYears = [...new Set(DATA.communes.flatMap(c => Object.keys(c.years)))].sort();
    const lastYear = allYears[allYears.length - 1], prevYear = String(+lastYear - 1), firstYear = allYears[0];
    const partial = DATA.lastMonth && +DATA.lastMonth.slice(5, 7) < 12;
    rows = [];
    for (const c of DATA.communes) {
      if (!selectedDeps.has(c.dep)) continue;
      const y = c.years[lastYear] && c.years[lastYear][type], p = c.years[prevYear] && c.years[prevYear][type], f = c.years[firstYear] && c.years[firstYear][type];
      if (!y || y.n < min) continue;
      const series = allYears.map(yy => (c.years[yy] && c.years[yy][type]) ? c.years[yy][type].med : null);
      rows.push({
        code: c.code, name: c.name, dep: c.dep, lat: c.lat, lon: c.lon,
        n: y.n, med: y.med, p25: y.p25, p75: y.p75, surf: y.surf,
        evol1: p && p.n >= Math.min(min, 10) ? y.med / p.med - 1 : NaN,
        evol4: f && f.n >= Math.min(min, 10) && firstYear !== lastYear ? y.med / f.med - 1 : NaN,
        vol: p ? y.n / p.n - 1 : NaN,
        series
      });
    }
    // KPIs
    const medOf = (a) => { const s = a.filter(isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
    $("k-communes").textContent = rows.length;
    $("k-ventes").textContent = `${rows.reduce((s, r) => s + r.n, 0).toLocaleString("fr-FR")} ventes en ${lastYear}${partial ? " (année partielle, jusqu'à " + DATA.lastMonth + ")" : ""}`;
    const e1 = medOf(rows.map(r => r.evol1)), e4 = medOf(rows.map(r => r.evol4));
    $("k-evol1").textContent = fmtPct(e1); $("k-evol1").className = "kpi-value " + cls(e1);
    $("k-evol1-sub").textContent = `${lastYear} vs ${prevYear}, médiane des communes · ${rows.filter(r => r.evol1 > 0).length} en hausse, ${rows.filter(r => r.evol1 < 0).length} en baisse`;
    $("k-evol4").textContent = fmtPct(e4); $("k-evol4").className = "kpi-value " + cls(e4);
    $("k-evol4-sub").textContent = `${lastYear} vs ${firstYear}`;
    $("th-year").textContent = lastYear;
    $("m-note").textContent = `Données DVF jusqu'à ${DATA.lastMonth} (préparées le ${DATA.generated}). ${partial ? "La dernière année est incomplète : les évolutions sur 1 an comparent des périodes différentes, à lire avec prudence. " : ""}Seules les communes avec au moins ${min} ventes de ${type === "A" ? "appartements" : "maisons"} en ${lastYear} sont affichées.`;
    $("m-status").textContent = "";
    renderTops(); renderMap(); renderTable();
  }

  function renderTops() {
    const ok = rows.filter(r => isFinite(r.evol1));
    const li = (r) => `<li><a href="#" data-code="${r.code}">${esc(r.name)}</a> <span class="${cls(r.evol1)}">${fmtPct(r.evol1)}</span> <small class="muted">${fmtEur(r.med)}/m², ${r.n} ventes</small></li>`;
    $("m-top-up").innerHTML = ok.slice().sort((a, b) => b.evol1 - a.evol1).slice(0, 10).map(li).join("");
    $("m-top-down").innerHTML = ok.slice().sort((a, b) => a.evol1 - b.evol1).slice(0, 10).map(li).join("");
  }

  function renderMap() {
    layer.clearLayers();
    const maxN = Math.max(1, ...rows.map(r => r.n));
    for (const r of rows) {
      L.circleMarker([r.lat, r.lon], { radius: 4 + 14 * Math.sqrt(r.n / maxN), color: "#fff", weight: 1, fillColor: color(r.evol1), fillOpacity: .8 })
        .bindPopup(popup(r)).addTo(layer);
    }
    if (rows.length) map.fitBounds(L.latLngBounds(rows.map(r => [r.lat, r.lon])).pad(.05));
  }

  function popup(r) {
    const type = $("m-type").value === "A" ? "Appartement" : "Maison";
    return `<div class="sale-popup"><b>${esc(r.name)}</b> (${r.dep})<br>${fmtEur(r.med)}/m² médian · ${r.n} ventes<br>1 an : <span class="${cls(r.evol1)}">${fmtPct(r.evol1)}</span> · depuis 2021 : <span class="${cls(r.evol4)}">${fmtPct(r.evol4)}</span><br><a href="index.html?q=${encodeURIComponent(r.name)}&type=${type}&auto=1">Ouvrir dans l'estimateur →</a></div>`;
  }

  function spark(series) {
    const v = series.filter(x => x != null); if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), w = 90, h = 26;
    const pts = series.map((x, i) => x == null ? null : [i / (series.length - 1) * (w - 4) + 2, h - 2 - (hi === lo ? h / 2 : (x - lo) / (hi - lo) * (h - 4))]).filter(Boolean);
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="#0f6e56" stroke-width="1.5" points="${pts.map(p => p.map(n => n.toFixed(1)).join(",")).join(" ")}"/>${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="1.8" fill="#0f6e56"/>`).join("")}</svg>`;
  }

  function renderTable() {
    const q = $("m-search").value.trim().toLowerCase();
    const type = $("m-type").value === "A" ? "Appartement" : "Maison";
    let list = rows.filter(r => !q || r.name.toLowerCase().includes(q) || r.code.startsWith(q));
    list.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "string") return x.localeCompare(y, "fr") * sortDir;
      const nx = isFinite(x) ? x : -Infinity, ny = isFinite(y) ? y : -Infinity;
      return (nx - ny) * sortDir;
    });
    document.querySelectorAll("#m-table th[data-k]").forEach(th => th.classList.toggle("sorted", th.dataset.k === sortKey));
    $("m-table").querySelector("tbody").innerHTML = list.map(r => `<tr>
      <td><a href="index.html?q=${encodeURIComponent(r.name)}&type=${type}&auto=1" title="Ouvrir dans l'estimateur">${esc(r.name)}</a></td>
      <td>${r.dep}</td><td class="num">${r.n}</td><td class="num"><b>${fmtEur(r.med)}</b></td>
      <td class="num muted">${fmtEur(r.p25)} – ${fmtEur(r.p75)}</td>
      <td class="num ${cls(r.evol1)}">${fmtPct(r.evol1)}</td><td class="num ${cls(r.evol4)}">${fmtPct(r.evol4)}</td>
      <td class="num ${cls(r.vol)}">${fmtPct(r.vol)}</td><td>${spark(r.series)}</td></tr>`).join("") || `<tr><td colspan="9">Aucune commune ne correspond.</td></tr>`;
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-code]"); if (!a) return;
    e.preventDefault();
    const r = rows.find(x => x.code === a.dataset.code); if (!r) return;
    map.setView([r.lat, r.lon], 12);
    layer.eachLayer(l => { const ll = l.getLatLng(); if (Math.abs(ll.lat - r.lat) < 1e-6 && Math.abs(ll.lng - r.lon) < 1e-6) l.openPopup(); });
    $("m-map").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  load().catch(err => { $("m-status").className = "status err"; $("m-status").textContent = err.message; });
})();
