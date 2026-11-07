/* trajet.js — temps de trajet domicile → Paris (voiture / transports en commun)
 * - OSRM (OpenStreetMap, sans clé) pour la voiture sans trafic
 * - Google Routes API (clé facultative, trafic réel + transit)
 * - Île-de-France Mobilités PRIM / Navitia (clé facultative, transports en commun)
 * Les clés restent dans le navigateur (localStorage), jamais dans le code.
 */
(function (global) {
  "use strict";

  const DESTINATIONS = {
    chatelet: { label: "Châtelet – Les Halles (Paris centre)", lat: 48.8619, lon: 2.3470 },
    gdl: { label: "Gare de Lyon", lat: 48.8443, lon: 2.3737 },
    saintlazare: { label: "Gare Saint-Lazare", lat: 48.8766, lon: 2.3250 },
    defense: { label: "La Défense", lat: 48.8918, lon: 2.2380 },
    bercy: { label: "Bercy (ministère)", lat: 48.8390, lon: 2.3790 }
  };

  const KEYS = { google: "estim.googleKey", prim: "estim.primKey" };
  function getKey(name) { try { return localStorage.getItem(KEYS[name]) || ""; } catch { return ""; } }
  function setKey(name, v) { try { v ? localStorage.setItem(KEYS[name], v.trim()) : localStorage.removeItem(KEYS[name]); } catch { /* stockage indisponible */ } }

  /** Prochain jour ouvré à l'heure donnée (ex. "08:00") */
  function nextWeekday(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(); d.setSeconds(0, 0);
    d.setHours(h, m);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d;
  }

  const fmtMin = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
  const fmtKm = (m) => (m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " km";

  /* ---------- OSRM (voiture, sans trafic) ---------- */
  async function osrm(from, to) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("OSRM indisponible (" + r.status + ")");
    const j = await r.json();
    const route = j.routes && j.routes[0];
    if (!route) throw new Error("Aucun itinéraire routier trouvé");
    return { duration: route.duration, distance: route.distance, source: "OSRM / OpenStreetMap (sans trafic)" };
  }

  /* ---------- Google Routes API ---------- */
  async function googleRoute(from, to, mode, departure, key) {
    const body = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lon } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lon } } },
      travelMode: mode, // DRIVE | TRANSIT
      departureTime: departure.toISOString(),
      languageCode: "fr-FR", units: "METRIC"
    };
    if (mode === "DRIVE") body.routingPreference = "TRAFFIC_AWARE";
    if (mode === "TRANSIT") body.computeAlternativeRoutes = false;
    const fields = mode === "TRANSIT"
      ? "routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails.transitLine.nameShort,routes.legs.steps.transitDetails.transitLine.vehicle.type,routes.legs.steps.travelMode"
      : "routes.duration,routes.staticDuration,routes.distanceMeters";
    const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": fields },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const t = await r.text(); throw new Error("Google Routes : " + r.status + " " + t.slice(0, 160)); }
    const j = await r.json();
    const route = j.routes && j.routes[0];
    if (!route) throw new Error("Google : aucun itinéraire");
    const secs = parseFloat(String(route.duration).replace("s", ""));
    const out = { duration: secs, distance: route.distanceMeters, source: mode === "DRIVE" ? "Google Maps (trafic prévu à l'heure choisie)" : "Google Maps (transports)" };
    if (route.staticDuration) out.staticDuration = parseFloat(String(route.staticDuration).replace("s", ""));
    if (mode === "TRANSIT") {
      const lines = [];
      for (const leg of route.legs || []) for (const s of leg.steps || []) {
        const td = s.transitDetails; if (td && td.transitLine) lines.push(`${(td.transitLine.vehicle && td.transitLine.vehicle.type || "").replace("HEAVY_RAIL", "Train").replace("SUBWAY", "Métro").replace("BUS", "Bus").replace("TRAM", "Tram")} ${td.transitLine.nameShort || ""}`.trim());
      }
      out.lines = lines; out.changes = Math.max(0, lines.length - 1);
    }
    return out;
  }

  /* ---------- IDFM PRIM (Navitia) ---------- */
  async function primJourney(from, to, departure, key) {
    const dt = departure.getFullYear() + String(departure.getMonth() + 1).padStart(2, "0") + String(departure.getDate()).padStart(2, "0") + "T" + String(departure.getHours()).padStart(2, "0") + String(departure.getMinutes()).padStart(2, "0") + "00";
    const url = `https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys?from=${from.lon};${from.lat}&to=${to.lon};${to.lat}&datetime=${dt}&count=3`;
    const r = await fetch(url, { headers: { apikey: key, Accept: "application/json" } });
    if (!r.ok) { const t = await r.text(); throw new Error("IDFM PRIM : " + r.status + " " + t.slice(0, 160)); }
    const j = await r.json();
    const js = (j.journeys || []).slice().sort((a, b) => a.duration - b.duration);
    const best = js[0];
    if (!best) throw new Error("IDFM : aucun itinéraire");
    const lines = (best.sections || []).filter(s => s.type === "public_transport").map(s => `${(s.display_informations.commercial_mode || "")} ${s.display_informations.code || s.display_informations.label || ""}`.trim());
    return { duration: best.duration, lines, changes: best.nb_transfers, walking: best.durations && best.durations.walking, source: "Île-de-France Mobilités (horaires théoriques)" };
  }

  /* ---------- Liens externes (sans clé) ---------- */
  function links(from, to) {
    const o = `${from.lat},${from.lon}`, d = `${to.lat},${to.lon}`;
    return {
      gmapsTransit: `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=transit`,
      gmapsDrive: `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`,
      idfm: `https://www.iledefrance-mobilites.fr/itineraire/resultats?from=${from.lon};${from.lat}&to=${to.lon};${to.lat}`
    };
  }

  /**
   * Calcule voiture + transports pour un point d'origine.
   * @returns {Promise<{car, transit, links, departure, notes:string[]}>}
   */
  async function compute(from, to, departure) {
    const gKey = getKey("google"), pKey = getKey("prim");
    const notes = [];
    const car = gKey
      ? googleRoute(from, to, "DRIVE", departure, gKey).catch(e => { notes.push(e.message); return osrm(from, to); })
      : osrm(from, to);
    let transit;
    if (pKey) transit = primJourney(from, to, departure, pKey).catch(e => { notes.push(e.message); return gKey ? googleRoute(from, to, "TRANSIT", departure, gKey) : null; });
    else if (gKey) transit = googleRoute(from, to, "TRANSIT", departure, gKey).catch(e => { notes.push(e.message); return null; });
    else transit = Promise.resolve(null);
    const [c, t] = await Promise.all([car.catch(e => { notes.push(e.message); return null; }), transit]);
    return { car: c, transit: t, links: links(from, to), departure, notes };
  }

  global.TRAJET = { DESTINATIONS, compute, getKey, setKey, nextWeekday, fmtMin, fmtKm, links };
})(typeof window !== "undefined" ? window : globalThis);
