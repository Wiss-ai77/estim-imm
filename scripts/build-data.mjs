#!/usr/bin/env node
/**
 * build-data.mjs — télécharge les fichiers DVF géolocalisés par département,
 * nettoie les ventes (même logique que le site : js/dvf.js) et écrit un JSON
 * compact par commune dans data/<code INSEE>.json, plus data/index.json.
 *
 * Usage : node scripts/build-data.mjs [dep ...]   (défaut : DEPTS ci-dessous)
 * Node ≥ 18 (fetch natif). Aucune dépendance.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";

const require = createRequire(import.meta.url);
require("../js/dvf.js");
const { parseCSV, cleanMutations } = globalThis.DVF;

const DEFAULT_DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"];
const DEPTS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DEPTS;
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];
const BASE = "https://files.data.gouv.fr/geo-dvf/latest/csv";
const OUT = path.resolve(new URL(".", import.meta.url).pathname, "..", "data");

async function fetchDept(dep, year) {
  const url = `${BASE}/${year}/departements/${dep}.csv.gz`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return gunzipSync(buf).toString("utf8");
}

function compact(s) {
  // [date, prix, surface, €/m², type (M/A), lat, lon, terrain, pièces, adresse, 2 lots ?]
  return [s.date, s.price, s.surface, s.ppm2, s.type === "Maison" ? "M" : "A",
    +s.lat.toFixed(6), +s.lon.toFixed(6), s.terrain || 0, s.pieces || 0, s.address, s.multi ? 1 : 0];
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let index = { generated: new Date().toISOString().slice(0, 10), years: {}, communes: {} };
  try { index = Object.assign(index, JSON.parse(await readFile(path.join(OUT, "index.json"), "utf8")), { generated: index.generated }); } catch { /* premier passage */ }

  for (const dep of DEPTS) {
    const byCommune = new Map();
    const yearsOk = [];
    for (const y of YEARS) {
      process.stdout.write(`Département ${dep}, ${y} … `);
      let text;
      try { text = await fetchDept(dep, y); } catch (e) { console.log("erreur :", e.message); continue; }
      if (!text) { console.log("absent"); continue; }
      const rows = parseCSV(text);
      for (const r of rows) {
        const c = r.code_commune; if (!c) continue;
        (byCommune.get(c) || byCommune.set(c, []).get(c)).push(r);
      }
      yearsOk.push(y);
      console.log(`${rows.length} lignes`);
    }
    index.years[dep] = yearsOk;
    for (const [code, rows] of byCommune) {
      const sales = cleanMutations(rows).sort((a, b) => a.date < b.date ? 1 : -1);
      if (!sales.length) continue;
      const name = rows[0].nom_commune;
      await writeFile(path.join(OUT, `${code}.json`), JSON.stringify({ code, name, generated: index.generated, sales: sales.map(compact) }));
      index.communes[code] = { name, n: sales.length };
    }
    console.log(`→ ${byCommune.size} communes écrites pour le ${dep}`);
  }
  await writeFile(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
  console.log(`Index : ${Object.keys(index.communes).length} communes, généré le ${index.generated}`);
  const { buildStats } = await import("./build-stats.mjs");
  const st = await buildStats();
  console.log(`Statistiques marché : ${st.communes.length} communes, données jusqu'à ${st.lastMonth}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
