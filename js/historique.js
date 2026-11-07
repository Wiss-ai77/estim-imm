/* historique.js — historique des demandes, stocké uniquement dans ce navigateur (localStorage). */
(function (global) {
  "use strict";
  const KEY = "estim.historique";
  const MAX = 300;
  let onReload = null;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; } }
  function save(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* stockage indisponible */ } }

  /** entry = { kind: "estimation"|"projet"|"trajet", titre, resume, params } */
  function add(entry) {
    const list = load();
    list.unshift(Object.assign({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: new Date().toISOString() }, entry));
    save(list); render();
  }
  function remove(id) { save(load().filter(e => e.id !== id)); render(); }
  function clear() { save([]); render(); }

  function toCSV() {
    const rows = [["date", "type", "titre", "resume", "parametres"]];
    for (const e of load()) rows.push([e.ts, e.kind, e.titre, e.resume, JSON.stringify(e.params || {})]);
    return rows.map(r => r.map(v => '"' + String(v ?? "").replace(/"/g, '""') + '"').join(";")).join("\r\n");
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + text], { type })); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const KIND = { estimation: "Estimation", projet: "Projet vente/achat", trajet: "Trajets" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render() {
    const tb = document.querySelector("#h-table tbody"); if (!tb) return;
    const list = load();
    document.getElementById("h-count").textContent = list.length ? `${list.length} demande${list.length > 1 ? "s" : ""} enregistrée${list.length > 1 ? "s" : ""} sur cet appareil` : "Aucune demande enregistrée pour l'instant.";
    tb.innerHTML = list.map(e => {
      const d = new Date(e.ts);
      return `<tr data-id="${e.id}">
        <td class="nowrap">${d.toLocaleDateString("fr-FR")}<br><small class="muted">${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</small></td>
        <td>${KIND[e.kind] || e.kind}</td>
        <td><b>${esc(e.titre)}</b><br><small class="muted">${esc(e.resume)}</small></td>
        <td class="nowrap"><button class="btn btn-secondary btn-sm" data-act="reload" type="button">Recharger</button> <button class="btn btn-secondary btn-sm" data-act="del" type="button" title="Supprimer">✕</button></td>
      </tr>`;
    }).join("");
  }

  function init() {
    const tb = document.querySelector("#h-table tbody"); if (!tb) return;
    tb.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]"); if (!b) return;
      const id = b.closest("tr").dataset.id, entry = load().find(x => x.id === id);
      if (b.dataset.act === "del") remove(id);
      else if (entry && onReload) onReload(entry);
    });
    document.getElementById("h-export").addEventListener("click", () => download("estim-immo-historique.csv", toCSV(), "text/csv;charset=utf-8"));
    document.getElementById("h-export-json").addEventListener("click", () => download("estim-immo-historique.json", JSON.stringify(load(), null, 1), "application/json"));
    document.getElementById("h-clear").addEventListener("click", () => {
      const btn = document.getElementById("h-clear");
      if (btn.dataset.confirm) { clear(); btn.textContent = "Tout effacer"; delete btn.dataset.confirm; }
      else { btn.dataset.confirm = "1"; btn.textContent = "Confirmer l'effacement"; setTimeout(() => { btn.textContent = "Tout effacer"; delete btn.dataset.confirm; }, 4000); }
    });
    render();
  }
  document.addEventListener("DOMContentLoaded", init);

  global.HISTORIQUE = { add, remove, clear, load, render, setReload: (fn) => { onReload = fn; } };
})(window);
