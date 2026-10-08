// =====================================================================
// encuesta-stats.js — Estadísticas y resumen de la vista "Encuesta".
// Usa _encData (cargado por loadEncuesta en encuesta.js) y alterna con el
// listado mediante el FAB. Sin librerías: barras con CSS.
// =====================================================================

let _encModo = "lista";   // "lista" | "stats"
let _encPeriodo = "todo"; // "todo" | "30" | "90"

const _ENC_ICON_STATS = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/></svg>`;
const _ENC_ICON_LISTA = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/></svg>`;

function toggleEncuestaStats() {
  _encModo = _encModo === "lista" ? "stats" : "lista";
  _encAplicarModo();
}

function _encAplicarModo() {
  const lista = document.getElementById("encuesta-list");
  const stats = document.getElementById("encuesta-stats");
  const fab = document.getElementById("encuesta-fab");
  if (!lista || !stats) return;
  const enStats = _encModo === "stats";
  lista.style.display = enStats ? "none" : "";
  stats.style.display = enStats ? "" : "none";
  if (fab) {
    fab.setAttribute("aria-label", enStats ? "Ver respuestas" : "Ver estadísticas");
    fab.innerHTML = enStats ? _ENC_ICON_LISTA : _ENC_ICON_STATS;
  }
  if (enStats) renderEncuestaStats();
  window.scrollTo({ top: 0 });
}

function setEncuestaPeriodo(p) {
  _encPeriodo = p;
  renderEncuestaStats();
}

function _encFiltradas() {
  if (_encPeriodo === "todo") return _encData;
  const desde = Date.now() - Number(_encPeriodo) * 86400000;
  return _encData.filter(r => new Date(r.submitted_at).getTime() >= desde);
}

// Cuenta ocurrencias de una columna (array o texto) -> [[opción, n], ...] desc
function _encConteo(rows, col) {
  const m = new Map();
  rows.forEach(r => {
    const v = r[col];
    if (v == null || v === "") return;
    (Array.isArray(v) ? v : [v]).forEach(x => {
      const k = String(x).trim();
      if (k) m.set(k, (m.get(k) || 0) + 1);
    });
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const _ENC_STOP = new Set(("para como pero esta este esto estos estas porque cuando donde tambien también sobre entre desde hasta todo todos toda todas nada algo otro otra otros otras muy mucho muchos mucha muchas poco tiene tienen tener hace hacen hacer siempre bien ser son fue sido está están estar nos nuestro nuestra nuestros nuestras sus les los las del una unos unas que con por sin más mas ya hay han sea van vez").split(" "));

function _encPalabras(rows, cols, top = 12) {
  const m = new Map();
  rows.forEach(r => cols.forEach(c => {
    String(r[c] || "").toLowerCase().split(/[^a-záéíóúñü]+/).forEach(w => {
      if (w.length < 4 || _ENC_STOP.has(w)) return;
      m.set(w, (m.get(w) || 0) + 1);
    });
  }));
  return [...m.entries()].filter(e => e[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, top);
}

function _encBarras(titulo, pares, total) {
  if (!pares.length) return "";
  const max = pares[0][1];
  const filas = pares.slice(0, 8).map(([k, n]) => {
    const pct = total ? Math.round(n / total * 100) : 0;
    return `<div class="enc-bar-row">
      <div class="enc-bar-top"><span class="enc-bar-label">${_escEnc(k)}</span><span class="enc-bar-n">${n} · ${pct}%</span></div>
      <div class="enc-bar-track"><div class="enc-bar-fill" style="width:${max ? n / max * 100 : 0}%"></div></div>
    </div>`;
  }).join("");
  return `<section class="enc-stat-card"><h3>${_escEnc(titulo)}</h3>${filas}</section>`;
}

function renderEncuestaStats() {
  const el = document.getElementById("encuesta-stats");
  if (!el) return;
  const rows = _encFiltradas();
  const total = rows.length;
  const chip = (v, t) => `<button type="button" class="enc-chipbtn${_encPeriodo === v ? " active" : ""}" onclick="setEncuestaPeriodo('${v}')">${t}</button>`;
  const filtro = `<div class="enc-filtros">${chip("todo", "Todo")}${chip("90", "90 días")}${chip("30", "30 días")}
    <button type="button" class="enc-btn enc-btn-sec enc-export" onclick="exportarEncuestaCSV()">Exportar CSV</button></div>`;

  if (!total) {
    el.innerHTML = filtro + `<p class="enc-empty">No hay respuestas en este período.</p>`;
    return;
  }

  // KPIs
  const probs = rows.map(r => r.probabilidad_volver).filter(v => typeof v === "number");
  const prom = probs.length ? probs.reduce((a, b) => a + b, 0) / probs.length : null;
  const pctFav = probs.length ? Math.round(probs.filter(v => v >= 4).length / probs.length * 100) : null;
  const riesgo = probs.filter(v => v <= 2).length;
  const hace30 = Date.now() - 30 * 86400000;
  const ult30 = rows.filter(r => new Date(r.submitted_at).getTime() >= hace30).length;
  const ultima = new Date(rows[0].submitted_at).toLocaleDateString("es-PY", { dateStyle: "medium" });
  const kpi = (n, l, sub) => `<div class="enc-kpi"><div class="enc-kpi-n">${n}</div><div class="enc-kpi-l">${l}</div><div class="enc-kpi-s">${sub}</div></div>`;
  const kpis = `<div class="enc-kpis">
    ${kpi(total, "Respuestas", `${ult30} en los últimos 30 días`)}
    ${kpi(prom != null ? prom.toFixed(1) + " ★" : "–", "Prob. de volver", "promedio sobre 5")}
    ${kpi(pctFav != null ? pctFav + "%" : "–", "Favorables", "puntúan 4 o 5")}
    ${kpi(riesgo, "En riesgo", "puntúan 1 o 2")}
  </div>`;

  // Distribución de estrellas
  const dist = [5, 4, 3, 2, 1].map(e => ["★".repeat(e) + "☆".repeat(5 - e), probs.filter(v => v === e).length]);
  const maxDist = Math.max(...dist.map(d => d[1]), 1);
  const estrellas = `<section class="enc-stat-card"><h3>Probabilidad de volver</h3>${dist.map(([k, n]) => {
    const pct = probs.length ? Math.round(n / probs.length * 100) : 0;
    return `<div class="enc-bar-row"><div class="enc-bar-top"><span class="enc-bar-label enc-stars">${k}</span><span class="enc-bar-n">${n} · ${pct}%</span></div>
      <div class="enc-bar-track"><div class="enc-bar-fill enc-fill-gold" style="width:${n / maxDist * 100}%"></div></div></div>`;
  }).join("")}</section>`;

  // Promedio de "volver" según si sigue viajando
  const grupos = new Map();
  rows.forEach(r => {
    if (!r.sigue_viajando || typeof r.probabilidad_volver !== "number") return;
    const g = grupos.get(r.sigue_viajando) || [];
    g.push(r.probabilidad_volver);
    grupos.set(r.sigue_viajando, g);
  });
  const cruce = grupos.size ? `<section class="enc-stat-card"><h3>Prob. de volver según si sigue viajando</h3>${
    [...grupos.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, arr]) => {
      const p = arr.reduce((a, b) => a + b, 0) / arr.length;
      return `<div class="enc-bar-row"><div class="enc-bar-top"><span class="enc-bar-label">${_escEnc(k)}</span><span class="enc-bar-n">${p.toFixed(1)} ★ · ${arr.length} resp.</span></div>
        <div class="enc-bar-track"><div class="enc-bar-fill enc-fill-gold" style="width:${p / 5 * 100}%"></div></div></div>`;
    }).join("")}</section>` : "";

  // Respuestas por mes (últimos 6 con datos)
  const porMes = new Map();
  rows.forEach(r => {
    const d = new Date(r.submitted_at);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    porMes.set(k, (porMes.get(k) || 0) + 1);
  });
  const meses = [...porMes.entries()].sort().slice(-6);
  const maxMes = Math.max(...meses.map(m => m[1]), 1);
  const nombreMes = k => new Date(k + "-15T12:00:00").toLocaleDateString("es-PY", { month: "short" }).replace(".", "");
  const evolucion = `<section class="enc-stat-card"><h3>Respuestas por mes</h3><div class="enc-cols">${meses.map(([k, n]) =>
    `<div class="enc-col"><span class="enc-col-n">${n}</span><div class="enc-col-bar" style="height:${Math.max(6, n / maxMes * 90)}px"></div><span class="enc-col-l">${_escEnc(nombreMes(k))}</span></div>`).join("")}</div></section>`;

  // Preguntas de opción
  const bloques = [
    _encBarras("¿Sigue viajando?", _encConteo(rows, "sigue_viajando"), total),
    _encBarras("Lo que más valoran", _encConteo(rows, "lo_que_valora"), total),
    _encBarras("Motivo por el que viajan menos", _encConteo(rows, "motivo_viaja_menos"), total),
    _encBarras("Factores de decisión", _encConteo(rows, "factores_decision"), total),
    _encBarras("Experiencias deseadas", _encConteo(rows, "experiencias_deseadas"), total),
    _encBarras("Qué tendría que darse para volver", _encConteo(rows, "que_tendria_que_darse"), total),
  ].join("");

  // Texto libre
  const palabras = _encPalabras(rows, ["que_hace_bien", "que_mejorar"]);
  const nube = palabras.length ? `<section class="enc-stat-card"><h3>Palabras más mencionadas</h3><div>${palabras.map(([w, n]) =>
    `<span class="enc-chip">${_escEnc(w)} <b>${n}</b></span>`).join("")}</div></section>` : "";
  const comentarios = (col, titulo) => {
    const items = rows.filter(r => r[col] && String(r[col]).trim()).slice(0, 5);
    if (!items.length) return "";
    return `<section class="enc-stat-card"><h3>${titulo}</h3>${items.map(r =>
      `<blockquote class="enc-quote">${_escEnc(r[col])}<footer>${_escEnc(new Date(r.submitted_at).toLocaleDateString("es-PY", { dateStyle: "medium" }))}${typeof r.probabilidad_volver === "number" ? " · " + r.probabilidad_volver + " ★" : ""}</footer></blockquote>`).join("")}</section>`;
  };

  el.innerHTML = filtro + `<p class="enc-ultima">Última respuesta: ${_escEnc(ultima)}</p>` + kpis +
    `<div class="enc-grid">${estrellas}${cruce}${evolucion}${bloques}${nube}${comentarios("que_mejorar", "Qué mejorar (recientes)")}${comentarios("que_hace_bien", "Lo que hacemos bien (recientes)")}</div>`;
}

function exportarEncuestaCSV() {
  const rows = _encFiltradas();
  if (!rows.length) { showToast("No hay datos para exportar"); return; }
  const cols = [["submitted_at", "Fecha"], ...ENCUESTA_CAMPOS];
  const esc = v => `"${String(Array.isArray(v) ? v.join("; ") : (v ?? "")).replace(/"/g, '""')}"`;
  const csv = [cols.map(c => esc(c[1])).join(",")]
    .concat(rows.map(r => cols.map(c => esc(r[c[0]])).join(","))).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = `encuesta_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
