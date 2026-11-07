/* app.js — interface : carte, saisie, estimation, projet vente/achat */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const { geocode, reverse, fetchCommune, fetchPrebuilt, fetchFallback, analyse, dpeCoef, fmtEur } = window.DVF;

  /* ---------- Carte ---------- */
  const map = L.map("map", { scrollWheelZoom: false }).setView([48.80, 2.55], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  let posMarker = null, radiusCircle = null, salesLayer = L.layerGroup().addTo(map);

  const state = { pos: null }; // {lat, lon, citycode, city, label}

  function setPosition(p, fitZoom = 15) {
    state.pos = p;
    if (posMarker) posMarker.remove();
    posMarker = L.marker([p.lat, p.lon], { title: p.label }).addTo(map).bindPopup(`<b>${esc(p.label)}</b>`);
    drawRadius();
    map.setView([p.lat, p.lon], fitZoom);
    $("btn-estimate").disabled = false;
    $("addr").value = p.label || "";
    setStatus(`Position : ${p.label} (commune ${p.city}, code ${p.citycode}).`);
    $("results").hidden = true;
    salesLayer.clearLayers();
  }

  function drawRadius() {
    if (!state.pos) return;
    const r = +$("radius").value;
    if (radiusCircle) radiusCircle.remove();
    if (r < 99999) {
      radiusCircle = L.circle([state.pos.lat, state.pos.lon], { radius: r, color: "#0f6e56", weight: 1.5, fillOpacity: .06 }).addTo(map);
    }
  }
  $("radius").addEventListener("change", drawRadius);

  // Clic sur la carte = nouvelle position
  map.on("click", async (e) => {
    try {
      setStatus("Recherche de l'adresse…");
      const p = await reverse(e.latlng.lat, e.latlng.lng);
      setPosition(p, map.getZoom());
    } catch (err) { setStatus(err.message, "err"); }
  });

  /* ---------- Géolocalisation ---------- */
  $("btn-geoloc").addEventListener("click", () => {
    if (!navigator.geolocation) return setStatus("Géolocalisation non disponible sur cet appareil.", "err");
    setStatus("Localisation en cours…");
    navigator.geolocation.getCurrentPosition(async (g) => {
      try {
        const p = await reverse(g.coords.latitude, g.coords.longitude);
        setPosition(p, 16);
      } catch (err) { setStatus(err.message, "err"); }
    }, (err) => setStatus("Localisation refusée ou impossible (" + err.message + "). Tapez une adresse.", "warn"), { enableHighAccuracy: true, timeout: 10000 });
  });

  /* ---------- Autocomplétion d'adresse ---------- */
  const addr = $("addr"), sug = $("addr-suggest");
  let debounce = null, suggestions = [], active = -1;
  addr.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = addr.value.trim();
    if (q.length < 3) { sug.hidden = true; return; }
    debounce = setTimeout(async () => {
      try {
        suggestions = await geocode(q, 6);
        active = -1;
        sug.innerHTML = suggestions.map((s, i) => `<li data-i="${i}">${esc(s.label)}</li>`).join("");
        sug.hidden = suggestions.length === 0;
      } catch { sug.hidden = true; }
    }, 250);
  });
  addr.addEventListener("keydown", (e) => {
    if (sug.hidden) { if (e.key === "Enter") { e.preventDefault(); pickFirst(); } return; }
    if (e.key === "ArrowDown") { active = Math.min(active + 1, suggestions.length - 1); hl(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); hl(); e.preventDefault(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active >= 0 ? active : 0); }
    else if (e.key === "Escape") sug.hidden = true;
  });
  sug.addEventListener("mousedown", (e) => { const li = e.target.closest("li"); if (li) pick(+li.dataset.i); });
  document.addEventListener("click", (e) => { if (!e.target.closest(".addr-field")) sug.hidden = true; });
  function hl() { [...sug.children].forEach((li, i) => li.classList.toggle("active", i === active)); }
  function pick(i) { const s = suggestions[i]; if (!s) return; sug.hidden = true; setPosition(s, s.type === "municipality" ? 13 : 16); }
  async function pickFirst() {
    const q = addr.value.trim(); if (q.length < 3) return;
    try { const r = await geocode(q, 1); if (r[0]) setPosition(r[0], r[0].type === "municipality" ? 13 : 16); else setStatus("Adresse introuvable.", "warn"); }
    catch (err) { setStatus(err.message, "err"); }
  }

  /* ---------- Formulaires d'ajustements ---------- */
  const { ADJUSTMENTS, applyAdjustments } = window.DVF;
  function renderAdjForm(containerId, prefix, type, keep = {}) {
    const c = $(containerId); if (!c) return;
    c.innerHTML = Object.entries(ADJUSTMENTS).filter(([, d]) => !d.only || d.only === type).map(([key, d]) => {
      const id = prefix + key, v = keep[key];
      if (d.type === "select") return `<label class="field"><span>${esc(d.label)}</span><select id="${id}">${d.options.map(o => { const sel = v !== undefined ? v === o[0] : (!o[2].pct && !o[2].fixed); return `<option value="${o[0]}"${sel ? " selected" : ""}>${esc(o[1])}</option>`; }).join("")}</select></label>`;
      if (d.type === "number") return `<label class="field"><span>${esc(d.label)}</span><input id="${id}" type="number" min="0" step="10" value="${v ?? ""}" placeholder="ex. 400"></label>`;
      return `<label class="check"><input id="${id}" type="checkbox"${v ? " checked" : ""}> ${esc(d.label)}</label>`;
    }).join("");
  }
  function readAdj(prefix, type) {
    const out = {};
    for (const [key, d] of Object.entries(ADJUSTMENTS)) {
      if (d.only && d.only !== type) continue;
      const el = $(prefix + key); if (!el) continue;
      out[key] = d.type === "check" ? el.checked : el.value;
    }
    return out;
  }
  renderAdjForm("adj-form", "adj-", $("type").value);
  renderAdjForm("ps-form", "ps-", $("p-sell-type").value);
  renderAdjForm("pb-form", "pb-", $("p-buy-type").value);
  $("type").addEventListener("change", () => { renderAdjForm("adj-form", "adj-", $("type").value, readAdj("adj-", $("type").value)); if (!$("results").hidden) runEstimate({ silent: true }); });
  $("p-sell-type").addEventListener("change", () => renderAdjForm("ps-form", "ps-", $("p-sell-type").value));
  $("p-buy-type").addEventListener("change", () => renderAdjForm("pb-form", "pb-", $("p-buy-type").value));
  $("adj-form").addEventListener("change", () => { if (!$("results").hidden) runEstimate({ silent: true }); });
  const terrainMedian = (sales) => { const t = sales.map(s => s.terrain).filter(x => x > 0).sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : 0; };
  const pctTxt = (p) => (p >= 0 ? "+" : "−") + Math.round(Math.abs(p) * 100) + " %";

  /* ---------- Estimation ---------- */
  $("btn-estimate").addEventListener("click", () => runEstimate());
  ["type", "dpe", "surface", "radius", "period", "region"].forEach(id => $(id).addEventListener("change", () => { if (!$("results").hidden) runEstimate({ silent: true }); }));

  const prebuiltCache = new Map();
  async function loadSales(pos, radius) {
    // 1. Données pré-calculées du site (rapide, fiable)
    try {
      if (!prebuiltCache.has(pos.citycode)) prebuiltCache.set(pos.citycode, await fetchPrebuilt(pos.citycode));
      const d = prebuiltCache.get(pos.citycode);
      return { sales: d.sales, source: "prebuilt", generated: d.generated };
    } catch (err) {
      if (err.code !== "NODATA") console.warn(err);
    }
    // 2. CSV DVF en direct (fonctionne seulement si le serveur autorise le navigateur)
    try {
      return { sales: await fetchCommune(pos.citycode, (y) => setStatus(`Chargement des ventes ${y}…`)), source: "csv" };
    } catch (err) {
      if (err.code !== "CORS") throw err;
    }
    // 3. API de secours
    setStatus("Commune hors des données pré-calculées, essai via l'API de secours…", "warn");
    return { sales: await fetchFallback(pos.lat, pos.lon, Math.min(radius, 5000)), source: "fallback" };
  }

  async function runEstimate(opts = {}) {
    const pos = state.pos; if (!pos) return;
    const type = $("type").value, radius = +$("radius").value, months = +$("period").value;
    const surface = +$("surface").value || 0, dpe = $("dpe").value, region = $("region").value;
    $("btn-estimate").disabled = true;
    try {
      const { sales, source, generated } = await loadSales(pos, radius);
      const a = analyse(sales, { lat: pos.lat, lon: pos.lon, radius, type, months });
      const adjValues = readAdj("adj-", type);
      const adj = applyAdjustments(adjValues, { type, terrainMedian: terrainMedian(a.selected) });
      const est = renderResults(a, { type, surface, dpe, region, radius, source, pos, adj });
      setStatus(source === "fallback" ? "Données issues de l'API de secours (couverture possiblement partielle)."
        : `Ventes DVF de ${pos.city} : ${sales.length} logements${generated ? ", données préparées le " + fmtDate(generated) : ""}.`);
      if (!opts.silent && isFinite(a.stats.median)) {
        window.HISTORIQUE.add({
          kind: "estimation", titre: pos.label,
          resume: `${type} ${surface ? surface + " m², " : ""}DPE ${dpe}${adj.lines.length ? ", " + adj.lines.length + " ajustement(s)" : ""} · ${fmtEur(a.stats.median)}/m² brut (${a.stats.n} ventes, ${a.periodNote})${surface && est ? " → " + fmtEur(est.value) : ""}`,
          params: { pos: { lat: pos.lat, lon: pos.lon, citycode: pos.citycode, city: pos.city, label: pos.label }, type, surface, dpe, radius, months, region, adj: adjValues }
        });
      }
    } catch (err) {
      console.error(err);
      setStatus("Impossible de charger les ventes : " + err.message, "err");
    } finally { $("btn-estimate").disabled = false; }
  }

  function renderResults(a, o) {
    const st = a.stats, res = $("results");
    res.hidden = false;
    const typeLabel = o.type === "Maison" ? "maisons" : "appartements";
    $("kpi-type-label").textContent = `${typeLabel} · ${a.periodNote}`;
    $("kpi-median").textContent = isFinite(st.median) ? fmtEur(st.median) + "/m²" : "—";
    $("kpi-range").textContent = isFinite(st.p25) ? `Fourchette P25–P75 : ${fmtEur(st.p25)} – ${fmtEur(st.p75)} /m²` : "Aucune vente comparable";
    $("kpi-count").innerHTML = st.n + (a.fragile ? ' <span class="badge fragile">échantillon fragile</span>' : "");
    $("kpi-scope").textContent = o.radius < 99999 ? `dans un rayon de ${o.radius >= 1000 ? (o.radius / 1000) + " km" : o.radius + " m"} · ${a.within.length} ${typeLabel} au total sur la période complète` : `sur toute la commune (${o.pos.city})`;

    // DPE + caractéristiques
    const coef = o.dpe === "?" ? 0 : dpeCoef(o.region, o.type, o.dpe);
    const adj = o.adj || { pct: 0, fixed: 0, lines: [] };
    const factor = (1 + coef) * (1 + adj.pct);
    const ppm2 = st.median * factor;
    const total = o.surface > 0 ? ppm2 * o.surface + adj.fixed : NaN;
    $("kpi-dpe-label").textContent = (o.dpe === "?" ? "sans ajustement DPE" : `DPE ${o.dpe} (${pctTxt(coef)})`) + (adj.lines.length ? ` · ${adj.lines.length} caractéristique${adj.lines.length > 1 ? "s" : ""}` : "");
    if (o.surface > 0 && isFinite(ppm2)) {
      $("kpi-estimate").textContent = fmtEur(total);
      $("kpi-estimate-range").textContent = `${fmtEur(st.p25 * factor * o.surface + adj.fixed)} – ${fmtEur(st.p75 * factor * o.surface + adj.fixed)} pour ${o.surface} m² · soit ${fmtEur(total / o.surface)}/m²`;
    } else {
      $("kpi-estimate").textContent = isFinite(ppm2) ? fmtEur(ppm2) + "/m²" : "—";
      $("kpi-estimate-range").textContent = o.surface > 0 ? "" : "Indiquez une surface pour obtenir un prix total.";
    }
    $("dpe-explain").innerHTML = o.dpe === "?"
      ? "Sans classe DPE, l'estimation reprend la médiane du secteur telle quelle (équivalent d'un bien de classe D)."
      : `La médiane des ventes mélange toutes les étiquettes ; elle est prise comme référence d'un bien <b>classe D</b>. Pour un <b>${o.type.toLowerCase()} classe ${o.dpe}</b> en <b>${o.region === "idf" ? "Île-de-France" : "France entière"}</b>, l'écart retenu est de <b>${pctTxt(coef)}</b> (Notaires de France, étude « valeur verte », transactions 2024). ${o.dpe >= "F" ? "Pensez aussi à l'audit énergétique obligatoire à la vente pour les F et G, et aux travaux que l'acheteur va négocier." : ""}`;
    const at = $("adj-table").querySelector("tbody");
    const base = o.surface > 0 ? st.median * o.surface : st.median;
    const unit = o.surface > 0 ? "" : "/m²";
    at.innerHTML = [
      `<tr><td>Médiane du secteur${o.surface > 0 ? ` × ${o.surface} m²` : ""}</td><td>${fmtEur(base)}${unit}</td></tr>`,
      coef ? `<tr><td>DPE ${o.dpe}</td><td>${pctTxt(coef)}</td></tr>` : "",
      ...adj.lines.map(l => `<tr><td>${esc(l.label)}</td><td>${l.pct ? pctTxt(l.pct) : ""}${l.fixed ? (o.surface > 0 ? " + " + fmtEur(l.fixed) : " (+ " + fmtEur(l.fixed) + " forfaitaire)") : ""}</td></tr>`),
      `<tr class="total"><td>Estimation</td><td>${o.surface > 0 ? fmtEur(total) : fmtEur(ppm2) + "/m²"}</td></tr>`
    ].join("");
    renderResults.last = { value: total, ppm2, factor };

    // Années
    const tb = $("years-table").querySelector("tbody");
    tb.innerHTML = a.years.map(y => `<tr><td>${y.year}</td><td class="num">${y.n}</td><td class="num">${fmtEur(y.median)}</td><td class="num">${fmtEur(y.p25)} – ${fmtEur(y.p75)}</td></tr>`).join("") || `<tr><td colspan="4">Aucune vente de ce type dans le rayon.</td></tr>`;

    // Ventes
    const sb = $("sales-table").querySelector("tbody");
    sb.innerHTML = a.selected.slice(0, 40).map(s => `<tr><td>${fmtDate(s.date)}</td><td>${esc(s.address)}${s.multi ? ' <span class="badge">2 lots</span>' : ""}</td><td>${s.type}${s.pieces ? " " + s.pieces + "p" : ""}${s.terrain ? ` · terrain ${s.terrain} m²` : ""}</td><td class="num">${s.surface} m²</td><td class="num">${fmtEur(s.price)}</td><td class="num">${fmtEur(s.ppm2)}</td><td class="num">${s.dist} m</td></tr>`).join("") || `<tr><td colspan="7">Aucune vente.</td></tr>`;

    // Carte
    salesLayer.clearLayers();
    const lo = st.p25, hi = st.p75;
    for (const s of a.within) {
      const inSel = a.selected.includes(s);
      const color = !isFinite(lo) ? "#777" : s.ppm2 < lo ? "#2b7bba" : s.ppm2 > hi ? "#c0392b" : "#0f6e56";
      L.circleMarker([s.lat, s.lon], { radius: inSel ? 7 : 4, color: "#fff", weight: 1, fillColor: color, fillOpacity: inSel ? .9 : .45 })
        .bindPopup(`<div class="sale-popup"><b>${fmtEur(s.ppm2)}/m²</b><br>${esc(s.address)}<br>${s.type} · ${s.surface} m²${s.terrain ? " · terrain " + s.terrain + " m²" : ""}<br>${fmtEur(s.price)} · ${fmtDate(s.date)}</div>`)
        .addTo(salesLayer);
    }
    if (a.within.length) {
      const b = L.latLngBounds(a.within.map(s => [s.lat, s.lon])).extend([o.pos.lat, o.pos.lon]);
      map.fitBounds(b.pad(.15));
    }
    res.scrollIntoView({ behavior: "smooth", block: "start" });
    return renderResults.last;
  }

  /* ---------- Projet vente / achat ---------- */
  $("btn-project").addEventListener("click", runProject);

  async function estimateFor(addrText, type, surface, dpe, adjPrefix) {
    addrText = (addrText || "").trim();
    if (addrText.length < 3) throw new Error(adjPrefix === "pb-" ? "Indiquez l'adresse ou la commune du bien à acheter." : "Indiquez l'adresse du bien à vendre.");
    if (!(surface > 0)) throw new Error(adjPrefix === "pb-" ? "Indiquez la surface du bien à acheter." : "Indiquez la surface du bien à vendre.");
    const r = await geocode(addrText, 1);
    if (!r[0]) throw new Error(`Adresse introuvable : « ${addrText} »`);
    const pos = r[0];
    const whole = pos.type === "municipality";
    const radius = whole ? 99999 : 1000;
    const { sales, source } = await loadSales(pos, radius);
    let a = analyse(sales, { lat: pos.lat, lon: pos.lon, radius, type, months: 24 });
    let scopeWhole = whole;
    if (a.stats.n < 8 && !whole) { a = analyse(sales, { lat: pos.lat, lon: pos.lon, radius: 99999, type, months: 24 }); scopeWhole = true; }
    if (!isFinite(a.stats.median)) throw new Error(`Aucune vente de ${type.toLowerCase()} trouvée à ${pos.city} dans les données DVF.`);
    const coef = dpeCoef($("region").value, type, dpe);
    const adj = adjPrefix ? applyAdjustments(readAdj(adjPrefix, type), { type, terrainMedian: terrainMedian(a.selected) }) : { pct: 0, fixed: 0, lines: [] };
    const ppm2 = a.stats.median * (1 + coef) * (1 + adj.pct);
    return { pos, a, coef, adj, ppm2, value: ppm2 * surface + adj.fixed, scopeWhole, source };
  }

  async function runProject() {
    const ps = $("p-status");
    ps.className = "status inline"; ps.textContent = "Calcul en cours…";
    $("btn-project").disabled = true;
    try {
      const sell = await estimateFor($("p-sell-addr").value, $("p-sell-type").value, +$("p-sell-surf").value, $("p-sell-dpe").value, "ps-");
      const buy = await estimateFor($("p-buy-addr").value, $("p-buy-type").value, +$("p-buy-surf").value, $("p-buy-dpe").value, "pb-");

      const agency = (+$("p-sell-agency").value || 0) / 100, crd = +$("p-sell-crd").value || 0;
      const notary = (+$("p-buy-notary").value || 0) / 100, cash = +$("p-buy-cash").value || 0;

      const sellNet = sell.value * (1 - agency) - crd;
      const buyTotal = buy.value * (1 + notary);
      const balance = sellNet + cash - buyTotal;
      const affordableSurf = (sellNet + cash) / (buy.ppm2 * (1 + notary));

      $("p-sell-result").innerHTML = paneHtml(sell, +$("p-sell-surf").value, $("p-sell-type").value, $("p-sell-dpe").value);
      $("p-buy-result").innerHTML = paneHtml(buy, +$("p-buy-surf").value, $("p-buy-type").value, $("p-buy-dpe").value);

      const bal = $("p-balance");
      bal.hidden = false;
      bal.className = "balance" + (balance < 0 ? " negative" : "");
      bal.innerHTML = `
        <h3>${balance >= 0 ? "✅ L'opération se finance sans emprunt complémentaire" : "⚠️ Il manque " + fmtEur(-balance) + " à financer (emprunt ou apport)"}</h3>
        <table>
          <tr><td>Prix de vente estimé (${$("p-sell-type").value.toLowerCase()} ${$("p-sell-surf").value} m², DPE ${$("p-sell-dpe").value})</td><td>${fmtEur(sell.value)}</td></tr>
          <tr><td>− Frais d'agence (${Math.round(agency * 1000) / 10} %)</td><td>− ${fmtEur(sell.value * agency)}</td></tr>
          <tr><td>− Capital restant dû</td><td>− ${fmtEur(crd)}</td></tr>
          <tr><td><b>= Net vendeur</b></td><td>${fmtEur(sellNet)}</td></tr>
          <tr><td>+ Apport complémentaire</td><td>+ ${fmtEur(cash)}</td></tr>
          <tr><td>Prix d'achat estimé (${$("p-buy-type").value.toLowerCase()} ${$("p-buy-surf").value} m², DPE ${$("p-buy-dpe").value})</td><td>${fmtEur(buy.value)}</td></tr>
          <tr><td>+ Frais de notaire (${Math.round(notary * 1000) / 10} %)</td><td>+ ${fmtEur(buy.value * notary)}</td></tr>
          <tr><td><b>= Coût total de l'achat</b></td><td>${fmtEur(buyTotal)}</td></tr>
          <tr class="total"><td>Solde</td><td>${balance >= 0 ? "+" : "−"} ${fmtEur(Math.abs(balance))}</td></tr>
        </table>
        <p class="muted small" style="margin:12px 0 0">Avec le net vendeur + apport, sans emprunt, vous pourriez viser environ <b>${Math.floor(affordableSurf)} m²</b> à ${esc(buy.pos.city)} (${fmtEur(buy.ppm2)}/m² ajusté DPE, frais de notaire inclus). Les prix de vente médians datent de 6 à 12 mois ; un marché en hausse ou en baisse décale les deux côtés.</p>`;
      ps.textContent = "";
      bal.scrollIntoView({ behavior: "smooth", block: "nearest" });
      window.HISTORIQUE.add({
        kind: "projet", titre: `${$("p-sell-addr").value} → ${$("p-buy-addr").value}`,
        resume: `Vente ${fmtEur(sell.value)} (${$("p-sell-type").value} ${$("p-sell-surf").value} m², DPE ${$("p-sell-dpe").value}) · Achat ${fmtEur(buy.value)} (${$("p-buy-type").value} ${$("p-buy-surf").value} m², DPE ${$("p-buy-dpe").value}) · Solde ${balance >= 0 ? "+" : "−"}${fmtEur(Math.abs(balance))}`,
        params: Object.assign(Object.fromEntries(["p-sell-addr", "p-sell-type", "p-sell-surf", "p-sell-dpe", "p-sell-agency", "p-sell-crd", "p-buy-addr", "p-buy-type", "p-buy-surf", "p-buy-dpe", "p-buy-notary", "p-buy-cash"].map(id => [id, $(id).value])),
          { adjSell: readAdj("ps-", $("p-sell-type").value), adjBuy: readAdj("pb-", $("p-buy-type").value) })
      });
    } catch (err) {
      console.error(err);
      ps.className = "status inline err"; ps.textContent = err.message;
    } finally { $("btn-project").disabled = false; }
  }

  function paneHtml(e, surf, type, dpe) {
    const st = e.a.stats;
    const scope = e.scopeWhole ? `toute la commune de ${esc(e.pos.city)}` : `rayon 1 km`;
    const adjTxt = e.adj && e.adj.lines.length ? " · " + e.adj.lines.map(l => `${l.label.split(" (")[0]} ${l.pct ? pctTxt(l.pct) : "+" + fmtEur(l.fixed)}`).join(", ") : "";
    return `<div><b>${fmtEur(e.value)}</b> <span class="muted">pour ${surf} m²</span></div>
      <div>${fmtEur(e.ppm2)}/m² après DPE ${dpe} (${pctTxt(e.coef)})${adjTxt} · médiane brute ${fmtEur(st.median)}/m²</div>
      <div class="muted">${st.n} ${type === "Maison" ? "maisons" : "appartements"} vendus (${e.a.periodNote}), ${scope}${st.n < 8 ? ' <span class="badge fragile">fragile</span>' : ""}<br>P25–P75 : ${fmtEur(st.p25)} – ${fmtEur(st.p75)} /m² · ${esc(e.pos.label)}</div>`;
  }

  /* ---------- Trajets ---------- */
  const T = window.TRAJET;
  const tDest = $("t-dest");
  tDest.innerHTML = Object.entries(T.DESTINATIONS).map(([k, d]) => `<option value="${k}">${esc(d.label)}</option>`).join("");
  $("key-prim").value = T.getKey("prim");
  $("key-google").value = T.getKey("google");
  $("key-prim").addEventListener("change", (e) => T.setKey("prim", e.target.value));
  $("key-google").addEventListener("change", (e) => T.setKey("google", e.target.value));
  $("btn-trajet").addEventListener("click", runTrajets);

  async function resolveOrigins() {
    const origins = [];
    const seen = new Set();
    const add = async (label, text, pos) => {
      if (!pos && text) { const r = await geocode(text, 1); pos = r[0]; }
      if (!pos) return;
      const key = pos.lat.toFixed(4) + "," + pos.lon.toFixed(4);
      if (seen.has(key)) return; seen.add(key);
      origins.push({ label, pos });
    };
    if ($("p-sell-addr").value.trim().length >= 3) await add("🏠 À vendre — " + $("p-sell-addr").value, $("p-sell-addr").value);
    if ($("p-buy-addr").value.trim().length >= 3) await add("🔑 À acheter — " + $("p-buy-addr").value, $("p-buy-addr").value);
    if (state.pos) await add("📍 Estimateur — " + state.pos.label, null, state.pos);
    return origins;
  }

  async function runTrajets() {
    const st = $("t-status"), tbl = $("t-table"), tb = tbl.querySelector("tbody");
    st.className = "status"; st.textContent = "Calcul des trajets…";
    $("btn-trajet").disabled = true;
    try {
      let dest;
      const custom = $("t-dest-addr").value.trim();
      if (custom) { const r = await geocode(custom, 1); if (!r[0]) throw new Error("Destination introuvable : " + custom); dest = { label: r[0].label, lat: r[0].lat, lon: r[0].lon }; }
      else dest = T.DESTINATIONS[tDest.value];
      const departure = T.nextWeekday($("t-time").value || "08:00");
      const origins = await resolveOrigins();
      if (!origins.length) throw new Error("Aucune adresse de départ : remplissez le projet ou positionnez l'estimateur.");
      const results = await Promise.all(origins.map(o => T.compute(o.pos, dest, departure)));
      tb.innerHTML = origins.map((o, i) => {
        const r = results[i];
        const car = r.car ? `<b>${T.fmtMin(r.car.duration)}</b>${r.car.staticDuration ? ` <span class="muted">(${T.fmtMin(r.car.staticDuration)} sans trafic)</span>` : ""}<br><small class="muted">${T.fmtKm(r.car.distance)} · ${esc(r.car.source)}</small>` : '<span class="muted">—</span>';
        const tr = r.transit ? `<b>${T.fmtMin(r.transit.duration)}</b>${isFinite(r.transit.changes) ? ` <span class="muted">· ${r.transit.changes} corresp.</span>` : ""}<br><small class="muted">${esc((r.transit.lines || []).join(" → "))}${r.transit.lines && r.transit.lines.length ? " · " : ""}${esc(r.transit.source)}</small>` : '<span class="muted">Ajoutez une clé PRIM ou Google, ou ouvrez le lien →</span>';
        const l = r.links;
        return `<tr><td>${esc(o.label)}</td><td>${car}</td><td>${tr}</td><td><a href="${l.gmapsTransit}" target="_blank" rel="noopener">Google Maps</a> · <a href="${l.idfm}" target="_blank" rel="noopener">IDFM</a> · <a href="${l.gmapsDrive}" target="_blank" rel="noopener">voiture</a></td></tr>`;
      }).join("");
      tbl.hidden = false;
      const notes = [...new Set(results.flatMap(r => r.notes))];
      st.className = "status" + (notes.length ? " warn" : "");
      st.textContent = `Vers ${dest.label}, départ ${departure.toLocaleString("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" })}.` + (notes.length ? " " + notes.join(" · ") : "");
      window.HISTORIQUE.add({
        kind: "trajet", titre: `Vers ${dest.label}, ${$("t-time").value}`,
        resume: origins.map((o, i) => `${o.label.split(" — ")[1] || o.label} : 🚗 ${results[i].car ? T.fmtMin(results[i].car.duration) : "—"}${results[i].transit ? " · 🚇 " + T.fmtMin(results[i].transit.duration) : ""}`).join(" | "),
        params: { dest: tDest.value, destAddr: custom, time: $("t-time").value, sell: $("p-sell-addr").value, buy: $("p-buy-addr").value }
      });
    } catch (err) {
      console.error(err);
      st.className = "status err"; st.textContent = err.message;
    } finally { $("btn-trajet").disabled = false; }
  }

  /* ---------- Rechargement depuis l'historique ---------- */
  window.HISTORIQUE.setReload((e) => {
    const p = e.params || {};
    if (e.kind === "estimation") {
      $("type").value = p.type; $("surface").value = p.surface || ""; $("dpe").value = p.dpe; $("radius").value = p.radius; $("period").value = p.months; $("region").value = p.region;
      renderAdjForm("adj-form", "adj-", p.type, p.adj || {});
      setPosition(p.pos, 15); runEstimate({ silent: true });
      document.getElementById("estimateur").scrollIntoView({ behavior: "smooth" });
    } else if (e.kind === "projet") {
      for (const [id, v] of Object.entries(p)) if (typeof v !== "object" && $(id)) $(id).value = v;
      renderAdjForm("ps-form", "ps-", $("p-sell-type").value, p.adjSell || {});
      renderAdjForm("pb-form", "pb-", $("p-buy-type").value, p.adjBuy || {});
      document.getElementById("projet").scrollIntoView({ behavior: "smooth" });
      runProject();
    } else if (e.kind === "trajet") {
      if (p.dest) tDest.value = p.dest; $("t-dest-addr").value = p.destAddr || ""; $("t-time").value = p.time || "08:00";
      if (p.sell) $("p-sell-addr").value = p.sell; if (p.buy) $("p-buy-addr").value = p.buy;
      document.getElementById("trajets").scrollIntoView({ behavior: "smooth" });
      runTrajets();
    }
  });

  /* ---------- utilitaires ---------- */
  function setStatus(msg, cls = "") { const s = $("status"); s.className = "status " + cls; s.textContent = msg; }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function fmtDate(d) { if (!d) return ""; const [y, m, day] = String(d).split("-"); return `${day}/${m}/${y}`; }

  // Pré-remplissage : paramètres d'URL ?q=adresse&type=Maison&surface=100&dpe=D
  const params = new URLSearchParams(location.search);
  if (params.get("type")) $("type").value = params.get("type");
  if (params.get("surface")) $("surface").value = params.get("surface");
  if (params.get("dpe")) $("dpe").value = params.get("dpe");
  if (params.get("q")) { addr.value = params.get("q"); pickFirst().then(() => params.get("auto") && runEstimate()); }
})();
