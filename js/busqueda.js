/* ═══════════════════════════════════════════════
   busqueda.js — Búsqueda universal del Inicio (dashboard)
   Consultas planas en paralelo (hasta BUSQ_LIMITE por entidad, con total
   exacto); se muestran 3 por sección y "Ver más (N)" expande. Filtradas
   por permisos (can). Entidades: clientes, viajes, pasajeros de
   viaje, pagos, recibos y egresos.
═══════════════════════════════════════════════ */

const BUSQ_MIN_CHARS = 2;
const BUSQ_LIMITE    = 30; // máx. traído por sección (el total real viene aparte)
const BUSQ_VISIBLES  = 3;  // resultados visibles por sección antes de "Ver más"
const BUSQ_DEBOUNCE  = 280;
const BUSQ_RECIENTES_KEY = "gt_busq_recientes";

let _busqTimer = null;
let _busqToken = 0;       // descarta respuestas viejas
let _busqItems = [];      // items planos navegables (para teclado)
let _busqActivo = -1;
let _busqUltima = null;          // { q, grupos } de la última búsqueda pintada
let _busqExpandidos = new Set(); // secciones con "Ver más" abierto

// Items con el total exacto de coincidencias (puede superar los traídos)
function _bConTotal(items, count) {
  items.total = count ?? items.length;
  return items;
}

function _bEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Texto seguro para usar dentro de un filtro .or() de PostgREST
function _bLimpiar(q) {
  return q.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}

function _bResaltar(texto, q) {
  const t = String(texto ?? "");
  if (!q) return _bEsc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return _bEsc(t);
  return _bEsc(t.slice(0, i)) + "<mark>" + _bEsc(t.slice(i, i + q.length)) + "</mark>" + _bEsc(t.slice(i + q.length));
}

function _bGs(n)  { return "Gs. " + Number(n || 0).toLocaleString("es-PY"); }
function _bFecha(f) {
  if (!f) return "";
  const d = new Date(String(f).slice(0, 10) + "T00:00:00");
  return isNaN(d) ? "" : d.toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" });
}

/* ── Definición de grupos ───────────────────── */
const _BUSQ_GRUPOS = [
  { key: "clientes",  titulo: "Clientes",  permiso: "clientes.ver",  buscar: _bBuscarClientes },
  { key: "viajes",    titulo: "Viajes",    permiso: "viajes.ver",    buscar: _bBuscarViajes },
  { key: "pasajeros", titulo: "Pasajeros en viajes", permiso: "viajes.ver", buscar: _bBuscarPasajerosViaje },
  { key: "pagos",     titulo: "Pagos",     permiso: "pagos.ver",     buscar: _bBuscarPagos },
  { key: "recibos",   titulo: "Recibos",   permiso: "recibos.ver",   buscar: _bBuscarRecibos },
  { key: "egresos",   titulo: "Egresos",   permiso: "egresos.ver",   buscar: _bBuscarEgresos },
];

/* ── Consultas ──────────────────────────────── */
async function _bBuscarClientes(q) {
  const { data, error, count } = await supabaseClient
    .from("pasajeros")
    .select(`id, Pasajero, "Documento de Identidad", "E-mail"`, { count: "exact" })
    .or(`Pasajero.ilike.%${q}%,"Documento de Identidad".ilike.%${q}%,"E-mail".ilike.%${q}%`)
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(p => ({
    titulo: p.Pasajero || "Sin nombre",
    sub: [p["Documento de Identidad"] && "CI " + p["Documento de Identidad"], p["E-mail"]].filter(Boolean).join(" · "),
    ir: () => navigateTo("detalle", p.id),
  })), count);
}

async function _bBuscarViajes(q) {
  const { data, error, count } = await supabaseClient
    .from("viajes")
    .select("id, nombre, fecha_salida, estado", { count: "exact" })
    .ilike("nombre", `%${q}%`)
    .order("fecha_salida", { ascending: false })
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(v => ({
    titulo: v.nombre || "Viaje",
    sub: _bFecha(v.fecha_salida),
    badge: v.estado || "",
    ir: () => navigateTo("viaje-detalle", v.id),
  })), count);
}

async function _bBuscarPasajerosViaje(q) {
  // 1) pasajeros que coinciden por nombre; 2) sus inscripciones a viajes
  const { data: ps, error: e1 } = await supabaseClient
    .from("pasajeros").select("id, Pasajero").ilike("Pasajero", `%${q}%`).limit(BUSQ_LIMITE);
  if (e1) throw e1;
  if (!ps?.length) return [];
  const nombres = new Map(ps.map(p => [p.id, p.Pasajero]));
  const { data, error, count } = await supabaseClient
    .from("viaje_pasajeros")
    .select("id, viaje_id, pasajero_id, viajes ( nombre, fecha_salida )", { count: "exact" })
    .in("pasajero_id", [...nombres.keys()])
    .order("id", { ascending: false })
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(vp => ({
    titulo: nombres.get(vp.pasajero_id) || "Pasajero",
    sub: vp.viajes?.nombre || "Viaje",
    badge: _bFecha(vp.viajes?.fecha_salida),
    ir: () => abrirPagosPasajero(vp.id, vp.viaje_id, vp.pasajero_id, nombres.get(vp.pasajero_id)),
  })), count);
}

async function _bBuscarPagos(q) {
  const num = parseInt(q.replace(/[.\s]/g, ""), 10);
  let filtro = `comprobante_nro.ilike.%${q}%,observacion.ilike.%${q}%`;
  if (!isNaN(num) && /^[\d.\s]+$/.test(q)) filtro += `,monto.eq.${num}`;
  const { data, error, count } = await supabaseClient
    .from("pagos")
    .select("id, monto, tipo, fecha_pago, comprobante_nro, observacion, viaje_pasajero_id, viaje_pasajeros ( viaje_id, pasajero_id, pasajeros ( Pasajero ) )", { count: "exact" })
    .or(filtro)
    .order("fecha_pago", { ascending: false })
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(p => {
    const vp = p.viaje_pasajeros;
    const nombre = vp?.pasajeros?.Pasajero || "";
    return {
      titulo: `${_bGs(p.monto)}${nombre ? " · " + nombre : ""}`,
      sub: [p.comprobante_nro && "Comp. " + p.comprobante_nro, _bFecha(p.fecha_pago)].filter(Boolean).join(" · "),
      badge: p.tipo || "",
      ir: () => vp
        ? abrirPagosPasajero(p.viaje_pasajero_id, vp.viaje_id, vp.pasajero_id, nombre)
        : showToast("No se pudo ubicar el pasajero de este pago", "warning"),
    };
  }), count);
}

async function _bBuscarRecibos(q) {
  const num = parseInt(q, 10);
  let filtro = `cliente.ilike.%${q}%,ci.ilike.%${q}%,concepto.ilike.%${q}%`;
  if (!isNaN(num) && /^\d+$/.test(q)) filtro += `,recibo_nro.eq.${num}`;
  const { data, error, count } = await supabaseClient
    .from("recibos")
    .select("id, recibo_nro, cliente, concepto, monto, moneda, fecha", { count: "exact" })
    .or(filtro)
    .order("fecha", { ascending: false })
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(r => ({
    titulo: `#${r.recibo_nro || r.id} · ${r.cliente || "—"}`,
    sub: [r.concepto, _bFecha(r.fecha)].filter(Boolean).join(" · "),
    badge: r.monto != null && typeof formatMontoRecibo === "function" ? formatMontoRecibo(r.monto, r.moneda) : "",
    ir: () => navigateTo("recibo-detalle", r.id),
  })), count);
}

async function _bBuscarEgresos(q) {
  const num = parseInt(q.replace(/[.\s]/g, ""), 10);
  let filtro = `descripcion.ilike.%${q}%,ejecutor.ilike.%${q}%`;
  if (!isNaN(num) && /^[\d.\s]+$/.test(q)) filtro += `,monto.eq.${num}`;
  const { data, error, count } = await supabaseClient
    .from("egresos")
    .select("id, viaje_id, monto, descripcion, fecha, ejecutor, viajes ( nombre )", { count: "exact" })
    .or(filtro)
    .order("fecha", { ascending: false })
    .limit(BUSQ_LIMITE);
  if (error) throw error;
  return _bConTotal((data || []).map(e => ({
    titulo: `${e.descripcion || "Egreso"} · ${_bGs(e.monto)}`,
    sub: [e.viajes?.nombre, _bFecha(e.fecha), e.ejecutor].filter(Boolean).join(" · "),
    ir: () => navigateTo("egreso-detalle", { egresoId: e.id, viajeId: e.viaje_id }),
  })), count);
}

/* ── Recientes ──────────────────────────────── */
function _bRecientes() {
  try { return JSON.parse(localStorage.getItem(BUSQ_RECIENTES_KEY)) || []; } catch { return []; }
}
function _bGuardarReciente(q) {
  if (!q) return;
  const lista = [q, ..._bRecientes().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  try { localStorage.setItem(BUSQ_RECIENTES_KEY, JSON.stringify(lista)); } catch {}
}

/* ── UI ─────────────────────────────────────── */
function _bPanel() { return document.getElementById("busq-panel"); }

function _bAbrirPanel()  { const p = _bPanel(); if (p) p.hidden = false; }
function cerrarBusquedaUniversal() {
  const p = _bPanel();
  if (p) p.hidden = true;
  _busqActivo = -1;
}

function _bPintarRecientes() {
  const p = _bPanel();
  const rec = _bRecientes();
  _busqItems = [];
  if (!rec.length) { p.innerHTML = `<div class="busq-vacio">Escribí al menos ${BUSQ_MIN_CHARS} letras para buscar clientes, viajes, pagos, recibos o egresos.</div>`; return; }
  p.innerHTML = `<div class="busq-grupo-titulo">Búsquedas recientes</div>` +
    rec.map(r => `<button type="button" class="busq-reciente" data-q="${_bEsc(r)}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${_bEsc(r)}</button>`).join("");
  p.querySelectorAll(".busq-reciente").forEach(b => b.addEventListener("click", () => {
    const inp = document.getElementById("busq-input");
    inp.value = b.dataset.q;
    document.getElementById("busq-clear").hidden = false;
    inp.focus();
    ejecutarBusquedaUniversal(b.dataset.q);
  }));
}

function _bPintarResultados(q, grupos) {
  const p = _bPanel();
  const scroll = p.scrollTop; // se conserva al expandir una sección
  _busqUltima = { q, grupos };
  _busqItems = [];
  let html = "";
  for (const g of grupos) {
    // Secciones con error o sin datos no se muestran
    if (g.error || !g.items.length) continue;
    const total = g.items.total ?? g.items.length;
    const expandido = _busqExpandidos.has(g.key);
    const visibles = expandido ? g.items : g.items.slice(0, BUSQ_VISIBLES);
    html += `<div class="busq-grupo-titulo"><span>${_bEsc(g.titulo)}</span><span class="busq-grupo-cant">${total}</span></div>`;
    for (const it of visibles) {
      const idx = _busqItems.push(it) - 1;
      html += `<button type="button" class="busq-item" data-i="${idx}">
        <span class="busq-item-main">
          <span class="busq-item-titulo">${_bResaltar(it.titulo, q)}</span>
          ${it.sub ? `<span class="busq-item-sub">${_bResaltar(it.sub, q)}</span>` : ""}
        </span>
        ${it.badge ? `<span class="busq-badge">${_bEsc(it.badge)}</span>` : ""}
      </button>`;
    }
    // 4.º lugar: "Ver más" con la cantidad de resultados que faltan mostrar
    if (!expandido && total > BUSQ_VISIBLES) {
      html += `<button type="button" class="busq-vermas" data-g="${_bEsc(g.key)}">Ver más (${total - BUSQ_VISIBLES})</button>`;
    }
  }
  if (!html) html = `<div class="busq-vacio">Sin resultados para “${_bEsc(q)}”</div>`;
  p.innerHTML = html;
  p.scrollTop = scroll;
  _busqActivo = -1;
  p.querySelectorAll(".busq-item").forEach(b => b.addEventListener("click", () => _bElegir(+b.dataset.i)));
  p.querySelectorAll(".busq-vermas").forEach(b => b.addEventListener("click", () => {
    _busqExpandidos.add(b.dataset.g);
    _bPintarResultados(_busqUltima.q, _busqUltima.grupos);
  }));
}

function _bElegir(i) {
  const it = _busqItems[i];
  if (!it) return;
  _bGuardarReciente(document.getElementById("busq-input")?.value.trim());
  cerrarBusquedaUniversal();
  it.ir();
}

function _bMarcarActivo(nuevo) {
  const els = _bPanel().querySelectorAll(".busq-item");
  if (!els.length) return;
  _busqActivo = (nuevo + els.length) % els.length;
  els.forEach((e, i) => e.classList.toggle("activo", i === _busqActivo));
  els[_busqActivo].scrollIntoView({ block: "nearest" });
}

async function ejecutarBusquedaUniversal(textoCrudo) {
  const q = _bLimpiar(textoCrudo || "");
  const p = _bPanel();
  _bAbrirPanel();
  if (q.length < BUSQ_MIN_CHARS) { _bPintarRecientes(); return; }

  const token = ++_busqToken;
  p.innerHTML = `<div class="busq-vacio">Buscando…</div>`;

  const habilitados = _BUSQ_GRUPOS.filter(g => can(g.permiso));
  const grupos = await Promise.all(habilitados.map(async g => {
    try { return { key: g.key, titulo: g.titulo, items: await g.buscar(q) }; }
    catch (e) { console.warn("Búsqueda:", g.key, e); return { key: g.key, titulo: g.titulo, items: [], error: true }; }
  }));
  if (token !== _busqToken) return; // llegó una búsqueda más nueva
  _busqExpandidos = new Set(); // búsqueda nueva: todas las secciones colapsadas
  _bPintarResultados(q, grupos);
}

function initBusquedaUniversal() {
  const inp = document.getElementById("busq-input");
  if (!inp || inp.dataset.listo) return;
  inp.dataset.listo = "1";

  const btnClear = document.getElementById("busq-clear");
  const syncClear = () => { if (btnClear) btnClear.hidden = !inp.value; };

  inp.addEventListener("input", () => {
    syncClear();
    clearTimeout(_busqTimer);
    _busqTimer = setTimeout(() => ejecutarBusquedaUniversal(inp.value), BUSQ_DEBOUNCE);
  });
  inp.addEventListener("focus", () => ejecutarBusquedaUniversal(inp.value));
  inp.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); _bMarcarActivo(_busqActivo + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); _bMarcarActivo(_busqActivo - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const act = _bPanel().querySelector(".busq-item.activo") || _bPanel().querySelector(".busq-item");
      if (act) _bElegir(+act.dataset.i);
    }
    else if (e.key === "Escape") { cerrarBusquedaUniversal(); inp.blur(); }
  });
  btnClear?.addEventListener("click", () => {
    inp.value = ""; syncClear(); inp.focus(); ejecutarBusquedaUniversal("");
  });
  document.addEventListener("mousedown", e => {
    if (!e.target.closest("#busq-wrap")) cerrarBusquedaUniversal();
  });
  // Atajo: "/" enfoca la búsqueda estando en el Inicio
  document.addEventListener("keydown", e => {
    if (typeof currentView === "undefined" || currentView !== "dashboard") return;
    const enCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === "/" && !enCampo) {
      e.preventDefault();
      inp.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initBusquedaUniversal);
