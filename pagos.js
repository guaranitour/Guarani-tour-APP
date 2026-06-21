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
  pasajeroDestino : null,
};

/* ── ENTRAR A LA VISTA ──────────────────────── */
function abrirPagosPasajero(viajePasajeroId, viajeId, pasajeroId, nombrePasajero) {
  pagosCtx.viajePasajeroId = viajePasajeroId;
  pagosCtx.viajeId         = viajeId;
  pagosCtx.pasajeroId      = pasajeroId;
  pagosCtx.nombrePasajero  = nombrePasajero;
  navigateTo("viaje-pasajero-pagos", { viajePasajeroId, viajeId, pasajeroId, nombrePasajero });
}

/* ── INICIALIZAR VISTA ──────────────────────── */
async function initPagosView(ctx) {
  Object.assign(pagosCtx, ctx);

  const titulo = document.getElementById("pagos-pasajero-titulo");
  if (titulo) titulo.textContent = ctx.nombrePasajero || "Pagos";

  ocultarFormPago();

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
  }

  // Bancos: se manejan via filtrarBancos(), solo limpiar input
  const bancoInput = document.getElementById("pago-banco-input");
  if (bancoInput) bancoInput.value = "";
  const bancoHidden = document.getElementById("pago-banco");
  if (bancoHidden) bancoHidden.value = "";

  await loadPagosPasajero();
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
      .select("id, monto, tipo, fecha_pago, comprobante_nro, observacion, foto_comprobante, creado_por, banco, metodo_pago_id")
      .eq("viaje_pasajero_id", parseInt(pagosCtx.viajePasajeroId))
      .order("fecha_pago", { ascending: false }),
  ]);

  pagosCtx.totalAPagar = vp?.total_a_pagar || 0;

  if (error) {
    listEl.innerHTML = `<div class="pagos-empty">Error al cargar pagos</div>`;
    console.error("Error pagos:", error);
    return;
  }

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
  const esCanje = pagosCtx.totalAPagar === 0;
  const saldo = esCanje ? -neto : pagosCtx.totalAPagar - neto;
  const pct   = (!esCanje && pagosCtx.totalAPagar > 0)
    ? Math.min(100, Math.round((neto / pagosCtx.totalAPagar) * 100)) : 0;

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
        <span class="pr-value">${esCanje ? "Canje" : "Gs. " + pagosCtx.totalAPagar.toLocaleString("es-PY")}</span>
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
      foto_comprobante: p.foto_comprobante
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
function mostrarFormPago() {
  ["pago-monto","pago-comprobante","pago-observacion"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const fotoEl  = document.getElementById("pago-foto");
  if (fotoEl) fotoEl.value = "";
  const bancoInput = document.getElementById("pago-banco-input");
  if (bancoInput) bancoInput.value = "";
  const bancoHidden = document.getElementById("pago-banco");
  if (bancoHidden) bancoHidden.value = "";
  const bancoDd = document.getElementById("banco-dropdown");
  if (bancoDd) { bancoDd.innerHTML = ""; bancoDd.style.display = "none"; }
  const fechaEl = document.getElementById("pago-fecha");
  if (fechaEl) fechaEl.value = new Date().toISOString().split("T")[0];
  const tipoEl  = document.getElementById("pago-tipo");
  if (tipoEl) { tipoEl.value = "Pago"; onTipoChange(); }
  onMetodoChange();
  document.getElementById("form-nuevo-pago").style.display = "";
  document.getElementById("btn-nuevo-pago").style.display  = "none";
}

function ocultarFormPago() {
  const form = document.getElementById("form-nuevo-pago");
  const btn  = document.getElementById("btn-nuevo-pago");
  if (form) form.style.display = "none";
  // Botón "Registrar pago": visible para todos los roles (admin, worker, viewer)
  if (btn) btn.style.display = "";
}

/* ── CAMBIO DE TIPO ─────────────────────────── */
function onTipoChange() {
  const tipo     = document.getElementById("pago-tipo")?.value;
  const secTrans = document.getElementById("pago-transferencia-wrap");
  if (secTrans) secTrans.style.display = (tipo === "Transferencia") ? "" : "none";
  if (tipo === "Transferencia") {
    const buscarEl = document.getElementById("trans-buscar");
    const resEl    = document.getElementById("trans-resultados");
    if (buscarEl) buscarEl.value = "";
    if (resEl)    resEl.innerHTML = "";
    pagosCtx.pasajeroDestino = null;
  }
}

/* ── BUSCAR PASAJERO DESTINO ────────────────── */
async function buscarPasajeroDestino() {
  const q    = document.getElementById("trans-buscar").value.toLowerCase().trim();
  const cont = document.getElementById("trans-resultados");
  if (!q) { cont.innerHTML = ""; return; }

  // Cargar pasajeros si aún no están en memoria
  if (!allPassengers || allPassengers.length === 0) {
    cont.innerHTML = `<div class="trans-vacio">Cargando pasajeros…</div>`;
    await loadPassengers();
  }

  const resultados = (allPassengers || []).filter(p =>
    String(p.id) !== String(pagosCtx.pasajeroId) &&
    ((p.Pasajero || "").toLowerCase().includes(q) ||
     (p["Documento de Identidad"] || "").toLowerCase().includes(q))
  );
  if (resultados.length === 0) {
    cont.innerHTML = `<div class="trans-vacio">Sin resultados para "<strong>${q}</strong>"</div>`;
    return;
  }
  cont.innerHTML = resultados.slice(0, 8).map(p => `
    <div class="pasajero-item" onclick="seleccionarPasajeroDestino('${p.id}','${(p.Pasajero||"").replace(/'/g,"\\'")}')">
      <div class="pasajero-item-inner">
        <div><strong>${p.Pasajero}</strong><div class="ci">CI: ${p["Documento de Identidad"] || "—"}</div></div>
        <span class="pasajero-select-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></span>
      </div>
    </div>`).join("");
}

function seleccionarPasajeroDestino(id, nombre) {
  pagosCtx.pasajeroDestino = { id, nombre };
  document.getElementById("trans-buscar").value = nombre;
  document.getElementById("trans-resultados").innerHTML = `<div class="pasajero-seleccionado">✅ ${nombre}</div>`;
}

/* ── SUBIR FOTO ─────────────────────────────── */
async function subirFotoComprobante(file) {
  const ext = file.name.split(".").pop();
  const fileName = `${Date.now()}.${ext}`;
  const { error } = await supabaseClient.storage.from("pagos").upload(fileName, file);
  if (error) throw error;
  const { data } = supabaseClient.storage.from("pagos").getPublicUrl(fileName);
  return data.publicUrl;
}

/* ── GUARDAR PAGO ───────────────────────────── */
async function guardarPago() {
  const monto    = parseInt(document.getElementById("pago-monto").value);
  const tipo     = document.getElementById("pago-tipo").value;
  const metodoid = document.getElementById("pago-metodo").value || null;
  const bancoId  = document.getElementById("pago-banco").value  || null;
  const fecha    = document.getElementById("pago-fecha").value;
  const compNro  = document.getElementById("pago-comprobante").value.trim() || null;
  const obs      = document.getElementById("pago-observacion").value.trim() || null;
  const fotoFile = document.getElementById("pago-foto").files?.[0];

  const montoEl = document.getElementById("pago-monto");
  if (monto == null || isNaN(monto) || monto < 0) { montoEl.classList.add("input-error"); montoEl.focus(); return; }
  montoEl.classList.remove("input-error");

  if (tipo === "Transferencia" && !pagosCtx.pasajeroDestino) {
    alert("Seleccioná el pasajero destino de la transferencia");
    return;
  }

  const btn = document.getElementById("btn-guardar-pago");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();

    let foto_url = null;
    if (fotoFile) {
      try { foto_url = await subirFotoComprobante(fotoFile); }
      catch (e) { console.warn("No se pudo subir foto:", e); }
    }

    const base = {
      viaje_pasajero_id : parseInt(pagosCtx.viajePasajeroId),
      metodo_pago_id    : metodoid,
      banco           : bancoId,
      monto,
      tipo,
      fecha_pago      : fecha || new Date().toISOString().split("T")[0],
      comprobante_nro : compNro,
      observacion     : obs,
      foto_comprobante: foto_url,
      creado_por      : user.email,
    };

    if (tipo === "Transferencia") {
      const { data: reg1, error: e1 } = await supabaseClient
        .from("pagos").insert([{ ...base, tipo: "Transferencia" }]).select("id").single();
      if (e1) throw e1;
      const { data: reg2, error: e2 } = await supabaseClient.from("pagos").insert([{
        ...base,
        pasajero_id        : pagosCtx.pasajeroDestino.id,
        tipo               : "Pago",
        referencia_pago_id : reg1.id,
        observacion        : `Transferencia desde ${pagosCtx.nombrePasajero}${obs ? " — " + obs : ""}`,
      }]).select("id").single();
      if (e2) throw e2;
      // Vínculo bidireccional: origen también apunta al destino
      const { error: e3 } = await supabaseClient
        .from("pagos").update({ referencia_pago_id: reg2.id }).eq("id", reg1.id);
      if (e3) throw e3;
    } else {
      const { error } = await supabaseClient.from("pagos").insert([base]);
      if (error) throw error;
    }

    ocultarFormPago();
    await loadPagosPasajero();

  } catch (e) {
    console.error("Error guardando pago:", e);
    alert("Error al guardar: " + (e.message || "Intentá de nuevo"));
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Registrar pago`;
  }
}

/* ── DETALLE DE UN PAGO ─────────────────────── */
function abrirDetallePago(pago) {
  navigateTo("pago-detalle", pago);
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

  const fotoWrap = document.getElementById("pd-foto-wrap");
  const fotoImg  = document.getElementById("pd-foto-img");
  const fotoLink = document.getElementById("pd-foto-link");
  if (p.foto_comprobante) {
    fotoImg.src  = p.foto_comprobante;
    fotoLink.href = p.foto_comprobante;
    fotoWrap.style.display = "block";
  } else {
    fotoWrap.style.display = "none";
  }

  // Mostrar botón de transferencia solo a admin/worker, solo para tipo Pago,
  // y solo si este pago aún no fue transferido (no existe Transferencia con referencia_pago_id = p.id)
  const accionesEl = document.getElementById("pd-acciones");
  if (accionesEl) {
    const esWorkerOAdmin = Array.isArray(currentUserRole)
      ? currentUserRole.some(r => ["admin", "worker"].includes(r))
      : ["admin", "worker"].includes(currentUserRole);

    if (esWorkerOAdmin && p.tipo === "Pago") {
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
      alert("El pasajero seleccionado no está inscripto en este viaje.");
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
    alert("Error al transferir: " + (e.message || "Intentá de nuevo"));
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/><path d="M6 8L2 12L6 16"/></svg> Confirmar transferencia`;
  }
}
