// Test minimal : node test/test_dvf.js
require("../js/dvf.js");
const { parseCSV, cleanMutations, analyse, dpeCoef } = globalThis.DVF;

const H = "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude";
const rows = [
  // maison simple, 2 lignes (sol + jardin) -> 1 vente
  "2024-1,2024-03-12,1,Vente,420000,14,,RUE DU VARAN DU NIL,1234,77340,77373,Pontault-Combault,77,,,77373000AB0001,,,,,,,,,,,,,0,1,Maison,100,5,S,sols,,,250,2.5958,48.7824",
  "2024-1,2024-03-12,1,Vente,420000,14,,RUE DU VARAN DU NIL,1234,77340,77373,Pontault-Combault,77,,,77373000AB0001,,,,,,,,,,,,,0,1,Maison,100,5,J,jardins,,,250,2.5958,48.7824",
  // appartement + dépendance -> 1 vente appart
  "2024-2,2024-05-02,1,Vente,300000,3,,RUE DE PARIS,2000,94220,94018,Charenton-le-Pont,94,,,94018000AC0002,,,12,58.5,13,,,,,,,,2,2,Appartement,60,3,,,,,,2.4123,48.8215",
  "2024-2,2024-05-02,1,Vente,300000,3,,RUE DE PARIS,2000,94220,94018,Charenton-le-Pont,94,,,94018000AC0002,,,13,,,,,,,,,,2,3,Dépendance,,0,,,,,,2.4123,48.8215",
  // VEFA -> exclu
  "2024-3,2024-06-02,1,Vente en l'état futur d'achèvement,500000,,,RUE X,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0003,,,,,,,,,,,,,1,2,Appartement,70,3,,,,,,2.4130,48.8220",
  // vente en bloc (3 apparts) -> exclu
  "2024-4,2024-07-02,1,Vente,900000,,,RUE Y,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0004,,,1,,,,,,,,,,3,2,Appartement,50,2,,,,,,2.4140,48.8230",
  "2024-4,2024-07-02,1,Vente,900000,,,RUE Y,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0004,,,2,,,,,,,,,,3,2,Appartement,55,2,,,,,,2.4140,48.8230",
  "2024-4,2024-07-02,1,Vente,900000,,,RUE Y,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0004,,,3,,,,,,,,,,3,2,Appartement,60,3,,,,,,2.4140,48.8230",
  // local commercial -> exclu
  "2024-5,2024-07-03,1,Vente,250000,,,RUE Z,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0005,,,,,,,,,,,,,1,4,Local industriel. commercial ou assimilé,80,0,,,,,,2.4150,48.8240",
  // terrain seul -> exclu
  "2024-6,2024-07-04,1,Vente,150000,,,RUE T,1,94220,94018,Charenton-le-Pont,94,,,94018000AC0006,,,,,,,,,,,,,0,,,,,T,terres,,,800,2.4160,48.8250",
  // champ avec virgule entre guillemets
  '2023-7,2023-01-15,1,Vente,280000,5,B,"RUE DE L\'EGLISE, PROLONGEE",3,94220,94018,Charenton-le-Pont,94,,,94018000AC0007,,,,,,,,,,,,,1,2,Appartement,40,2,,,,,,2.4124,48.8216'
];
const parsed = parseCSV([H, ...rows].join("\n"));
console.assert(parsed.length === rows.length, "parseCSV lignes", parsed.length);
console.assert(parsed[parsed.length - 1].adresse_nom_voie === "RUE DE L'EGLISE, PROLONGEE", "guillemets");

const sales = cleanMutations(parsed);
console.log(sales.map(s => `${s.id} ${s.type} ${s.surface}m² ${s.ppm2}€/m²`).join("\n"));
console.assert(sales.length === 3, "3 ventes attendues, obtenu " + sales.length);
const maison = sales.find(s => s.id === "2024-1");
console.assert(maison && maison.ppm2 === 4200 && maison.terrain === 250, "maison 4200 €/m²");
const app = sales.find(s => s.id === "2024-2");
console.assert(app && app.type === "Appartement" && app.ppm2 === 5000, "appart 5000 €/m²");

const a = analyse(sales, { lat: 48.8215, lon: 2.4123, radius: 500, type: "Appartement", months: 0 });
console.assert(a.stats.n === 2 && a.stats.median === 6000, "analyse médiane", a.stats);
console.assert(a.fragile === true, "fragile");
console.assert(dpeCoef("idf", "Maison", "G") === -0.14 && dpeCoef("fr", "Appartement", "A") === 0.16, "dpe");
console.log("OK — tests passés");
