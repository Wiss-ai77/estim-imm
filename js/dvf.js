/* ------------------------------------------------------------------
 * dvf.js — couche données : géocodage (API Adresse), téléchargement et
 * nettoyage des ventes DVF géolocalisées, statistiques, ajustement DPE.
 * Tout tourne dans le navigateur ; aucune donnée n'est envoyée ailleurs
 * qu'aux services publics (data.gouv.fr).
 * ------------------------------------------------------------------ */
(function (global) {
  "use strict";

  const ADRESSE_API = "https://api-adresse.data.gouv.fr";
  const DVF_BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
  const DVF_FALLBACK = "https://api.cquest.org/dvf"; // secours si les CSV ne sont pas joignables
  const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  const MIN_PPM2 = 500, MAX_PPM2 = 25000;

  const cache = new Map(); // code commune -> Promise<Sale[]>

  /* ---------- Géocodage ---------- */
  async function geocode(q, limit = 5) {
    q = String(q || "").trim();
    if (q.length < 3) throw new Error("Adresse trop courte : indiquez au moins une commune.");
    const url = `${ADRESSE_API}/search/?q=${encodeURIComponent(q)}&limit=${limit}`;
    const r = await fetch(url);
    if (r.status === 400) throw new Error("Adresse non comprise par l'API Adresse : essayez « numéro rue, code postal ville ».");
    if (!r.ok) throw new Error("API Adresse indisponible (" + r.status + ")");
    const j = await r.json();
    return (j.features || []).map(f => ({
      label: f.properties.label,
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      citycode: f.properties.citycode,
      city: f.properties.city,
      postcode: f.properties.postcode,
      type: f.properties.type,
      score: f.properties.score
    }));
  }

  async function reverse(lat, lon) {
    const url = `${ADRESSE_API}/reverse/?lon=${lon}&lat=${lat}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Géocodage inverse indisponible (" + r.status + ")");
    const j = await r.json();
    const f = (j.features || [])[0];
    if (!f) throw new Error("Aucune adresse trouvée à cette position.");
    return {
      label: f.properties.label,
      lon, lat,
      citycode: f.properties.citycode,
      city: f.properties.city,
      postcode: f.properties.postcode
    };
  }

  /* ---------- Téléchargement DVF ---------- */
  function deptFolder(citycode) {
    if (/^97/.test(citycode)) return citycode.slice(0, 3);
    return citycode.slice(0, 2); // gère 2A / 2B
  }

  // Paris, Lyon, Marseille : DVF utilise les codes d'arrondissement (75101…) ;
  // l'API Adresse renvoie déjà ce code en citycode. Rien à faire.

  async function fetchCommune(citycode, onProgress) {
    if (cache.has(citycode)) return cache.get(citycode);
    const p = (async () => {
      const dep = deptFolder(citycode);
      let okYears = 0, corsBlocked = false;
      const all = [];
      await Promise.all(YEARS.map(async (y) => {
        const url = `${DVF_BASE}/${y}/communes/${dep}/${citycode}.csv`;
        try {
          const r = await fetch(url);
          if (!r.ok) return; // 404 pour une année non publiée : normal
          const text = await r.text();
          const rows = parseCSV(text);
          all.push(...rows);
          okYears++;
          onProgress && onProgress(y);
        } catch (e) {
          corsBlocked = true; // TypeError réseau/CORS
        }
      }));
      if (okYears === 0) {
        if (corsBlocked) throw Object.assign(new Error("CSV DVF non joignables"), { code: "CORS" });
        throw Object.assign(new Error("Aucune donnée DVF pour cette commune"), { code: "EMPTY" });
      }
      return cleanMutations(all);
    })();
    cache.set(citycode, p);
    p.catch(() => cache.delete(citycode));
    return p;
  }

  /* Données pré-calculées par le script scripts/build-data.mjs (GitHub Action), servies depuis le site lui-même */
  const DATA_BASE = (typeof document !== "undefined" && document.currentScript)
    ? new URL("../data/", document.currentScript.src).href
    : "data/";
  async function fetchPrebuilt(citycode) {
    const r = await fetch(`${DATA_BASE}${citycode}.json`, { cache: "no-cache" });
    if (r.status === 404) throw Object.assign(new Error("Commune absente des données pré-calculées"), { code: "NODATA" });
    if (!r.ok) throw new Error("Lecture des données impossible (" + r.status + ")");
    const j = await r.json();
    const sales = j.sales.map((a, i) => ({
      id: j.code + "-" + i, date: a[0], year: +String(a[0]).slice(0, 4), price: a[1], surface: a[2], ppm2: a[3],
      type: a[4] === "M" ? "Maison" : "Appartement", lat: a[5], lon: a[6], terrain: a[7], pieces: a[8], address: a[9], multi: !!a[10],
      city: j.name
    }));
    return { sales, generated: j.generated, name: j.name };
  }

  /* Secours : API communautaire cquest (rayon autour d'un point) */
  async function fetchFallback(lat, lon, dist) {
    const url = `${DVF_FALLBACK}?lat=${lat}&lon=${lon}&dist=${Math.min(dist, 5000)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("API de secours indisponible");
    const j = await r.json();
    const rows = (j.resultats || j.features || []).map(x => {
      const p = x.properties || x;
      return {
        id_mutation: p.id_mutation || (p.date_mutation + "|" + p.valeur_fonciere + "|" + p.numero_disposition),
        date_mutation: p.date_mutation,
        nature_mutation: p.nature_mutation,
        valeur_fonciere: p.valeur_fonciere,
        adresse_numero: p.numero_voie || p.adresse_numero || "",
        adresse_nom_voie: (p.type_voie ? p.type_voie + " " : "") + (p.voie || p.adresse_nom_voie || ""),
        code_postal: p.code_postal,
        nom_commune: p.commune || p.nom_commune,
        type_local: p.type_local,
        surface_reelle_bati: p.surface_relle_bati || p.surface_reelle_bati,
        surface_terrain: p.surface_terrain,
        nombre_pieces_principales: p.nombre_pieces_principales,
        id_parcelle: p.code_parcelle || p.id_parcelle,
        lot1_surface_carrez: p.lot1_surface_carrez || p.lot_1_surface_carrez,
        longitude: p.lon || p.longitude || (x.geometry && x.geometry.coordinates[0]),
        latitude: p.lat || p.latitude || (x.geometry && x.geometry.coordinates[1])
      };
    });
    return cleanMutations(rows);
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = splitLine(lines[0]);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cells = splitLine(line);
      const o = {};
      for (let k = 0; k < header.length; k++) o[header[k]] = cells[k] ?? "";
      out.push(o);
    }
    return out;
  }

  function splitLine(line) {
    if (line.indexOf('"') === -1) return line.split(",");
    const cells = []; let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  }

  /* ---------- Nettoyage : une ligne = un logement vendu ---------- */
  function cleanMutations(rows) {
    const byMut = new Map();
    for (const r of rows) {
      if (r.nature_mutation && r.nature_mutation !== "Vente") continue;
      const id = r.id_mutation;
      if (!byMut.has(id)) byMut.set(id, []);
      byMut.get(id).push(r);
    }
    const sales = [];
    for (const [id, rs] of byMut) {
      const price = parseFloat(rs[0].valeur_fonciere);
      if (!price || price < 5000) continue;

      // Locaux distincts (une même ligne peut être répétée pour chaque nature de culture)
      const locals = new Map(); // clé -> {type, surface, terrain}
      let hasCommercial = false;
      for (const r of rs) {
        const t = r.type_local;
        if (!t) continue;
        if (/Local industriel/i.test(t)) { hasCommercial = true; break; }
        if (t !== "Maison" && t !== "Appartement") continue; // dépendances ignorées
        const surf = parseFloat(r.surface_reelle_bati) || 0;
        if (surf < 9) continue;
        const key = `${t}|${surf}|${r.id_parcelle}|${r.lot1_numero || r.lot_1_numero || ""}`;
        if (!locals.has(key)) locals.set(key, { type: t, surface: surf });
      }
      if (hasCommercial || locals.size === 0 || locals.size > 2) continue;
      const types = new Set([...locals.values()].map(l => l.type));
      if (types.size > 1) continue; // maison + appartement dans la même vente : inexploitable
      const type = [...types][0];
      // Deux appartements vendus ensemble : on garde si surfaces plausibles (ex. T3 + studio) — on somme.
      let surface = 0;
      for (const l of locals.values()) surface += l.surface;
      if (surface < 9) continue;
      const ppm2 = price / surface;
      if (ppm2 < MIN_PPM2 || ppm2 > MAX_PPM2) continue;

      const geo = rs.find(r => r.latitude && r.longitude) || rs[0];
      const lat = parseFloat(geo.latitude), lon = parseFloat(geo.longitude);
      if (!isFinite(lat) || !isFinite(lon)) continue;

      let terrain = 0;
      for (const r of rs) terrain = Math.max(terrain, parseFloat(r.surface_terrain) || 0);
      const pieces = Math.max(0, ...rs.map(r => parseInt(r.nombre_pieces_principales) || 0));

      sales.push({
        id, date: rs[0].date_mutation, year: +String(rs[0].date_mutation).slice(0, 4),
        price, surface: Math.round(surface), ppm2: Math.round(ppm2), type, lat, lon,
        terrain: Math.round(terrain), pieces,
        address: [rs[0].adresse_numero, rs[0].adresse_suffixe, rs[0].adresse_nom_voie].filter(Boolean).join(" ").trim(),
        postcode: rs[0].code_postal, city: rs[0].nom_commune,
        multi: locals.size > 1
      });
    }
    return sales;
  }

  /* ---------- Géométrie & stats ---------- */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  function stats(values) {
    const s = values.slice().sort((a, b) => a - b);
    return { n: s.length, median: quantile(s, .5), p25: quantile(s, .25), p75: quantile(s, .75), min: s[0], max: s[s.length - 1] };
  }

  /**
   * Sélectionne les ventes comparables et calcule les statistiques.
   * @param sales   ventes nettoyées de la commune
   * @param opts    {lat, lon, radius, type, months}
   */
  function analyse(sales, opts) {
    const now = new Date();
    const cutoff = opts.months ? new Date(now.getFullYear(), now.getMonth() - opts.months, 1) : null;
    const within = [];
    for (const s of sales) {
      if (s.type !== opts.type) continue;
      const d = haversine(opts.lat, opts.lon, s.lat, s.lon);
      if (d > opts.radius) continue;
      within.push(Object.assign({ dist: Math.round(d) }, s));
    }
    within.sort((a, b) => a.dist - b.dist);
    let selected = cutoff ? within.filter(s => new Date(s.date) >= cutoff) : within;
    let periodNote = cutoff ? `${opts.months} derniers mois` : "toutes années";
    let widened = false;
    if (selected.length < 8 && within.length > selected.length) { selected = within; periodNote = "toutes années (période élargie)"; widened = true; }

    const st = stats(selected.map(s => s.ppm2));
    const byYear = {};
    for (const s of within) (byYear[s.year] ||= []).push(s.ppm2);
    const years = Object.keys(byYear).sort().map(y => Object.assign({ year: y }, stats(byYear[y])));
    return { selected, within, stats: st, years, periodNote, widened, fragile: st.n < 8 };
  }

  /* ---------- DPE : écarts de prix vs classe D (Notaires de France, transactions 2024) ---------- */
  const DPE_COEF = {
    idf: { // Île-de-France : écarts atténués (marché tendu)
      Appartement: { A: .06, B: .04, C: .02, D: 0, E: -.02, F: -.04, G: -.06 },
      Maison:      { A: .10, B: .07, C: .04, D: 0, E: -.04, F: -.09, G: -.14 }
    },
    fr: { // France entière hors Paris
      Appartement: { A: .16, B: .10, C: .05, D: 0, E: -.04, F: -.08, G: -.12 },
      Maison:      { A: .17, B: .12, C: .06, D: 0, E: -.07, F: -.18, G: -.25 }
    }
  };
  function dpeCoef(region, type, cls) {
    const t = DPE_COEF[region] || DPE_COEF.idf;
    const c = t[type] || t.Appartement;
    return cls in c ? c[cls] : 0;
  }

  /* ---------- Ajustements du bien (ordres de grandeur de marché, Île-de-France) ----------
   * pct : en proportion du prix (la médiane DVF = bien « standard » en bon état)
   * fixed : montant forfaitaire en euros
   */
  const ADJUSTMENTS = {
    etat: { label: "État général", type: "select", options: [
      ["neuf", "Refait à neuf (moins de 5 ans)", { pct: .08 }],
      ["bon", "Bon état / standard", { pct: 0 }],
      ["rafraichir", "À rafraîchir (peintures, sols)", { pct: -.05 }],
      ["renover", "À rénover (cuisine, salle de bain, électricité)", { pct: -.12 }],
      ["gros", "Gros travaux (toiture, structure, tout à refaire)", { pct: -.20 }]
    ] },
    stationnement: { label: "Stationnement", type: "select", options: [
      ["aucun", "Aucun / rue", { pct: 0 }],
      ["place", "1 place extérieure privative", { fixed: 7000 }],
      ["garage", "1 garage fermé / box", { fixed: 15000 }],
      ["double", "2 places ou garage double", { fixed: 22000 }]
    ] },
    abri: { label: "Abri de jardin / dépendance", type: "check", pct: 0, fixed: 2000, only: "Maison" },
    piscine: { label: "Piscine enterrée", type: "check", fixed: 15000, only: "Maison" },
    exterieur: { label: "Balcon / terrasse / jardin privatif", type: "check", pct: .04, only: "Appartement" },
    dernier: { label: "Dernier étage avec ascenseur, ou vue dégagée", type: "check", pct: .03, only: "Appartement" },
    rdc: { label: "Rez-de-chaussée", type: "check", pct: -.05, only: "Appartement" },
    sansasc: { label: "4e étage ou plus sans ascenseur", type: "check", pct: -.08, only: "Appartement" },
    lumineux: { label: "Très lumineux / exposition sud", type: "check", pct: .02 },
    nuisance: { label: "Nuisances (bruit, vis-à-vis, voie passante)", type: "check", pct: -.05 },
    terrain: { label: "Terrain (m²)", type: "number", only: "Maison" } // comparé à la médiane des ventes voisines
  };

  /**
   * values : {etat:"bon", stationnement:"garage", abri:true, terrain:420, …}
   * ctx    : {type, terrainMedian}
   * → {pct, fixed, lines:[{label, pct, fixed}]}
   */
  function applyAdjustments(values, ctx) {
    let pct = 0, fixed = 0; const lines = [];
    for (const [key, def] of Object.entries(ADJUSTMENTS)) {
      if (def.only && def.only !== ctx.type) continue;
      const v = values[key];
      if (def.type === "select") {
        const opt = def.options.find(o => o[0] === v); if (!opt) continue;
        const eff = opt[2]; if (!eff.pct && !eff.fixed) continue;
        pct += eff.pct || 0; fixed += eff.fixed || 0; lines.push({ label: opt[1], pct: eff.pct || 0, fixed: eff.fixed || 0 });
      } else if (def.type === "check") {
        if (!v) continue;
        pct += def.pct || 0; fixed += def.fixed || 0; lines.push({ label: def.label, pct: def.pct || 0, fixed: def.fixed || 0 });
      } else if (def.type === "number" && key === "terrain") {
        const t = +v; if (!(t > 0) || !(ctx.terrainMedian > 0)) continue;
        // ±1 % par tranche de 10 % d'écart avec le terrain médian des ventes comparables, plafonné à ±10 %
        const ecart = (t - ctx.terrainMedian) / ctx.terrainMedian;
        const p = Math.max(-.10, Math.min(.10, ecart * 0.1));
        if (Math.abs(p) < .005) continue;
        pct += p; lines.push({ label: `Terrain ${t} m² vs ${Math.round(ctx.terrainMedian)} m² médian`, pct: p, fixed: 0 });
      }
    }
    return { pct, fixed, lines };
  }

  function fmtEur(n, digits = 0) {
    if (!isFinite(n)) return "—";
    return n.toLocaleString("fr-FR", { maximumFractionDigits: digits }) + " €";
  }

  global.DVF = { geocode, reverse, fetchCommune, fetchPrebuilt, fetchFallback, ADJUSTMENTS, applyAdjustments, analyse, dpeCoef, DPE_COEF, haversine, fmtEur, stats, parseCSV, cleanMutations };
})(typeof window !== "undefined" ? window : globalThis);
