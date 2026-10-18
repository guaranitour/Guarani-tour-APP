/* ═══════════════════════════════════════════════
   pagos.js — Pagos de un pasajero en un viaje
   Sin joins: todas las queries son planas
═══════════════════════════════════════════════ */

let pagosCtx = {
  viajePasajeroId : null,
  viajeId         : null,
  pasajeroId      : null,
  nombrePasajero  : null,
  totalAPagar     : 0,
  metodos         : [],   // { id, metodo_de_pago }
  bancos          : [],   // { id, banco_id }
  extrasAsignados     : [],   // servicio_extra_pasajeros de este viaje_pasajero (con datos del servicio)
  extrasDisponibles   : [],   // servicios_extra del viaje aún no asignados a este pasajero
  extraElegido        : null, // { id, nombre, precio_venta } seleccionado en el modal, previo a confirmar
};

/* ── ENTRAR A LA VISTA ──────────────────────── */
function abrirPagosPasajero(viajePasajeroId, viajeId, pasajeroId, nombrePasajero) {
  pagosCtx.viajePasajeroId = viajePasajeroId;
  pagosCtx.viajeId         = viajeId;
  pagosCtx.pasajeroId      = pasajeroId;
  pagosCtx.nombrePasajero  = nombrePasajero;
  navigateTo("viaje-pasajero-pagos", { viajePasajeroId, viajeId, pasajeroId, nombrePasajero });
}

/* ── REEMPLAZAR PASAJERO ────────────────────────
   Lleva a la pantalla de alta de pasajero, pero en
   "modo reemplazo": el nuevo alta queda vinculado al
   viaje_pasajero de origen (pagosCtx.viajePasajeroId)
   vía reemplazoCtx, que lee guardarPasajeroEnViaje().
─────────────────────────────────────────────── */
function iniciarReemplazoPasajero() {
  if (!can("viaje_pasajeros.reemplazar")) return;
  if (!pagosCtx.viajePasajeroId) {
    showToast("No hay pasajero seleccionado", "error");
    return;
  }

  reemplazoCtx.activo               = true;
  reemplazoCtx.viajePasajeroOrigenId = pagosCtx.viajePasajeroId;
  reemplazoCtx.viajeId               = pagosCtx.viajeId;
  reemplazoCtx.nombreOrigen          = pagosCtx.nombrePasajero;

  navigateTo("viaje-pasajero-nuevo", pagosCtx.viajeId);
}

/* ── INICIALIZAR VISTA ──────────────────────── */
async function initPagosView(ctx) {
  Object.assign(pagosCtx, ctx);

  const titulo = document.getElementById("pagos-pasajero-titulo");
  if (titulo) titulo.textContent = ctx.nombrePasajero || "Pagos";

  ocultarFormPago();

  // Reemplazar pasajero: por tarea (sql/permisos_viajes.sql)
  const btnReemplazar = document.getElementById("btn-reemplazar-pasajero");
  if (btnReemplazar) btnReemplazar.style.display = can("viaje_pasajeros.reemplazar") ? "" : "none";

  // ── Cargar métodos y bancos desde caché global (en paralelo) ──
  [pagosCtx.metodos, pagosCtx.bancos] = await Promise.all([
    getMetodosPago(),
    getBancos(),
  ]);

  // Poblar select métodos
  const selMetodo = document.getElementById("pago-metodo");
  if (selMetodo) {
    selMetodo.innerHTML = pagosCtx.metodos
      .map(m => `<option value="${m.id}">${m.metodo_de_pago}</option>`)
      .join("");
    selMetodo.removeEventListener("change", onMetodoChange);
    selMetodo.addEventListener("change", onMetodoChange);
    onMetodoChange();
    initCustomSelect("pago-metodo");
    initCustomSelect("pago-tipo");
  }

  // Bancos: se manejan via filtrarBancos(), solo limpiar input
  const bancoInput = document.getElementById("pago-banco-input");
  if (bancoInput) bancoInput.value = "";
  const bancoHidden = document.getElementById("pago-banco");
  if (bancoHidden) bancoHidden.value = "";

  await loadPagosPasajero();

  // Viene del botón "Editar" del detalle del pago
  if (pagosCtx.pagoPorEditar) {
    const p = pagosCtx.pagoPorEditar;
    pagosCtx.pagoPorEditar = null;
    await _prepararEdicionPago(p);
  }
}

/* ── BÚSQUEDA DE BANCO ──────────────────────── */
let _ignorarFiltro = false;

function filtrarBancos() {
  if (_ignorarFiltro) { _ignorarFiltro = false; return; }
  const input    = document.getElementById("pago-banco-input");
  const hidden   = document.getElementById("pago-banco");
  const dropdown = document.getElementById("banco-dropdown");
  if (!input || !dropdown) return;

  const q = input.value.toLowerCase().trim();
  hidden.value = "";

  if (!q) { dropdown.innerHTML = ""; dropdown.style.display = "none"; return; }

  const matches = pagosCtx.bancos.filter(b =>
    b.banco_id.toLowerCase().includes(q)
  ).slice(0, 8);

  if (matches.length === 0) {
    dropdown.innerHTML = `<div class="banco-dropdown-empty">Sin resultados</div>`;
    dropdown.style.display = "block";
    return;
  }

  dropdown.innerHTML = matches.map(b =>
    `<div class="banco-option"
      onmousedown="event.preventDefault();"
      ontouchend="event.preventDefault(); seleccionarBancoPago(${b.id}, '${b.banco_id.replace(/'/g, "\\'")}');"
      onclick="seleccionarBancoPago(${b.id}, '${b.banco_id.replace(/'/g, "\\'")}')">
      ${b.banco_id}
    </div>`
  ).join("");
  dropdown.style.display = "block";

  input.onblur = () => {
    setTimeout(() => {
      if (_ignorarFiltro) return;
      const dd = document.getElementById("banco-dropdown");
      if (dd) { dd.innerHTML = ""; dd.style.display = "none"; }
    }, 300);
  };
}

function seleccionarBancoPago(id, nombre) {
  _ignorarFiltro = true;
  document.getElementById("pago-banco").value       = id;
  document.getElementById("pago-banco-input").value = nombre;
  const dropdown = document.getElementById("banco-dropdown");
  if (dropdown) { dropdown.innerHTML = ""; dropdown.style.display = "none"; }
}

// Cerrar dropdown al hacer click afuera
document.addEventListener("click", e => {
  if (!e.target.closest(".banco-search-wrap") && !e.target.closest("#banco-dropdown")) {
    const dd = document.getElementById("banco-dropdown");
    if (dd) { dd.innerHTML = ""; dd.style.display = "none"; }
  }
});

/* ── MOSTRAR BANCO Y COMPROBANTE SOLO PARA UENO ── */
function onMetodoChange() {
  const sel  = document.getElementById("pago-metodo");
  if (!sel) return;
  const texto = sel.options[sel.selectedIndex]?.text?.toUpperCase() || "";
  const esUeno = texto.includes("UENO");

  const wrapBanco  = document.getElementById("pago-banco-wrap");
  const wrapComp   = document.getElementById("pago-comprobante-wrap");
  const wrapFoto   = document.getElementById("pago-foto-wrap");

  if (wrapBanco) wrapBanco.style.display = esUeno ? "block" : "none";
  if (wrapComp)  wrapComp.style.display  = esUeno ? "block" : "none";
  if (wrapFoto)  wrapFoto.style.display  = esUeno ? "block" : "none";
}

/* ── CARGAR PAGOS ───────────────────────────── */
async function loadPagosPasajero() {
  const listEl    = document.getElementById("pagos-list");
  const resumenEl = document.getElementById("pagos-resumen");
  if (!listEl) return;

  listEl.innerHTML = `<div class="pagos-loading">Cargando…</div>`;

  // Etapa 1: total a pagar y lista de pagos no dependen entre sí → en paralelo
  const [
    { data: vp },
    { data: pagos, error },
  ] = await Promise.all([
    supabaseClient
      .from("viaje_pasajeros")
      .select("total_a_pagar, puntos_destino, asistencia, pasajero_id")
      .eq("id", parseInt(pagosCtx.viajePasajeroId))
      .single(),
    supabaseClient
      .from("pagos")
      .select("id, monto, tipo, fecha_pago, comprobante_nro, observacion, foto_storage_key, creado_por, banco, metodo_pago_id, referencia_pago_id, ref_origen")
      .eq("viaje_pasajero_id", parseInt(pagosCtx.viajePasajeroId))
      .order("fecha_pago", { ascending: false }),
  ]);

  pagosCtx.totalAPagar = vp?.total_a_pagar || 0;

  if (error) {
    listEl.innerHTML = `<div class="pagos-empty">Error al cargar pagos</div>`;
    console.error("Error pagos:", error);
    return;
  }

  // Servicios extra asignados a este pasajero (no afectan total_a_pagar en DB,
  // se suman en memoria para el cálculo de saldo mostrado en pantalla)
  await loadExtrasPasajero();
  const totalExtras = pagosCtx.extrasAsignados.reduce((s, e) => s + (e.precio_venta_real || 0), 0);
  const totalConExtras = pagosCtx.totalAPagar + totalExtras;

  // Etapa 2: membresía Club Destino depende de pasajero_id (recién disponible tras la etapa 1)
  let esMiembro = false;
  let puntosViaje = vp?.puntos_destino || 0;
  if (vp?.pasajero_id) {
    const { data: historial } = await supabaseClient
      .from("viaje_pasajeros")
      .select("id")
      .eq("pasajero_id", vp.pasajero_id)
      .eq("asistencia", "Asiste");
    esMiembro = (historial || []).length >= 3;
  }

  // Totales
  let totalPagado = 0, totalDevuelto = 0, totalTransferido = 0;
  (pagos || []).forEach(p => {
    if (p.tipo === "Pago")          totalPagado      += p.monto || 0;
    if (p.tipo === "Devolución")    totalDevuelto    += p.monto || 0;
    if (p.tipo === "Transferencia") totalTransferido += p.monto || 0;
  });

  const neto  = totalPagado - totalDevuelto - totalTransferido;
  const esCanje = totalConExtras === 0;
  const saldo = esCanje ? -neto : totalConExtras - neto;
  const pct   = (!esCanje && totalConExtras > 0)
    ? Math.min(100, Math.round((neto / totalConExtras) * 100)) : 0;

  // Estado del saldo: excedente / saldado / canje / pendiente
  let saldoClase, saldoLabel, saldoValor;
  if (esCanje && neto > 0) {
    // Canje con pagos registrados (excedente)
    saldoClase = "excedente";
    saldoLabel = "⚠️ Excedente";
    saldoValor = "Gs. " + neto.toLocaleString("es-PY");
  } else if (esCanje) {
    saldoClase = "saldado";
    saldoLabel = "🔄 Canje";
    saldoValor = "—";
  } else if (saldo < 0) {
    saldoClase = "excedente";
    saldoLabel = "⚠️ Excedente";
    saldoValor = "Gs. " + Math.abs(saldo).toLocaleString("es-PY");
  } else if (saldo === 0) {
    saldoClase = "saldado";
    saldoLabel = "✅ Saldado";
    saldoValor = "—";
  } else {
    saldoClase = "pendiente";
    saldoLabel = "Saldo pendiente";
    saldoValor = "Gs. " + saldo.toLocaleString("es-PY");
  }

  // Resumen
  resumenEl.innerHTML = `
    <div class="pagos-resumen-grid">
      <div class="pagos-resumen-item">
        <span class="pr-label">Total a pagar</span>
        <span class="pr-value">${esCanje ? "Canje" : "Gs. " + totalConExtras.toLocaleString("es-PY")}</span>
      </div>
      <div class="pagos-resumen-item pagado">
        <span class="pr-label">Pagado</span>
        <span class="pr-value">Gs. ${neto.toLocaleString("es-PY")}</span>
      </div>
      <div class="pagos-resumen-item ${saldoClase}">
        <span class="pr-label">${saldoLabel}</span>
        <span class="pr-value">${saldoValor}</span>
      </div>
    </div>
    <div class="pagos-progress-wrap">
      <div class="pagos-progress-bar">
        <div class="pagos-progress-fill ${pct >= 100 ? "completo" : ""}" style="width:${pct}%"></div>
      </div>
      <span class="pagos-pct">${pct}%</span>
    </div>
    <div class="pagos-club-row">
      ${esMiembro
        ? `<span class="pagos-club-badge miembro">⭐ Club Destino</span>
           <span class="pagos-puntos-badge">+${puntosViaje} pts${vp?.asistencia === "No asiste" ? " (sin puntos — No asiste)" : ""}</span>`
        : `<span class="pagos-club-badge no-miembro">Sin membresía Club Destino</span>`
      }
    </div>`;

  if (!pagos || pagos.length === 0) {
    listEl.innerHTML = `
      <div class="pagos-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Sin pagos registrados
      </div>`;
    return;
  }

  // Resolver nombres desde caché local (sin join)
  const metodosMap = Object.fromEntries(pagosCtx.metodos.map(m => [String(m.id), m.metodo_de_pago]));
  const bancosMap  = Object.fromEntries(pagosCtx.bancos.map(b => [String(b.id), b.banco_id]));

  const tipoCls  = { "Pago": "tipo-pago", "Devolución": "tipo-devolucion", "Transferencia": "tipo-transferencia" };
  const tipoIcon = {
    "Pago":          `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    "Devolución":    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 18 4 12 10 12"/><path d="M20 12a8 8 0 0 0-8-8 8 8 0 0 0-5.66 2.34L4 12"/></svg>`,
    "Transferencia": `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/><path d="M6 8L2 12L6 16"/></svg>`,
  };

  listEl.innerHTML = pagos.map(p => {
    const fecha  = p.fecha_pago ? new Date(p.fecha_pago + "T00:00:00").toLocaleDateString("es-PY") : "—";
    const metodo = metodosMap[String(p.metodo_pago_id)] || "—";
    const banco  = bancosMap[String(p.banco)] || "";
    const cls    = tipoCls[p.tipo] || "";
    const icon   = tipoIcon[p.tipo] || "";
    const pagoData = encodeURIComponent(JSON.stringify({
      id: p.id, tipo: p.tipo, monto: p.monto, fecha_pago: p.fecha_pago,
      metodo, banco, comprobante_nro: p.comprobante_nro,
      observacion: p.observacion, creado_por: p.creado_por,
      foto_storage_key: p.foto_storage_key,
      metodo_pago_id: p.metodo_pago_id, banco_id: p.banco,
      referencia_pago_id: p.referencia_pago_id, ref_origen: p.ref_origen
    }));
    return `
    <div class="pago-row" onclick="abrirDetallePago(JSON.parse(decodeURIComponent('${pagoData}')))">
      <div class="pago-row-izq">
        <span class="pago-tipo-badge ${cls}">${icon} ${p.tipo}</span>
        <span class="pago-fecha">${fecha}</span>
      </div>
      <span class="pago-monto ${cls}">Gs. ${(p.monto || 0).toLocaleString("es-PY")}</span>
      <svg class="pago-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join("");
}

/* ── MOSTRAR / OCULTAR FORM ─────────────────── */

// Sincroniza el "chip" de archivo (ícono + nombre truncado + botón
// quitar) con el archivo realmente elegido en el <input type="file">
// oculto (ver .file-chip en pagos.css). Sin esto, en pantallas angostas
// no hay forma de saber si el usuario ya adjuntó un comprobante: el
// nombre que muestra el navegador dentro del input nativo se recorta.
function _actualizarNombreArchivo(inputId, nombreElId) {
  const input  = document.getElementById(inputId);
  const nombreEl = document.getElementById(nombreElId);
  const chipEl = nombreEl?.closest(".file-chip");
  if (!input || !nombreEl) return;
  const archivo = input.files?.[0];
  if (archivo) {
    nombreEl.textContent = archivo.name;
    nombreEl.title = archivo.name; // nombre completo al mantener presionado / hover
    if (chipEl) chipEl.hidden = false;
  } else {
    nombreEl.textContent = "";
    nombreEl.removeAttribute("title");
    if (chipEl) chipEl.hidden = true;
  }
}

// El input es parte del HTML estático (no se recrea con innerHTML), así
// que un único listener alcanza para toda la vida de la página.
document.getElementById("pago-foto")?.addEventListener("change", () => {
  _actualizarNombreArchivo("pago-foto", "pago-foto-nombre");
});

// Botón "✕" del chip: limpia el input sin reabrir el selector de archivos.
document.getElementById("pago-foto-quitar")?.addEventListener("click", () => {
  const input = document.getElementById("pago-foto");
  if (input) input.value = "";
  _actualizarNombreArchivo("pago-foto", "pago-foto-nombre");
});

// Formatea el input de monto con puntos de miles mientras se escribe
// (ej: 1.660.000). Es solo visual: el valor real (sin puntos) se obtiene
// con _leerMontoInput() al leer/guardar, así que en la BD sigue llegando
// el número tal cual, sin puntos.
function _formatearInputMiles(el) {
  const soloDigitos = el.value.replace(/\D/g, "");
  const posCursorDesdeElFinal = el.value.length - el.selectionStart;
  el.value = soloDigitos === "" ? "" : Number(soloDigitos).toLocaleString("es-PY");
  const nuevaPos = Math.max(0, el.value.length - posCursorDesdeElFinal);
  el.setSelectionRange(nuevaPos, nuevaPos);
}
document.getElementById("pago-monto")?.addEventListener("input", (e) => _formatearInputMiles(e.target));

// Lee un input formateado con puntos de miles y devuelve el número limpio
// (o NaN si está vacío/ inválido), listo para guardar en la BD sin puntos.
function _leerMontoInput(id) {
  const raw = (document.getElementById(id)?.value || "").replace(/\D/g, "");
  return raw === "" ? NaN : parseInt(raw, 10);
}

function mostrarFormPago() {
  if (!can("pagos.registrar")) return;
  _abrirFormPago();
}

// Abre el formulario limpio, en modo alta. _prepararEdicionPago() lo reutiliza.
function _abrirFormPago() {
  _resetModoEdicionPago();
  ["pago-monto","pago-comprobante","pago-observacion"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const fotoEl  = document.getElementById("pago-foto");
  if (fotoEl) fotoEl.value = "";
  _actualizarNombreArchivo("pago-foto", "pago-foto-nombre");
  const bancoInput = document.getElementById("pago-banco-input");
  if (bancoInput) bancoInput.value = "";
  const bancoHidden = document.getElementById("pago-banco");
  if (bancoHidden) bancoHidden.value = "";
  const bancoDd = document.getElementById("banco-dropdown");
  if (bancoDd) { bancoDd.innerHTML = ""; bancoDd.style.display = "none"; }
  const fechaEl = document.getElementById("pago-fecha");
  if (fechaEl) fechaEl.value = new Date().toISOString().split("T")[0];
  const tipoEl  = document.getElementById("pago-tipo");
  if (tipoEl) { tipoEl.value = "Pago"; refreshCustomSelect("pago-tipo"); }
  // Método predeterminado: UENO OSCAR (se busca por nombre, no por id)
  const metodoEl = document.getElementById("pago-metodo");
  const metodoPorDefecto = (pagosCtx.metodos || []).find(m => (m.metodo_de_pago || "").trim().toUpperCase() === "UENO OSCAR");
  if (metodoEl && metodoPorDefecto) {
    metodoEl.value = String(metodoPorDefecto.id);
    refreshCustomSelect("pago-metodo");
  }
  onMetodoChange();
  document.getElementById("form-nuevo-pago").style.display = "";
  document.getElementById("btn-nuevo-pago").style.display  = "none";
}

function ocultarFormPago() {
  _formPagoALaLista(); // si estaba prestado al detalle (edición), lo devuelve
  const form = document.getElementById("form-nuevo-pago");
  const btn  = document.getElementById("btn-nuevo-pago");
  if (form) form.style.display = "none";
  _resetModoEdicionPago();
  // Botón "Registrar pago": por tarea (sql/permisos_pagos.sql)
  if (btn) btn.style.display = can("pagos.registrar") ? "" : "none";
}

/* ── COMPROBANTES EN R2 (vía Worker) ────────── */
// Los archivos viven en R2 detrás del mismo Worker que usa Facturas. Llave:
// pagos/{viajeId}/{timestamp}.{ext}. El Worker exige pagos.registrar para
// subir, pagos.comprobante_ver para ver y pagos.editar para borrar.
const PAGOS_WORKER_URL = "https://storage.guaranitour.com";

async function _pagosJwt() {
  const { data } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sesión no disponible");
  return token;
}

async function _pagosWorkerFetch(key, opciones = {}) {
  const jwt = await _pagosJwt();
  return fetch(`${PAGOS_WORKER_URL}/${encodeURIComponent(key)}`, {
    ...opciones,
    headers: { ...(opciones.headers || {}), Authorization: `Bearer ${jwt}` },
  });
}

// Devuelve la llave del objeto en R2
async function subirFotoComprobante(fileOriginal) {
  const file = await _optimizarComprobante(fileOriginal);
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const key = `pagos/${pagosCtx.viajeId}/${Date.now()}.${ext}`;
  const res = await _pagosWorkerFetch(key, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return key;
}

// Mejor esfuerzo: si falla queda un archivo huérfano en R2, pero el pago
// ya está guardado y no se debe revertir por eso.
async function _pagosEliminarArchivo(key) {
  if (!key) return;
  try {
    const res = await _pagosWorkerFetch(key, { method: "DELETE" });
    if (!res.ok) console.warn("No se pudo borrar el comprobante anterior:", key, res.status);
  } catch (e) {
    console.warn("No se pudo borrar el comprobante anterior:", key, e);
  }
}

/* ── GUARDAR PAGO (alta o edición) ──────────── */
const _SVG_CHECK_BTN = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;

function _pintarBtnGuardarPago() {
  const btn = document.getElementById("btn-guardar-pago");
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `${_SVG_CHECK_BTN} ${pagosCtx.pagoEditando ? "Guardar cambios" : "Registrar pago"}`;
}

async function guardarPago() {
  const editando = pagosCtx.pagoEditando;
  if (!can(editando ? "pagos.editar" : "pagos.registrar")) return; // guarda extra, RLS igual lo bloquearía

  // Un pago ligado a una transferencia conserva monto, tipo y método
  const ligada   = !!(editando && pagosCtx.edicionLigada);
  const monto    = ligada ? editando.monto : _leerMontoInput("pago-monto");
  const tipo     = ligada ? editando.tipo  : document.getElementById("pago-tipo").value;
  const metodoid = ligada ? (editando.metodo_pago_id ?? null) : (document.getElementById("pago-metodo").value || null);
  const bancoId  = document.getElementById("pago-banco").value  || null;
  const fecha    = document.getElementById("pago-fecha").value;
  const compNro  = document.getElementById("pago-comprobante").value.trim() || null;
  const obs      = document.getElementById("pago-observacion").value.trim() || null;
  const fotoFile = document.getElementById("pago-foto").files?.[0];

  const montoEl = document.getElementById("pago-monto");
  if (monto == null || isNaN(monto) || monto < 0) { montoEl.classList.add("input-error"); montoEl.focus(); return; }
  montoEl.classList.remove("input-error");

  const btn = document.getElementById("btn-guardar-pago");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  let nuevaKey = null;
  try {
    if (fotoFile) {
      try { nuevaKey = await subirFotoComprobante(fotoFile); }
      catch (e) {
        console.warn("No se pudo subir foto:", e);
        // Al corregir un pago no se descarta en silencio el comprobante nuevo
        if (editando) throw new Error("No se pudo subir el comprobante");
        showToast("El pago se guardará sin el comprobante adjunto", "warning");
      }
    }

    const datos = {
      metodo_pago_id  : metodoid,
      banco           : bancoId,
      monto,
      tipo,
      fecha_pago      : fecha || new Date().toISOString().split("T")[0],
      comprobante_nro : compNro,
      observacion     : obs,
    };

    if (editando) {
      const cambiaFoto = !!nuevaKey || pagosCtx.quitarFoto;
      if (cambiaFoto) {
        datos.foto_storage_key = nuevaKey;   // null si solo se quita
      }
      const { data: filas, error } = await supabaseClient
        .from("pagos").update(datos).eq("id", editando.id).select("id");
      if (error || !filas?.length) {
        await _pagosEliminarArchivo(nuevaKey); // el archivo nuevo quedó sin uso
        nuevaKey = null;
        throw error || new Error("No se pudo guardar el cambio (sin permiso)");
      }
      // Recién con el pago actualizado se borra el comprobante anterior
      if (cambiaFoto) await _pagosEliminarArchivo(editando.foto_storage_key);
      showToast("Pago actualizado", "success");
    } else {
      const { data: { user } } = await supabaseClient.auth.getUser();
      const { error } = await supabaseClient.from("pagos").insert([{
        ...datos,
        viaje_pasajero_id : parseInt(pagosCtx.viajePasajeroId),
        foto_storage_key  : nuevaKey,
        creado_por        : user.email,
      }]);
      if (error) { await _pagosEliminarArchivo(nuevaKey); nuevaKey = null; throw error; }
      // Las transferencias entre pasajeros se hacen desde el detalle del pago
      showToast("Pago guardado", "success");
    }

    const editadoEnDetalle = !!editando && !!_formPagoOrigen;
    ocultarFormPago();
    if (editadoEnDetalle) _volverALaListaPagos(); // el detalle mostraba datos viejos
    else await loadPagosPasajero();

  } catch (e) {
    console.error("Error guardando pago:", e);
    showToast("Error al guardar: " + (e.message || "Intentá de nuevo"), "error");
  } finally {
    _pintarBtnGuardarPago();
  }
}

/* ── EDITAR UN PAGO ─────────────────────────── */
// Se entra desde el detalle del pago; el formulario de la lista se reutiliza
// en "modo edición" (pagosCtx.pagoEditando).
// El formulario se "presta" al detalle del pago para editar sin cambiar de
// pantalla; _formPagoOrigen recuerda dónde devolverlo.
let _formPagoOrigen = null;

function _formPagoAlDetalle() {
  const form = document.getElementById("form-nuevo-pago");
  const slot = document.getElementById("pd-edit-slot");
  if (!form || !slot) return false;
  if (!_formPagoOrigen) _formPagoOrigen = { padre: form.parentNode, siguiente: form.nextSibling };
  slot.appendChild(form);
  const botones = document.getElementById("pd-botones");
  if (botones) botones.style.display = "none";
  return true;
}

function _formPagoALaLista() {
  if (!_formPagoOrigen) return;
  const form = document.getElementById("form-nuevo-pago");
  if (form) _formPagoOrigen.padre.insertBefore(form, _formPagoOrigen.siguiente);
  _formPagoOrigen = null;
  const botones = document.getElementById("pd-botones");
  if (botones) botones.style.display = "";
}

function _volverALaListaPagos() {
  navigateTo("viaje-pasajero-pagos", {
    viajePasajeroId : pagosCtx.viajePasajeroId,
    viajeId         : pagosCtx.viajeId,
    pasajeroId      : pagosCtx.pasajeroId,
    nombrePasajero  : pagosCtx.nombrePasajero,
  });
}

async function iniciarEdicionPago() {
  const p = pagosCtx.pagoActual;
  if (!p || !can("pagos.editar")) return;

  // Normal: se edita aquí mismo. Los selects de método ya están cargados
  // si se llegó por la lista de pagos.
  if (document.getElementById("pago-metodo")?.options.length && _formPagoAlDetalle()) {
    await _prepararEdicionPago(p);
    return;
  }

  // Si el detalle se abrió directo (ej. recarga), se pasa por la lista, que
  // prepara los selects, y desde allí se abre el formulario.
  pagosCtx.pagoPorEditar = p;
  _volverALaListaPagos();
}

function _resetModoEdicionPago() {
  pagosCtx.pagoEditando = null;
  pagosCtx.edicionLigada = false;
  pagosCtx.quitarFoto = false;
  ["pago-tipo", "pago-monto", "pago-metodo"].forEach(id => {
    const wrap = document.getElementById(id)?.closest(".form-field");
    if (wrap) wrap.style.display = "";
  });
  const nota = document.getElementById("pago-foto-actual");
  if (nota) nota.hidden = true;
  _pintarBtnGuardarPago();
}

function _alternarQuitarFotoActual() {
  pagosCtx.quitarFoto = !pagosCtx.quitarFoto;
  _pintarNotaFotoActual();
}

function _pintarNotaFotoActual() {
  const txt = document.getElementById("pago-foto-actual-txt");
  const btn = document.getElementById("pago-foto-actual-btn");
  if (!txt || !btn) return;
  txt.textContent = pagosCtx.quitarFoto
    ? "El comprobante actual se quitará al guardar."
    : "Ya tiene un comprobante. Si elegís otro archivo, lo reemplaza.";
  btn.textContent = pagosCtx.quitarFoto ? "Deshacer" : "Quitar";
}

async function _pagoTieneTransferencia(id) {
  const { count } = await supabaseClient
    .from("pagos")
    .select("id", { count: "exact", head: true })
    .or(`ref_origen.eq.${id},referencia_pago_id.eq.${id}`);
  return (count || 0) > 0;
}

async function _prepararEdicionPago(p) {
  if (!can("pagos.editar")) return;
  _abrirFormPago();
  pagosCtx.pagoEditando = p;

  const ligada = p.tipo === "Transferencia" || !!p.referencia_pago_id || !!p.ref_origen
    || await _pagoTieneTransferencia(p.id);
  pagosCtx.edicionLigada = ligada;

  document.getElementById("pago-monto").value = _formatearMiles(p.monto);
  document.getElementById("pago-fecha").value = p.fecha_pago || "";
  document.getElementById("pago-comprobante").value = p.comprobante_nro || "";
  document.getElementById("pago-observacion").value = p.observacion || "";

  const tipoEl = document.getElementById("pago-tipo");
  if (tipoEl) { tipoEl.value = p.tipo; refreshCustomSelect("pago-tipo"); }
  const metodoEl = document.getElementById("pago-metodo");
  if (metodoEl) { metodoEl.value = String(p.metodo_pago_id ?? ""); refreshCustomSelect("pago-metodo"); }
  onMetodoChange();

  document.getElementById("pago-banco").value = p.banco_id ?? "";
  document.getElementById("pago-banco-input").value = p.banco || "";

  if (ligada) {
    ["pago-tipo", "pago-monto", "pago-metodo"].forEach(id => {
      const wrap = document.getElementById(id)?.closest(".form-field");
      if (wrap) wrap.style.display = "none";
    });
    showToast("Este pago está ligado a una transferencia: no se puede cambiar monto, tipo ni método", "warning");
  }

  const nota = document.getElementById("pago-foto-actual");
  if (nota) {
    nota.hidden = !p.foto_storage_key;
    _pintarNotaFotoActual();
  }

  _pintarBtnGuardarPago();
  document.getElementById("form-nuevo-pago")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ── DETALLE DE UN PAGO ─────────────────────── */
function abrirDetallePago(pago) {
  navigateTo("pago-detalle", pago);
}

// Comprobante del detalle: vive en R2 y solo se obtiene con el JWT (fetch → blob).
let _pdFotoObjectUrl = null;

async function _cargarFotoDetallePago(p) {
  const wrap = document.getElementById("pd-foto-wrap");
  const img  = document.getElementById("pd-foto-img");
  const link = document.getElementById("pd-foto-link");
  const aviso = document.getElementById("pd-foto-aviso");

  if (_pdFotoObjectUrl) { URL.revokeObjectURL(_pdFotoObjectUrl); _pdFotoObjectUrl = null; }
  img.removeAttribute("src");
  img.style.display = "none";
  link.removeAttribute("href");
  aviso.hidden = true;

  if (!can("pagos.comprobante_ver") || !p.foto_storage_key) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";

  aviso.textContent = "Cargando comprobante…";
  aviso.hidden = false;
  try {
    const res = await _pagosWorkerFetch(p.foto_storage_key);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (pagosCtx.pagoActual !== p) return; // el usuario ya cambió de pago
    _pdFotoObjectUrl = URL.createObjectURL(blob);
    link.href = _pdFotoObjectUrl;
    if (blob.type === "application/pdf") {
      aviso.textContent = "Abrir comprobante (PDF)";
    } else {
      img.src = _pdFotoObjectUrl;
      img.style.display = "";
      aviso.hidden = true;
    }
  } catch (e) {
    console.error("Error cargando comprobante:", e);
    if (pagosCtx.pagoActual === p) aviso.textContent = "No se pudo cargar el comprobante";
  }
}

async function initPagoDetalleView(p) {
  // Guardar pago en contexto para la transferencia
  pagosCtx.pagoActual = p;

  const tipoCls = { "Pago": "tipo-pago", "Devolución": "tipo-devolucion", "Transferencia": "tipo-transferencia" };
  const tipoIcon = {
    "Pago":          `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    "Devolución":    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="4 18 4 12 10 12"/><path d="M20 12a8 8 0 0 0-8-8 8 8 0 0 0-5.66 2.34L4 12"/></svg>`,
    "Transferencia": `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/><path d="M6 8L2 12L6 16"/></svg>`,
  };
  const cls  = tipoCls[p.tipo] || "";
  const icon = tipoIcon[p.tipo] || "";
  const fecha = p.fecha_pago
    ? new Date(p.fecha_pago + "T00:00:00").toLocaleDateString("es-PY", { day:"2-digit", month:"long", year:"numeric" })
    : "—";

  document.getElementById("pd-badge").className  = `pago-tipo-badge ${cls}`;
  document.getElementById("pd-badge").innerHTML  = `${icon} ${p.tipo}`;
  document.getElementById("pd-monto").className  = `pd-monto-valor ${cls}`;
  document.getElementById("pd-monto").textContent = `Gs. ${(p.monto || 0).toLocaleString("es-PY")}`;
  document.getElementById("pd-fecha").textContent        = fecha;
  document.getElementById("pd-metodo").textContent       = p.metodo || "—";
  document.getElementById("pd-banco").textContent        = p.banco  || "—";
  document.getElementById("pd-comprobante").textContent  = p.comprobante_nro || "—";
  document.getElementById("pd-observacion").textContent  = p.observacion || "—";
  document.getElementById("pd-creado").textContent       = p.creado_por || "—";

  _cargarFotoDetallePago(p); // sin await: no demora el resto del detalle

  // Editar: por tarea (sql/permisos_pagos.sql)
  const editarEl = document.getElementById("pd-editar");
  if (editarEl) editarEl.style.display = can("pagos.editar") ? "" : "none";

  // Mostrar botón de transferencia solo con la tarea pagos.transferir, solo para tipo Pago,
  // y solo si este pago aún no fue transferido (no existe Transferencia con referencia_pago_id = p.id)
  const accionesEl = document.getElementById("pd-acciones");
  if (accionesEl) {
    if (can("pagos.transferir") && p.tipo === "Pago") {
      // Verificar si ya existe un registro Transferencia que apunte a este pago como origen
      const { data: transExistente } = await supabaseClient
        .from("pagos")
        .select("id")
        .eq("ref_origen", parseInt(p.id))
        .eq("tipo", "Transferencia")
        .maybeSingle();

      if (transExistente) {
        // Ya fue transferido: ocultar botón y mostrar indicador
        accionesEl.innerHTML = `
          <div class="pd-transferido-aviso">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/><path d="M6 8L2 12L6 16"/></svg>
            Pago ya transferido
          </div>`;
        accionesEl.style.display = "";
      } else {
        accionesEl.style.display = "";
      }
    } else {
      accionesEl.style.display = "none";
    }
  }
}

/* ── MODAL: TRANSFERIR PAGO ─────────────────── */
async function abrirModalTransferirPago() {
  if (!can("pagos.transferir")) return;
  const p = pagosCtx.pagoActual;
  if (!p) return;

  const montoEl = document.getElementById("modal-trans-monto");
  if (montoEl) montoEl.textContent = `Gs. ${(p.monto || 0).toLocaleString("es-PY")}`;

  const buscarEl = document.getElementById("modal-trans-buscar");
  if (buscarEl) buscarEl.value = "";

  const resEl = document.getElementById("modal-trans-resultados");
  if (resEl) resEl.innerHTML = `<div class="modal-trans-vacio">Cargando pasajeros del viaje…</div>`;

  const selEl = document.getElementById("modal-trans-seleccionado");
  if (selEl) selEl.style.display = "none";

  const btnEl = document.getElementById("btn-confirmar-transferencia");
  if (btnEl) btnEl.disabled = true;

  pagosCtx.destinatarioTransferencia = null;
  pagosCtx.pasajerosDelViaje = [];

  // Cargar los pasajero_id inscritos en este viaje
  const { data: vps } = await supabaseClient
    .from("viaje_pasajeros")
    .select("pasajero_id")
    .eq("viaje_id", pagosCtx.viajeId);

  pagosCtx.pasajerosDelViaje = (vps || []).map(vp => String(vp.pasajero_id));

  if (resEl) resEl.innerHTML = "";

  const modal = document.getElementById("modal-transferir-pago");
  if (modal) modal.style.display = "flex";
}

function cerrarModalTransferirPago(event) {
  // Si se llama con evento (click en backdrop), solo cerrar si el click fue directo al modal
  if (event && event.target !== document.getElementById("modal-transferir-pago")) return;
  const modal = document.getElementById("modal-transferir-pago");
  if (modal) modal.style.display = "none";
}

function cerrarModalTransferirPagoDirecto() {
  const modal = document.getElementById("modal-transferir-pago");
  if (modal) modal.style.display = "none";
}

function buscarPasajeroParaTransferir() {
  const q    = document.getElementById("modal-trans-buscar").value.toLowerCase().trim();
  const cont = document.getElementById("modal-trans-resultados");
  const selEl = document.getElementById("modal-trans-seleccionado");
  const btnEl = document.getElementById("btn-confirmar-transferencia");

  // Limpiar selección al escribir de nuevo
  pagosCtx.destinatarioTransferencia = null;
  if (selEl) selEl.style.display = "none";
  if (btnEl) btnEl.disabled = true;

  if (!q) { cont.innerHTML = ""; return; }

  if (!allPassengers || allPassengers.length === 0) {
    cont.innerHTML = `<div class="modal-trans-vacio">Cargando pasajeros… intentá de nuevo en un momento.</div>`;
    loadPassengers();
    return;
  }

  const idsViaje = pagosCtx.pasajerosDelViaje || [];
  const resultados = (allPassengers || []).filter(p =>
    String(p.id) !== String(pagosCtx.pasajeroId) &&
    idsViaje.includes(String(p.id)) &&
    ((p.Pasajero || "").toLowerCase().includes(q) ||
     (p["Documento de Identidad"] || "").toLowerCase().includes(q))
  );

  if (resultados.length === 0) {
    cont.innerHTML = `<div class="modal-trans-vacio">Sin resultados para "<strong>${q}</strong>"</div>`;
    return;
  }

  cont.innerHTML = resultados.slice(0, 8).map(p => `
    <div class="modal-trans-item" onclick="seleccionarDestinatario('${p.id}','${(p.Pasajero||"").replace(/'/g,"\\'")}')">
      <div>
        <strong>${p.Pasajero}</strong>
        <div class="ci" style="font-size:.75rem;color:var(--text-muted)">CI: ${p["Documento de Identidad"] || "—"}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>`).join("");
}

function seleccionarDestinatario(id, nombre) {
  pagosCtx.destinatarioTransferencia = { id, nombre };

  const buscarEl = document.getElementById("modal-trans-buscar");
  if (buscarEl) buscarEl.value = nombre;

  const resEl = document.getElementById("modal-trans-resultados");
  if (resEl) resEl.innerHTML = "";

  const selEl = document.getElementById("modal-trans-seleccionado");
  const nomEl = document.getElementById("modal-trans-nombre-sel");
  if (selEl) selEl.style.display = "flex";
  if (nomEl) nomEl.textContent = nombre;

  const btnEl = document.getElementById("btn-confirmar-transferencia");
  if (btnEl) btnEl.disabled = false;
}

async function confirmarTransferirPago() {
  if (!can("pagos.transferir")) return;
  const p    = pagosCtx.pagoActual;
  const dest = pagosCtx.destinatarioTransferencia;
  if (!p || !dest) return;

  const btn = document.getElementById("btn-confirmar-transferencia");
  btn.disabled = true;
  btn.textContent = "Transfiriendo…";

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const hoy = new Date().toISOString().split("T")[0];

    // 1. Buscar viaje_pasajero del destino en este viaje
    const { data: vpDest, error: eVp } = await supabaseClient
      .from("viaje_pasajeros")
      .select("id")
      .eq("viaje_id", pagosCtx.viajeId)
      .eq("pasajero_id", dest.id)
      .single();

    if (eVp || !vpDest) {
      showToast("El pasajero seleccionado no está inscripto en este viaje.", "warning");
      return;
    }

    // 2. Insertar registro Transferencia en el origen (sin referencia aún)
    const { data: regOrigen, error: e1 } = await supabaseClient
      .from("pagos")
      .insert([{
        viaje_pasajero_id : parseInt(pagosCtx.viajePasajeroId),
        monto             : p.monto,
        tipo              : "Transferencia",
        fecha_pago        : hoy,
        metodo_pago_id    : p.metodo_pago_id || null,
        ref_origen        : parseInt(p.id),
        observacion       : `Transferido a ${dest.nombre}`,
        creado_por        : user.email,
      }])
      .select("id")
      .single();
    if (e1) throw e1;

    // 3. Insertar registro Pago en el destino (con referencia al origen)
    const { data: regDest, error: e2 } = await supabaseClient
      .from("pagos")
      .insert([{
        viaje_pasajero_id  : vpDest.id,
        monto              : p.monto,
        tipo               : "Pago",
        fecha_pago         : hoy,
        metodo_pago_id     : p.metodo_pago_id || null,
        referencia_pago_id : regOrigen.id,
        observacion        : `Transferencia desde ${pagosCtx.nombrePasajero}`,
        creado_por         : user.email,
      }])
      .select("id")
      .single();
    if (e2) throw e2;

    // 4. Actualizar el origen con referencia al destino (vínculo bidireccional)
    const { error: e3 } = await supabaseClient
      .from("pagos")
      .update({ referencia_pago_id: regDest.id })
      .eq("id", regOrigen.id);
    if (e3) throw e3;

    showToast("Pago transferido", "success");
    cerrarModalTransferirPagoDirecto();
    // Volver a la lista de pagos del pasajero original
    navigateTo("viaje-pasajero-pagos", {
      viajePasajeroId : pagosCtx.viajePasajeroId,
      viajeId         : pagosCtx.viajeId,
      pasajeroId      : pagosCtx.pasajeroId,
      nombrePasajero  : pagosCtx.nombrePasajero,
    });

  } catch (e) {
    console.error("Error al transferir pago:", e);
    showToast("Error al transferir: " + (e.message || "Intentá de nuevo"), "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/><path d="M6 8L2 12L6 16"/></svg> Confirmar transferencia`;
  }
}

/* ═══════════════════════════════════════════════
   SERVICIOS EXTRA DEL PASAJERO
   Usa servicio_extra_pasajeros para vincular un
   servicios_extra del viaje a este viaje_pasajero.
   No modifica viaje_pasajeros.total_a_pagar: el total
   con extras se calcula en memoria (ver loadPagosPasajero).
═══════════════════════════════════════════════ */

/* Carga los extras ya asignados a este pasajero y pinta la sección.
   La sección completa queda oculta si el viaje no tiene
   extras_habilitados, sin importar el rol. */
async function loadExtrasPasajero() {
  const section = document.getElementById("pagos-extra-section");
  const listEl  = document.getElementById("pagos-extra-list");
  const btnAdd  = document.getElementById("btn-agregar-extra-pasajero");
  if (!section || !listEl) return;

  // Por tarea (sql/permisos_extras.sql): ver / asignar / quitar
  const habilitado = !!viajeActualData?.extras_habilitados && can("extras.pasajero_ver");
  if (!habilitado) {
    section.style.display = "none";
    pagosCtx.extrasAsignados = [];
    return;
  }
  section.style.display = "";

  const puedeQuitar = can("extras.pasajero_quitar");
  if (btnAdd) btnAdd.style.display = can("extras.pasajero_asignar") ? "" : "none";

  const { data, error } = await supabaseClient
    .from("servicio_extra_pasajeros")
    .select("id, precio_venta_real, servicio_extra_id, servicios_extra(id, nombre)")
    .eq("viaje_pasajero_id", parseInt(pagosCtx.viajePasajeroId));

  if (error) {
    console.error("Error cargando servicios extra del pasajero:", error);
    listEl.innerHTML = `<div class="pagos-empty">Error al cargar servicios extra</div>`;
    pagosCtx.extrasAsignados = [];
    return;
  }

  pagosCtx.extrasAsignados = data || [];

  if (pagosCtx.extrasAsignados.length === 0) {
    listEl.innerHTML = `<div class="pagos-empty" style="padding:1rem .2rem">Sin servicios extra asignados</div>`;
    return;
  }

  const total = pagosCtx.extrasAsignados.reduce((s, e) => s + (e.precio_venta_real || 0), 0);

  listEl.innerHTML = pagosCtx.extrasAsignados.map(e => {
    const nombre = e.servicios_extra?.nombre || "Servicio extra";
    const removeBtn = puedeQuitar ? `
      <button class="pagos-extra-remove" title="Quitar" onclick="eliminarExtraPasajero('${e.id}')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>` : "";
    return `
    <div class="pagos-extra-row">
      <span class="pagos-extra-nombre">${_escapeHtmlPagos(nombre)}</span>
      <div style="display:flex;align-items:center;gap:.4rem">
        <span class="pagos-extra-precio">Gs. ${(e.precio_venta_real || 0).toLocaleString("es-PY")}</span>
        ${removeBtn}
      </div>
    </div>`;
  }).join("") + `
    <div class="pagos-extra-total-row">
      <span class="pagos-extra-total-label">Total en extras</span>
      <span class="pagos-extra-total-valor">Gs. ${total.toLocaleString("es-PY")}</span>
    </div>`;
}

/* ── MODAL: AGREGAR SERVICIO EXTRA ──────────── */

async function abrirModalAgregarExtraPasajero() {
  if (!can("extras.pasajero_asignar")) return;

  pagosCtx.extraElegido = null;

  const modal = document.getElementById("modal-agregar-extra");
  const pasoLista  = document.getElementById("modal-extra-paso-lista");
  const pasoPrecio = document.getElementById("modal-extra-paso-precio");
  const listaEl    = document.getElementById("modal-extra-lista");
  if (!modal) return;

  pasoLista.style.display  = "";
  pasoPrecio.style.display = "none";
  listaEl.innerHTML = `<div class="modal-trans-vacio">Cargando servicios disponibles…</div>`;
  modal.style.display = "flex";

  // Servicios del viaje que este pasajero todavía no tiene asignados
  const { data: todos, error } = await supabaseClient
    .from("servicios_extra")
    .select("id, nombre, precio_venta")
    .eq("viaje_id", parseInt(pagosCtx.viajeId))
    .order("nombre", { ascending: true });

  if (error) {
    console.error("Error cargando servicios extra del viaje:", error);
    listaEl.innerHTML = `<div class="modal-trans-vacio">Error al cargar servicios</div>`;
    return;
  }

  const idsAsignados = new Set(pagosCtx.extrasAsignados.map(e => String(e.servicio_extra_id)));
  pagosCtx.extrasDisponibles = (todos || []).filter(s => !idsAsignados.has(String(s.id)));

  if (pagosCtx.extrasDisponibles.length === 0) {
    listaEl.innerHTML = `<div class="modal-trans-vacio">No hay más servicios extra disponibles para este pasajero</div>`;
    return;
  }

  listaEl.innerHTML = pagosCtx.extrasDisponibles.map(s => `
    <div class="modal-trans-item" onclick="_elegirExtraPasajero('${s.id}')">
      <div>
        <strong>${_escapeHtmlPagos(s.nombre)}</strong>
      </div>
      <span style="font-size:.8rem;color:var(--text-muted)">Gs. ${(s.precio_venta || 0).toLocaleString("es-PY")}</span>
    </div>`).join("");
}

function _elegirExtraPasajero(servicioId) {
  const servicio = pagosCtx.extrasDisponibles.find(s => String(s.id) === String(servicioId));
  if (!servicio) return;

  pagosCtx.extraElegido = servicio;

  document.getElementById("modal-extra-paso-lista").style.display  = "none";
  document.getElementById("modal-extra-paso-precio").style.display = "";
  document.getElementById("modal-extra-nombre-elegido").textContent = servicio.nombre;

  const precioEl = document.getElementById("modal-extra-precio");
  if (precioEl) precioEl.value = _formatearMiles(servicio.precio_venta || 0);
}

function _volverListaExtraPasajero() {
  pagosCtx.extraElegido = null;
  document.getElementById("modal-extra-paso-precio").style.display = "none";
  document.getElementById("modal-extra-paso-lista").style.display  = "";
}

function cerrarModalAgregarExtraPasajero(event) {
  // Si viene de click en el backdrop, solo cerrar si el click fue directo al overlay
  if (event && event.target !== document.getElementById("modal-agregar-extra")) return;
  const modal = document.getElementById("modal-agregar-extra");
  if (modal) modal.style.display = "none";
  pagosCtx.extraElegido = null;
}

async function confirmarAgregarExtraPasajero() {
  if (!can("extras.pasajero_asignar")) return;

  const servicio = pagosCtx.extraElegido;
  if (!servicio) return;

  const precioRaw = document.getElementById("modal-extra-precio")?.value;
  const precio_venta_real = _numeroDesdeMiles(precioRaw);

  if (precioRaw === "" || isNaN(precio_venta_real) || precio_venta_real < 0) {
    document.getElementById("modal-extra-precio")?.classList.add("error");
    return;
  }

  const btn = document.getElementById("btn-confirmar-extra-pasajero");
  if (btn) { btn.disabled = true; btn.textContent = "Agregando…"; }

  const { error } = await supabaseClient
    .from("servicio_extra_pasajeros")
    .insert([{
      servicio_extra_id : servicio.id,
      viaje_pasajero_id : parseInt(pagosCtx.viajePasajeroId),
      precio_venta_real,
    }]);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Agregar`;
  }

  if (error) {
    console.error("Error agregando servicio extra al pasajero:", error);
    if (typeof showToast === "function") showToast("Error al agregar el servicio extra", "error");
    else showToast("Error al agregar el servicio extra", "error");
    return;
  }

  if (typeof showToast === "function") showToast("✅ Servicio extra agregado", "success");

  cerrarModalAgregarExtraPasajero();
  await loadPagosPasajero(); // recarga extras + recalcula el resumen con el nuevo total
}

async function eliminarExtraPasajero(id) {
  if (!can("extras.pasajero_quitar")) return;

  const asignado = pagosCtx.extrasAsignados.find(e => String(e.id) === String(id));
  const nombre = asignado?.servicios_extra?.nombre || "este servicio extra";

  if (!(await confirmar({ titulo: "Quitar servicio extra", mensaje: `¿Quitar "${nombre}" de este pasajero? Se descontará del total a pagar.`, confirmarTexto: "Quitar", peligro: true }))) return;

  const { error } = await supabaseClient
    .from("servicio_extra_pasajeros")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error quitando servicio extra del pasajero:", error);
    if (typeof showToast === "function") showToast("Error al quitar el servicio extra", "error");
    else showToast("Error al quitar el servicio extra", "error");
    return;
  }

  if (typeof showToast === "function") showToast("Servicio extra quitado", "success");

  await loadPagosPasajero();
}

/* Escape local — evita colisión si otro archivo ya define un helper con el mismo nombre */
if (typeof _escapeHtmlPagos !== "function") {
  var _escapeHtmlPagos = function (str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };
}

