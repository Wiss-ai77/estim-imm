#!/usr/bin/env node
/**
 * build-stats.mjs — agrège data/<insee>.json en data/stats.json :
 * pour chaque commune, par année et par type (A = appartement, M = maison) :
 * nombre de ventes, médiane, P25, P75 du prix au m², surface médiane,
 * plus le centroïde (médiane des coordonnées) et le dernier mois de données.
 * Usage : node scripts/build-stats.mjs   (appelé aussi par build-data.mjs)
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA = path.resolve(new URL(".", import.meta.url).pathname, "..", "data");

function quant(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return quant(s, .5); };

export async function buildStats() {
  const files = (await readdir(DATA)).filter(f => /^\d{5}\.json$|^2[AB]\d{3}\.json$/.test(f));
  const out = { generated: new Date().toISOString().slice(0, 10), lastMonth: "", communes: [] };
  let lastMonth = "";
  for (const f of files) {
    const j = JSON.parse(await readFile(path.join(DATA, f), "utf8"));
    const years = {};
    const lats = [], lons = [];
    for (const s of j.sales) {
      const y = s[0].slice(0, 4), t = s[4];
      const m = s[0].slice(0, 7); if (m > lastMonth) lastMonth = m;
      (years[y] ||= { A: [], M: [], As: [], Ms: [] })[t].push(s[3]);
      years[y][t + "s"].push(s[2]);
      lats.push(s[5]); lons.push(s[6]);
    }
    const stats = {};
    for (const [y, v] of Object.entries(years)) {
      stats[y] = {};
      for (const t of ["A", "M"]) {
        if (!v[t].length) continue;
        const s = v[t].slice().sort((a, b) => a - b);
        stats[y][t] = { n: s.length, med: Math.round(quant(s, .5)), p25: Math.round(quant(s, .25)), p75: Math.round(quant(s, .75)), surf: Math.round(med(v[t + "s"])) };
      }
    }
    out.communes.push({ code: j.code, name: j.name, dep: j.code.startsWith("97") ? j.code.slice(0, 3) : j.code.slice(0, 2), lat: +med(lats).toFixed(4), lon: +med(lons).toFixed(4), n: j.sales.length, years: stats });
  }
  out.lastMonth = lastMonth;
  out.communes.sort((a, b) => a.code.localeCompare(b.code));
  await writeFile(path.join(DATA, "stats.json"), JSON.stringify(out));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  buildStats().then(o => console.log(`stats.json : ${o.communes.length} communes, données jusqu'à ${o.lastMonth}`)).catch(e => { console.error(e); process.exit(1); });
}
