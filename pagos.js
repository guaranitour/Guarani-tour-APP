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

  // ── Cargar métodos (tabla: id, metodo_de_pago) ──
  if (pagosCtx.metodos.length === 0) {
    const { data, error } = await supabaseClient
      .from("metodos_de_pago")
      .select("id, metodo_de_pago")
      .order("metodo_de_pago");
    if (error) console.error("Error metodos:", error);
    pagosCtx.metodos = data || [];
  }

  // ── Cargar bancos (tabla: id, banco_id=nombre) ──
  if (pagosCtx.bancos.length === 0) {
    const { data, error } = await supabaseClient
      .from("bancos")
      .select("id, banco_id")
      .order("banco_id");
    if (error) console.error("Error bancos:", error);
    pagosCtx.bancos = data || [];
  }

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

  // Poblar select bancos
  const selBanco = document.getElementById("pago-banco");
  if (selBanco) {
    selBanco.innerHTML = `<option value="">— Sin banco —</option>` +
      pagosCtx.bancos.map(b => `<option value="${b.id}">${b.banco_id}</option>`).join("");
  }

  await loadPagosPasajero();
}

/* ── MOSTRAR BANCO Y COMPROBANTE SOLO PARA UENO ── */
function onMetodoChange() {
  const sel  = document.getElementById("pago-metodo");
  if (!sel) return;
  const texto = sel.options[sel.selectedIndex]?.text?.toUpperCase() || "";
  const esUeno = texto.includes("UENO");

  const wrapBanco  = document.getElementById("pago-banco-wrap");
  const wrapComp   = document.getElementById("pago-comprobante-wrap");
  const wrapFoto   = document.getElementById("pago-foto-wrap");

  if (wrapBanco) wrapBanco.style.display = esUeno ? "" : "none";
  if (wrapComp)  wrapComp.style.display  = esUeno ? "" : "none";
  if (wrapFoto)  wrapFoto.style.display  = esUeno ? "" : "none";
}

/* ── CARGAR PAGOS ───────────────────────────── */
async function loadPagosPasajero() {
  const listEl    = document.getElementById("pagos-list");
  const resumenEl = document.getElementById("pagos-resumen");
  if (!listEl) return;

  listEl.innerHTML = `<div class="pagos-loading">Cargando…</div>`;

  // Total a pagar
  const { data: vp } = await supabaseClient
    .from("viaje_pasajeros")
    .select("total_a_pagar")
    .eq("id", pagosCtx.viajePasajeroId)
    .single();

  pagosCtx.totalAPagar = vp?.total_a_pagar || 0;

  // ── Query PLANA sin joins ──
  const { data: pagos, error } = await supabaseClient
    .from("pagos")
    .select("id, monto, tipo, fecha_pago, comprobante_nro, observacion, foto_comprobante, creado_por, banco, metodo_pago_id")
    .eq("viaje_pasajero_id", pagosCtx.viajePasajeroId)
    .order("fecha_pago", { ascending: false });

  if (error) {
    listEl.innerHTML = `<div class="pagos-empty">Error al cargar pagos</div>`;
    console.error("Error pagos:", error);
    return;
  }

  // Totales
  let totalPagado = 0, totalDevuelto = 0, totalTransferido = 0;
  (pagos || []).forEach(p => {
    if (p.tipo === "Pago")          totalPagado      += p.monto || 0;
    if (p.tipo === "Devolución")    totalDevuelto    += p.monto || 0;
    if (p.tipo === "Transferencia") totalTransferido += p.monto || 0;
  });

  const neto  = totalPagado - totalDevuelto - totalTransferido;
  const saldo = pagosCtx.totalAPagar - neto;
  const pct   = pagosCtx.totalAPagar > 0
    ? Math.min(100, Math.round((neto / pagosCtx.totalAPagar) * 100)) : 0;

  // Resumen
  resumenEl.innerHTML = `
    <div class="pagos-resumen-grid">
      <div class="pagos-resumen-item">
        <span class="pr-label">Total a pagar</span>
        <span class="pr-value">Gs. ${pagosCtx.totalAPagar.toLocaleString("es-PY")}</span>
      </div>
      <div class="pagos-resumen-item pagado">
        <span class="pr-label">Pagado</span>
        <span class="pr-value">Gs. ${neto.toLocaleString("es-PY")}</span>
      </div>
      <div class="pagos-resumen-item ${saldo <= 0 ? "saldado" : "pendiente"}">
        <span class="pr-label">${saldo <= 0 ? "✅ Saldado" : "Saldo pendiente"}</span>
        <span class="pr-value">${saldo <= 0 ? "—" : "Gs. " + saldo.toLocaleString("es-PY")}</span>
      </div>
    </div>
    <div class="pagos-progress-wrap">
      <div class="pagos-progress-bar">
        <div class="pagos-progress-fill ${pct >= 100 ? "completo" : ""}" style="width:${pct}%"></div>
      </div>
      <span class="pagos-pct">${pct}%</span>
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
    return `
    <div class="pago-row">
      <div class="pago-row-top">
        <div class="pago-row-left">
          <span class="pago-tipo-badge ${cls}">${icon} ${p.tipo}</span>
          <span class="pago-fecha">${fecha}</span>
          ${p.comprobante_nro ? `<span class="pago-comp">Nº ${p.comprobante_nro}</span>` : ""}
        </div>
        <span class="pago-monto ${cls}">Gs. ${(p.monto || 0).toLocaleString("es-PY")}</span>
      </div>
      <div class="pago-row-bottom">
        <span class="pago-metodo">${metodo}${banco ? " · " + banco : ""}</span>
        ${p.observacion ? `<span class="pago-obs">${p.observacion}</span>` : ""}
        ${p.creado_por  ? `<span class="pago-by">por ${p.creado_por}</span>` : ""}
        ${p.foto_comprobante ? `<a class="pago-foto-link" href="${p.foto_comprobante}" target="_blank">📎 Ver comprobante</a>` : ""}
      </div>
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
  if (btn)  btn.style.display  = "";
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
function buscarPasajeroDestino() {
  const q    = document.getElementById("trans-buscar").value.toLowerCase().trim();
  const cont = document.getElementById("trans-resultados");
  if (!q) { cont.innerHTML = ""; return; }
  const resultados = (allPassengers || []).filter(p =>
    p.id !== pagosCtx.pasajeroId &&
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
  const { error } = await supabaseClient.storage.from("comprobantes").upload(fileName, file);
  if (error) throw error;
  const { data } = supabaseClient.storage.from("comprobantes").getPublicUrl(fileName);
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
  if (!monto || monto <= 0) { montoEl.classList.add("input-error"); montoEl.focus(); return; }
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
      viaje_pasajero_id : pagosCtx.viajePasajeroId,
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
      const { error: e2 } = await supabaseClient.from("pagos").insert([{
        ...base,
        pasajero_id        : pagosCtx.pasajeroDestino.id,
        tipo               : "Pago",
        referencia_pago_id : reg1.id,
        observacion        : `Transferencia desde ${pagosCtx.nombrePasajero}${obs ? " — " + obs : ""}`,
      }]);
      if (e2) throw e2;
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
