let viajeActualId = null;
let pasajeroSeleccionado = null;
let viajeActualData = null;
let pasajerosDelViaje = [];
/* ─────────────────────────────────────────────
   viajes_activos.js — Gestión de viajes
───────────────────────────────────────────── */

let allViajes = [];
let allVendedores = [];

/* ── CARGAR VIAJES ─────────────────────────── */
// modo: "activos" (default) → fecha_regreso >= hoy
//       "historico"         → fecha_regreso < hoy
async function loadViajes(modo = "activos") {
  const listId = modo === "historico" ? "historico-list" : "viajes-list";
  const list = document.getElementById(listId);
  if (!list) return;

  list.innerHTML = "Cargando…";

  const hoy = new Date().toISOString().split("T")[0];

  const query = supabaseClient
    .from("viajes")
    .select("*")
    .order("fecha_salida", { ascending: false });

  const { data, error } = await (
    modo === "historico"
      ? query.in("estado", ["completado", "cancelado"])
      : query.eq("estado", "activo")
  );

  if (error) {
    console.error(error);
    list.innerHTML = "Error al cargar viajes";
    return;
  }

  allViajes = data;

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin viajes registrados</div>`;
    return;
  }

  if (modo === "historico") {
    renderHistorico(data);
  } else {
    list.innerHTML = renderViajeCards(data);
  }
}

function renderViajeCards(data) {
  return data.map(v => {
  const estado = v.estado || "activo";
  const placeholder = `
    <div class="viaje-card-img-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
    </div>`;
  return `
  <div class="viaje-card" onclick="openViajeDetalle('${v.id}')">
    ${v.imagen_url ? `<img src="${v.imagen_url}" class="viaje-card-img" />` : placeholder}
    <div class="viaje-card-body">
      <div class="viaje-card-nombre">${v.nombre}</div>
      <div class="viaje-card-meta">
        <span class="viaje-pill ${estado}">${estado}</span>
        ${v.puntos_destino ? `<span class="viaje-puntos">⭐ ${v.puntos_destino} pts</span>` : ""}
        ${v.fecha_salida ? `
          <span class="viaje-card-fecha">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${formatFecha(v.fecha_salida)}
          </span>` : ""}
      </div>
    </div>
  </div>`
}).join("");
}

function renderHistorico(data) {
  const list = document.getElementById("historico-list");
  if (!list) return;
  if (!data || data.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin resultados</div>`;
    return;
  }
  list.innerHTML = renderViajeCards(data);
}

function filtrarHistorico() {
  const q = document.getElementById("historico-search")?.value.toLowerCase().trim() || "";
  const filtrados = q
    ? allViajes.filter(v => (v.nombre || "").toLowerCase().includes(q))
    : allViajes;
  renderHistorico(filtrados);
}

/* ── FORMATEAR FECHA ───────────────────────── */
function formatFecha(val) {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("es-PY");
}

/* ── SUBIR IMAGEN ─────────────────────────── */
async function uploadViajeImage(file) {
  const fileName = `${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("viajes")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("viajes")
    .getPublicUrl(fileName);

  return data.publicUrl;
}
async function uploadEgresoFile(file) {
  const fileName = `${viajeActualId}/${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("egresos")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("egresos")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

/* ── CREAR VIAJE ──────────────────────────── */
async function crearViaje() {
  const nombre   = document.getElementById("v-nombre").value.trim();
  const salida   = document.getElementById("v-salida").value;
  const regreso  = document.getElementById("v-regreso").value;
  const estado   = document.getElementById("v-estado").value;
  const puntos_destino = parseInt(document.getElementById("v-puntos").value) || 0;
  const file     = document.getElementById("v-imagen").files[0];

  if (!nombre) {
    alert("El nombre es obligatorio");
    return;
  }

  let imagen_url = null;

  if (file) {
    try {
      imagen_url = await uploadViajeImage(file);
    } catch (e) {
      console.error(e);
      alert("Error subiendo imagen");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("viajes")
    .insert([{
      nombre,
      fecha_salida: salida,
      fecha_regreso: regreso,
      estado,
      imagen_url,
      puntos_destino
    }]);

  if (error) {
    console.error(error);
    alert("Error al guardar viaje");
    return;
  }

  navigateTo("viajes");
}

/* ── EDITAR VIAJE ─────────────────────────── */
function irEditarViaje(viajeId) {
  navigateTo("viaje-editar", parseInt(viajeId, 10));
}

async function initFormEditarViaje(viajeId) {
  viajeActualId = parseInt(viajeId, 10);

  // Usar caché si ya tenemos el viaje cargado
  let viaje = viajeActualData && viajeActualData.id === viajeActualId
    ? viajeActualData
    : null;

  if (!viaje) {
    const { data } = await supabaseClient
      .from("viajes")
      .select("*")
      .eq("id", viajeActualId)
      .single();
    viaje = data;
  }

  if (!viaje) { alert("No se pudo cargar el viaje"); return; }

  viajeActualData = viaje;

  document.getElementById("ve-nombre").value  = viaje.nombre || "";
  document.getElementById("ve-salida").value  = viaje.fecha_salida || "";
  document.getElementById("ve-regreso").value = viaje.fecha_regreso || "";
  document.getElementById("ve-estado").value  = viaje.estado || "activo";
  document.getElementById("ve-puntos").value  = viaje.puntos_destino || 0;

  // Mostrar imagen actual si existe
  const preview = document.querySelector("#view-viaje-editar .viaje-imagen-preview");
  const overlay = document.getElementById("ve-img-overlay");
  if (preview && viaje.imagen_url) {
    const existing = preview.querySelector("img");
    if (existing) existing.remove();
    const img = document.createElement("img");
    img.src = viaje.imagen_url;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  }
}

async function guardarEditarViaje() {
  const nombre  = document.getElementById("ve-nombre").value.trim();
  const salida  = document.getElementById("ve-salida").value;
  const regreso = document.getElementById("ve-regreso").value;
  const estado  = document.getElementById("ve-estado").value;
  const puntos_destino = parseInt(document.getElementById("ve-puntos").value) || 0;
  const file    = document.getElementById("ve-imagen").files[0];

  if (!nombre) { alert("El nombre es obligatorio"); return; }

  const btn = document.getElementById("btn-guardar-editar-viaje");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  let imagen_url = viajeActualData?.imagen_url || null;

  if (file) {
    try {
      imagen_url = await uploadViajeImage(file);
    } catch (e) {
      console.error(e);
      alert("Error subiendo imagen");
      if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("viajes")
    .update({ nombre, fecha_salida: salida, fecha_regreso: regreso, estado, imagen_url, puntos_destino })
    .eq("id", viajeActualId);

  if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }

  if (error) {
    console.error(error);
    alert("Error al guardar cambios");
    return;
  }

  // Actualizar caché y volver al detalle
  viajeActualData = { ...viajeActualData, nombre, fecha_salida: salida, fecha_regreso: regreso, estado, imagen_url, puntos_destino };
  navigateTo("viaje-detalle", viajeActualId);
}

function previewViajeImgEditar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector("#view-viaje-editar .viaje-imagen-preview");
  const overlay = document.getElementById("ve-img-overlay");
  const reader  = new FileReader();
  reader.onload = (e) => {
    const prev = preview.querySelector("img");
    if (prev) prev.remove();
    const img = document.createElement("img");
    img.src = e.target.result;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ── PREVIEW IMAGEN FORMULARIO ─────────────── */
function previewViajeImg(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector(".viaje-imagen-preview");
  const overlay = document.getElementById("viaje-img-overlay");
  const reader = new FileReader();
  reader.onload = (e) => {
    const prev = preview.querySelector("img");
    if (prev) prev.remove();
    const img = document.createElement("img");
    img.src = e.target.result;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ── FAB HANDLER ──────────────────────────── */
function handleFabViajes() {
  navigateTo("viaje-nuevo");
}
function irAgregarPasajero() {
  if (!["admin", "worker"].includes(currentUserRole)) {
    alert("Solo lectura");
    return;
  }

  navigateTo("viaje-pasajero-nuevo", viajeActualId);
}

function initFormPasajero(viajeId) {
  viajeActualId = parseInt(viajeId, 10);
  pasajeroSeleccionado = null;

  document.getElementById("buscar-pasajero").value = "";
  document.getElementById("input-total").value = "";
  document.getElementById("resultados-pasajero").innerHTML = "";

  // 🔑 ESTA LÍNEA TE FALTABA
  if (allPassengers.length === 0) {
    loadPassengers();
  }
}

function openViajeDetalle(viajeId) {
  navigateTo("viaje-detalle", parseInt(viajeId, 10));
}
async function loadViajeDetalle(viajeId) {
  viajeActualId = parseInt(viajeId, 10);

  const nombreEl = document.getElementById("detalle-viaje-nombre");
  const infoEl = document.getElementById("detalle-viaje-info");
  const listEl = document.getElementById("viaje-pasajeros-list");

  listEl.innerHTML = "Cargando...";

  const { data: viaje } = await supabaseClient
    .from("viajes")
    .select("*")
    .eq("id", viajeId)
    .single();

  if (!viaje) return;

  // ✅ AHORA SÍ existe
  viajeActualData = viaje;

  nombreEl.textContent = viaje.nombre;
  const estado = viaje.estado || "activo";

  const esAdminDetalle = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  infoEl.innerHTML = `
    <span class="viaje-pill ${estado}" style="font-size:.75rem">${estado}</span>
    ${viaje.puntos_destino ? `<span class="viaje-puntos" style="margin-left:.4rem">⭐ ${viaje.puntos_destino} pts base</span>` : ""}
    ${viaje.fecha_salida ? `<span style="margin-left:.4rem;font-size:.8rem;color:var(--text-muted)">📅 ${formatFecha(viaje.fecha_salida)}${viaje.fecha_regreso ? " → " + formatFecha(viaje.fecha_regreso) : ""}</span>` : ""}
    ${esAdminDetalle ? `
    <button class="btn-editar-viaje" onclick="irEditarViaje(${viaje.id})" title="Editar viaje">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Editar
    </button>` : ""}
  `;


  const { data: pasajeros, error: errPasajeros } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      id,
      pasajero_id,
      total_a_pagar,
      puntos_destino,
      asistencia,
      pasajeros ( id, Pasajero, "Documento de Identidad", Vendedor )
    `)
    .eq("viaje_id", viajeId);

  if (errPasajeros) { console.error("Error cargando pasajeros:", errPasajeros); }
  console.log("viaje_pasajeros result:", pasajeros, "error:", errPasajeros);

  // Mostrar/ocultar botón agregar siempre (antes de posible return)
  const esWorkerOAdminEarly = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);
  const btnAgregarEarly = document.getElementById("btn-agregar-vp");
  if (btnAgregarEarly) btnAgregarEarly.style.display = esWorkerOAdminEarly ? "" : "none";

  if (!pasajeros || pasajeros.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        Sin pasajeros aún
      </div>`;
    return;
  }

  // Traer pagos por separado para calcular restante
  const vpIds = pasajeros.map(p => p.id);
  const { data: todosPagos } = await supabaseClient
    .from("pagos")
    .select("viaje_pasajero_id, monto, tipo")
    .in("viaje_pasajero_id", vpIds);

  const pagosPorVP = {};
  (todosPagos || []).forEach(pg => {
    if (!pagosPorVP[pg.viaje_pasajero_id]) pagosPorVP[pg.viaje_pasajero_id] = [];
    pagosPorVP[pg.viaje_pasajero_id].push(pg);
  });

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  // Guardar para filtrado — incluye campos pre-calculados para los filtros
  pasajerosDelViaje = pasajeros.map(p => {
    const _pgs         = pagosPorVP[p.id] || [];
    const _pagado      = _pgs.filter(pg => pg.tipo === "Pago").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _devuelto    = _pgs.filter(pg => pg.tipo === "Devolución").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _transferido = _pgs.filter(pg => pg.tipo === "Transferencia").reduce((s, pg) => s + (pg.monto || 0), 0);
    const total  = p.total_a_pagar || 0;
    const neto   = _pagado - _devuelto - _transferido;
    const esCanje = total === 0;
    let _pillClass;
    if (esCanje && neto > 0)       _pillClass = "excedente";
    else if (esCanje)              _pillClass = "canje";
    else if (neto > total)         _pillClass = "excedente";
    else if (total > 0 && neto >= total) _pillClass = "saldado";
    else if (neto / (total || 1) >= 0.5) _pillClass = "parcial";
    else                           _pillClass = "deuda";

    return {
      ...p,
      _nombre    : p.pasajeros?.Pasajero || "Sin nombre",
      _vendedor  : (p.pasajeros?.Vendedor || "").trim().replace(/\s+/g, " "),
      _esMiembro : (p.puntos_destino || 0) > 0,
      _pillClass,
      _pagos     : _pgs,
    };
  });

  // Mostrar/ocultar botón agregar
  const btnAgregar = document.getElementById("btn-agregar-vp");
  if (btnAgregar) btnAgregar.style.display = esWorkerOAdmin ? "" : "none";

  // Mostrar tabs según rol
  const tabEgresos = document.getElementById("tab-egresos");
  if (tabEgresos) tabEgresos.style.display = esWorkerOAdmin ? "" : "none";
  const tabPres = document.getElementById("tab-presupuesto");
  if (tabPres) tabPres.style.display = esWorkerOAdmin ? "" : "none";
  const tabRes = document.getElementById("tab-resumen");
  if (tabRes) tabRes.style.display = esWorkerOAdmin ? "" : "none";

  // Limpiar buscador y filtros al cargar
  const buscador = document.getElementById("buscador-vp");
  if (buscador) buscador.value = "";
  _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "" };
  const panelF = document.getElementById("filtro-panel-vp");
  if (panelF) panelF.style.display = "none";

  // Inyectar botón filtro junto al buscador (solo una vez)
  _inyectarUIFiltros();

  renderPasajerosViaje(pasajerosDelViaje, esAdmin, pagosPorVP);
}

// Estado de filtros activos
let _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "" };

function filtrarPasajerosViaje(q) {
  _aplicarFiltrosVP(q);
}

function _aplicarFiltrosVP(qOverride) {
  const q = (qOverride !== undefined)
    ? qOverride
    : (document.getElementById("buscador-vp")?.value || "");

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  let filtrados = pasajerosDelViaje;

  // Filtro texto
  if (q.trim()) {
    filtrados = filtrados.filter(p =>
      p._nombre.toLowerCase().includes(q.toLowerCase())
    );
  }

  // Filtro vendedor
  if (_filtrosVP.vendedor) {
    filtrados = filtrados.filter(p => p._vendedor === _filtrosVP.vendedor);
  }

  // Filtro membresía
  if (_filtrosVP.miembro === "si") {
    filtrados = filtrados.filter(p => p._esMiembro);
  } else if (_filtrosVP.miembro === "no") {
    filtrados = filtrados.filter(p => !p._esMiembro);
  }

  // Filtro asistencia
  if (_filtrosVP.asistencia) {
    filtrados = filtrados.filter(p => (p.asistencia || "Asiste") === _filtrosVP.asistencia);
  }

  // Filtro estado de pago
  if (_filtrosVP.pago) {
    filtrados = filtrados.filter(p => p._pillClass === _filtrosVP.pago);
  }

  const pagosPorVP = {};
  pasajerosDelViaje.forEach(p => { pagosPorVP[p.id] = p._pagos; });
  renderPasajerosViaje(filtrados, esAdmin, pagosPorVP);
  _actualizarBadgeFiltros();
}

function _actualizarBadgeFiltros() {
  const activos = Object.values(_filtrosVP).filter(Boolean).length;
  const badge = document.getElementById("filtro-badge");
  const btn   = document.getElementById("btn-filtro-vp");
  if (badge) {
    badge.textContent = activos;
    badge.style.display = activos > 0 ? "" : "none";
  }
  if (btn) {
    btn.classList.toggle("filtro-activo", activos > 0);
  }
}

function _inyectarUIFiltros() {
  // Envolver el buscador en un row con el botón filtro (solo si no existe aún)
  const buscadorWrap = document.querySelector("#panel-pasajeros .form-buscar-wrap");
  if (!buscadorWrap) return;

  // Si ya existe el row, no volver a inyectar
  if (document.getElementById("btn-filtro-vp")) return;

  // Crear el wrapper row
  const row = document.createElement("div");
  row.className = "buscador-filtro-row";
  buscadorWrap.parentNode.insertBefore(row, buscadorWrap);
  row.appendChild(buscadorWrap);

  // Botón de filtro
  const btn = document.createElement("button");
  btn.id = "btn-filtro-vp";
  btn.className = "btn-filtro-vp";
  btn.title = "Filtrar pasajeros";
  btn.setAttribute("onclick", "toggleFiltroPanel()");
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
      <line x1="10" y1="18" x2="14" y2="18"/>
    </svg>
    <span class="filtro-badge" id="filtro-badge" style="display:none">0</span>`;
  row.appendChild(btn);

  // Panel de filtros (oculto por defecto)
  const panel = document.createElement("div");
  panel.id = "filtro-panel-vp";
  panel.className = "filtro-panel-vp";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="filtro-panel-title">Filtrar pasajeros</div>
    <div class="filtro-panel-fields">
      <div class="form-field full">
        <label class="form-label">Vendedor</label>
        <select id="filtro-sel-vendedor" class="form-input">
          <option value="">Todos</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Club Destino</label>
        <select id="filtro-sel-miembro" class="form-input">
          <option value="">Todos</option>
          <option value="si">⭐ Miembro</option>
          <option value="no">No miembro</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Estado de pago</label>
        <select id="filtro-sel-pago" class="form-input">
          <option value="">Todos</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Asistencia</label>
        <select id="filtro-sel-asistencia" class="form-input">
          <option value="">Todos</option>
          <option value="Asiste">✅ Asiste</option>
          <option value="No asiste">❌ No asiste</option>
        </select>
      </div>
    </div>
    <div class="filtro-panel-actions">
      <button class="btn-filtro-limpiar" onclick="limpiarFiltros()">Limpiar</button>
      <button class="btn-filtro-aplicar" onclick="aplicarFiltros()">Aplicar</button>
    </div>`;

  // Insertar panel después del row
  row.parentNode.insertBefore(panel, row.nextSibling);
}

function toggleFiltroPanel()  {
  const panel = document.getElementById("filtro-panel-vp");
  if (!panel) return;
  const abierto = panel.style.display !== "none";
  panel.style.display = abierto ? "none" : "";
  if (!abierto) _renderFiltroPanel();
}

function _renderFiltroPanel() {
  // Vendedores únicos ya normalizados
  const vendedores = [...new Set(
    pasajerosDelViaje.map(p => p._vendedor).filter(Boolean)
  )].sort();

  // Estados de pago que realmente existen en este viaje
  const pillLabels = {
    saldado: "✅ Saldado", parcial: "🟡 Parcial", deuda: "🔴 Deuda",
    canje: "🔄 Canje", excedente: "⚠️ Excedente"
  };
  const pagosPresentes = [...new Set(pasajerosDelViaje.map(p => p._pillClass))];

  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");

  if (selVend) {
    selVend.innerHTML = `<option value="">Todos</option>` +
      vendedores.map(v => `<option value="${v}" ${_filtrosVP.vendedor === v ? "selected" : ""}>${v}</option>`).join("");
  }
  if (selMiem) selMiem.value = _filtrosVP.miembro;
  if (selPago) {
    selPago.innerHTML = `<option value="">Todos</option>` +
      Object.entries(pillLabels)
        .filter(([k]) => pagosPresentes.includes(k))
        .map(([k, label]) => `<option value="${k}" ${_filtrosVP.pago === k ? "selected" : ""}>${label}</option>`)
        .join("");
  }
  if (selAsist) selAsist.value = _filtrosVP.asistencia;
}

function aplicarFiltros() {
  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");
  _filtrosVP.vendedor   = selVend?.value  || "";
  _filtrosVP.miembro    = selMiem?.value  || "";
  _filtrosVP.pago       = selPago?.value  || "";
  _filtrosVP.asistencia = selAsist?.value || "";
  document.getElementById("filtro-panel-vp").style.display = "none";
  _aplicarFiltrosVP();
}

function limpiarFiltros() {
  _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "" };
  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");
  if (selVend)  selVend.value  = "";
  if (selMiem)  selMiem.value  = "";
  if (selPago)  selPago.value  = "";
  if (selAsist) selAsist.value = "";
  document.getElementById("filtro-panel-vp").style.display = "none";
  _aplicarFiltrosVP();
}

function renderPasajerosViaje(pasajeros, esAdmin, pagosPorVP) {
  const listEl = document.getElementById("viaje-pasajeros-list");

  if (!pasajeros || pasajeros.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Sin resultados
      </div>`;
    return;
  }

  listEl.innerHTML = pasajeros.map(p => {
    const nombre   = p._nombre || p.pasajeros?.Pasajero || "Sin nombre";
    const nombreE  = nombre.replace(/'/g, "\\'");
    const pid      = p.pasajero_id || p.pasajeros?.id || "";
    const total    = p.total_a_pagar || 0;
    const esCanje  = total === 0;
    const _pgs         = pagosPorVP[p.id] || [];
    const _pagado      = _pgs.filter(pg => pg.tipo === "Pago").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _devuelto    = _pgs.filter(pg => pg.tipo === "Devolución").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _transferido = _pgs.filter(pg => pg.tipo === "Transferencia").reduce((s, pg) => s + (pg.monto || 0), 0);
    const neto         = _pagado - _devuelto - _transferido;
    const excedente    = esCanje ? neto : Math.max(0, neto - total);
    const restante     = esCanje ? 0 : Math.max(0, total - neto);
    const saldado      = !esCanje && restante === 0 && total > 0;
    const hayExcedente = !esCanje && neto > total;

    const pct = total > 0 ? neto / total : 0;
    let pillClass, pillLabel;
    if (esCanje && neto > 0) {
      pillClass = "excedente";
      pillLabel = `⚠️ Exc. Gs. ${excedente.toLocaleString("es-PY")}`;
    } else if (esCanje) {
      pillClass = "saldado";
      pillLabel = "🔄 Canje";
    } else if (hayExcedente) {
      pillClass = "excedente";
      pillLabel = `⚠️ Exc. Gs. ${excedente.toLocaleString("es-PY")}`;
    } else if (saldado) {
      pillClass = "saldado";
      pillLabel = "✅ Saldado";
    } else {
      pillClass = pct >= 0.5 ? "parcial" : "deuda";
      pillLabel = `Gs. ${restante.toLocaleString("es-PY")}`;
    }

    return `
    <div class="viaje-pasajero-row">
      <div class="vp-info" style="cursor:pointer;flex:1;min-width:0"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">
        <div class="vp-nombre">${nombre}</div>
      </div>
      <div class="vp-pills" style="cursor:pointer"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">
        <span class="vp-pill ${pillClass}">${pillLabel}</span>
      </div>
      ${esAdmin ? `
      <button class="btn-editar-vp" title="Editar"
        onclick="abrirEdicionVP(event, '${p.id}', ${total}, ${p.puntos_destino || 0}, '${p.asistencia || "Asiste"}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>` : ""}
      <button class="btn-pdf-vp" title="Descargar historial de pagos"
        onclick="generarHistorialPDF(event, '${p.id}', '${nombreE}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 18 15 15"/>
        </svg>
      </button>
      <div class="vp-chevron" style="cursor:pointer"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">›</div>
    </div>`;
  }).join("");
}

function abrirEdicionVP(event, vpId, total, puntos, asistencia) {
  event.stopPropagation();

  // Cerrar cualquier form abierto
  document.querySelectorAll(".vp-edit-form").forEach(el => el.remove());
  document.querySelectorAll(".btn-editar-vp.activo").forEach(el => el.classList.remove("activo"));

  const btn = event.currentTarget;
  btn.classList.add("activo");
  const row = btn.closest(".viaje-pasajero-row");

  const form = document.createElement("div");
  form.className = "vp-edit-form";
  form.innerHTML = `
    <div class="vp-edit-inner">
      <div class="vp-edit-field" style="grid-column:1/-1">
        <label class="pcf-label">Total a pagar (Gs.) <span class="req">*</span></label>
        <input type="number" id="vpe-total" class="form-input" value="${total}" min="0" />
      </div>
      <div class="vp-edit-field">
        <label class="pcf-label">Puntos destino</label>
        <input type="number" id="vpe-puntos" class="form-input" value="${puntos}" min="0" />
      </div>
      <div class="vp-edit-field">
        <label class="pcf-label">Asistencia</label>
        <select id="vpe-asistencia" class="form-input">
          <option value="Asiste" ${asistencia === "Asiste" ? "selected" : ""}>Asiste</option>
          <option value="No asiste" ${asistencia === "No asiste" ? "selected" : ""}>No asiste</option>
        </select>
      </div>
      <div class="vp-edit-actions">
        <button class="btn-cancel" onclick="cerrarEdicionVP()">Cancelar</button>
        <button class="btn-save" onclick="guardarEdicionVP('${vpId}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Guardar
        </button>
      </div>
    </div>`;

  row.after(form);
}

function cerrarEdicionVP() {
  document.querySelectorAll(".vp-edit-form").forEach(el => el.remove());
  document.querySelectorAll(".btn-editar-vp.activo").forEach(el => el.classList.remove("activo"));
}

async function guardarEdicionVP(vpId) {
  const total      = parseInt(document.getElementById("vpe-total").value);
  const puntosInput = parseInt(document.getElementById("vpe-puntos").value) || 0;
  const asistencia = document.getElementById("vpe-asistencia").value;

  if (total == null || isNaN(total) || total < 0) {
    document.getElementById("vpe-total").classList.add("error");
    return;
  }

  const btn = document.querySelector(".vp-edit-form .btn-save");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  // Si No asiste, puntos siempre 0. Si Asiste, respetar el valor manual del input.
  const puntosAsignar = asistencia === "No asiste" ? 0 : puntosInput;

  const { error } = await supabaseClient
    .from("viaje_pasajeros")
    .update({ total_a_pagar: total, puntos_destino: puntosAsignar, asistencia })
    .eq("id", vpId);

  btn.disabled = false;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;

  if (error) {
    alert("Error al guardar. Intentá de nuevo.");
    return;
  }

  cerrarEdicionVP();
  loadViajeDetalle(viajeActualId);
}
async function guardarPasajeroEnViaje() {
  try {
    if (!viajeActualId) {
      alert("Error: no hay viaje seleccionado");
      return;
    }

    if (!pasajeroSeleccionado) {
      alert("Seleccioná un pasajero");
      return;
    }

    const total = parseInt(document.getElementById("input-total").value);

    if (total == null || isNaN(total) || total < 0) {
      alert("Ingresá un monto válido");
      return;
    }

    console.log("Guardando...", {
      viaje_id: viajeActualId,
      pasajero_id: pasajeroSeleccionado.id,
      total
    });

// ✅ CORRECTO
const { data: { user } } = await supabaseClient.auth.getUser();

// Verificar si el pasajero ya es miembro Club Destino (≥2 viajes previos con Asiste)
const { data: viajesPrevios } = await supabaseClient
  .from("viaje_pasajeros")
  .select("id")
  .eq("pasajero_id", pasajeroSeleccionado.id)
  .eq("asistencia", "Asiste");

const viajesCount = (viajesPrevios || []).length; // Este nuevo será el siguiente
const esMiembro   = viajesCount >= 2; // Con este nuevo viaje llega a 3+

// Obtener puntos base del viaje actual
const { data: viajeData } = await supabaseClient
  .from("viajes")
  .select("puntos_destino")
  .eq("id", viajeActualId)
  .single();

const puntosViaje = viajeData?.puntos_destino || 0;
const puntosAsignar = esMiembro ? puntosViaje : 0;

const { error } = await supabaseClient
  .from("viaje_pasajeros")
  .insert([{
    viaje_id: viajeActualId,
    pasajero_id: pasajeroSeleccionado.id,
    total_a_pagar: total,
    asistencia: "Asiste",
    puntos_destino: puntosAsignar,
    creado_por: user.email
  }]);

    if (error) {
      console.error("ERROR SUPABASE:", error);
      alert("Error al guardar en base de datos");
      return;
    }

    alert("✅ Pasajero agregado correctamente");

    navigateTo("viaje-detalle", viajeActualId);
  } catch (e) {
    console.error("ERROR GENERAL:", e);
    alert("Error inesperado");
  }
}
function buscarPasajero() {
  const q = document.getElementById("buscar-pasajero").value.toLowerCase().trim();
  const cont = document.getElementById("resultados-pasajero");

  if (!q) {
    cont.innerHTML = "";
    pasajeroSeleccionado = null;
    return;
  }

  const resultados = allPassengers.filter(p =>
    (p.Pasajero || "").toLowerCase().includes(q) ||
    (p["Documento de Identidad"] || "").toLowerCase().includes(q)
  );

  if (resultados.length === 0) {
    cont.innerHTML = `
      <div class="pasajero-crear-wrap">
        <div class="pasajero-crear-msg">Sin resultados para "<strong>${q}</strong>"</div>
        <div class="pasajero-item pasajero-item-nuevo" onclick="mostrarFormCrearPasajero('${q.trim()}')">
          <div class="pasajero-item-nuevo-inner">
            <span class="pasajero-crear-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </span>
            <div>
              <strong>Crear "${q.trim()}"</strong>
              <div class="ci">Se agregará a la base de clientes</div>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  cont.innerHTML = resultados.map(p => `
    <div class="pasajero-item" onclick="seleccionarPasajero(${p._idx})">
      <div class="pasajero-item-inner">
        <div>
          <strong>${p.Pasajero}</strong>
          <div class="ci">CI: ${p["Documento de Identidad"] || "—"}</div>
        </div>
        <span class="pasajero-select-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      </div>
    </div>
  `).join("");
}
function seleccionarPasajero(idx) {
  const p = allPassengers.find(x => x._idx === idx);
  if (!p) return;

  pasajeroSeleccionado = p;

  document.getElementById("buscar-pasajero").value = p.Pasajero;

  document.getElementById("resultados-pasajero").innerHTML = `
    <div class="pasajero-seleccionado">
      ✅ ${p.Pasajero} (CI ${p["Documento de Identidad"]})
    </div>
  `;
}
async function mostrarFormCrearPasajero(nombre) {
  const cont = document.getElementById("resultados-pasajero");

  // Cargar vendedores si no están en caché
  if (allVendedores.length === 0) {
    const { data } = await supabaseClient
      .from("vendedores")
      .select('Nombre_del_vendedor')
      .order('Nombre_del_vendedor', { ascending: true });
    allVendedores = data || [];
  }

  const optsVendedor = allVendedores
    .map(v => `<option value="${v.Nombre_del_vendedor}">${v.Nombre_del_vendedor}</option>`)
    .join("");

  cont.innerHTML = `
    <div class="pasajero-crear-form">
      <div class="pasajero-crear-form-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo cliente
      </div>

      <div class="pcf-field">
        <label class="pcf-label">Nombre completo <span class="req">*</span></label>
        <input id="pcf-nombre" class="form-input" type="text" value="${nombre}" placeholder="Nombre completo" />
      </div>

      <div class="pcf-row">
        <div class="pcf-field">
          <label class="pcf-label">Sexo</label>
          <select id="pcf-sexo" class="form-input">
            <option value="">— Seleccionar —</option>
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
        <div class="pcf-field">
          <label class="pcf-label">Vendedor</label>
          <select id="pcf-vendedor" class="form-input">
            <option value="">— Seleccionar —</option>
            ${optsVendedor}
          </select>
        </div>
      </div>

      <div class="pcf-actions">
        <button class="btn-cancel pcf-btn-cancel" onclick="document.getElementById('resultados-pasajero').innerHTML=''">
          Cancelar
        </button>
        <button class="btn-save pcf-btn-save" onclick="confirmarCrearPasajero()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Guardar
        </button>
      </div>
    </div>
  `;
}

async function confirmarCrearPasajero() {
  const nombre   = capitalizarNombre(document.getElementById("pcf-nombre")?.value.trim());
  const sexo     = document.getElementById("pcf-sexo")?.value || null;
  const vendedor = document.getElementById("pcf-vendedor")?.value || null;
  const cont     = document.getElementById("resultados-pasajero");

  if (!nombre) {
    document.getElementById("pcf-nombre")?.classList.add("error");
    return;
  }

  const saveBtn = cont.querySelector(".pcf-btn-save");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Guardando…"; }

  const { data, error } = await supabaseClient
    .from("pasajeros")
    .insert([{ Pasajero: nombre, Sexo: sexo, Vendedor: vendedor }])
    .select()
    .single();

  if (error) {
    console.error("Error creando pasajero:", error);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
    }
    let errEl = cont.querySelector(".pcf-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "pcf-error";
      cont.querySelector(".pasajero-crear-form").appendChild(errEl);
    }
    errEl.textContent = "Error al guardar. Intentá de nuevo.";
    return;
  }

  const nuevoIdx = allPassengers.length;
  const nuevoPasajero = { ...data, _idx: nuevoIdx };
  allPassengers.push(nuevoPasajero);

  pasajeroSeleccionado = nuevoPasajero;
  document.getElementById("buscar-pasajero").value = nombre;
  cont.innerHTML = `
    <div class="pasajero-seleccionado">
      ✅ ${nombre} <span style="font-weight:400;opacity:.7">(nuevo cliente agregado)</span>
    </div>
  `;
}

function capitalizarNombre(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/* ── TABS VIAJE DETALLE ────────────────────── */
function switchViajeTab(tab) {
  // Redirigir viewer si intenta acceder a tabs restringidos
  const _esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);
  if (!_esWorkerOAdmin && (tab === "egresos" || tab === "presupuesto" || tab === "resumen")) {
    tab = "pasajeros";
  }

  // Botones
  document.getElementById("tab-pasajeros").classList.toggle("active", tab === "pasajeros");
  document.getElementById("tab-egresos").classList.toggle("active", tab === "egresos");
  const tabPres = document.getElementById("tab-presupuesto");
  if (tabPres) tabPres.classList.toggle("active", tab === "presupuesto");
  const tabRes = document.getElementById("tab-resumen");
  if (tabRes) tabRes.classList.toggle("active", tab === "resumen");

  // Paneles
  document.getElementById("panel-pasajeros").style.display   = tab === "pasajeros"   ? "" : "none";
  document.getElementById("panel-egresos").style.display     = tab === "egresos"     ? "" : "none";
  const panelPres = document.getElementById("panel-presupuesto");
  if (panelPres) panelPres.style.display = tab === "presupuesto" ? "" : "none";
  const panelRes = document.getElementById("panel-resumen");
  if (panelRes) panelRes.style.display = tab === "resumen" ? "" : "none";

  if (tab === "egresos")     loadEgresos(viajeActualId);
  if (tab === "presupuesto") loadPresupuesto(viajeActualId);
  if (tab === "resumen")     loadResumen(viajeActualId);
}

/* ── EGRESOS ───────────────────────────────── */

// Caché para los selects del form
let _egresosCategorias = [];
let _egresosMetodos    = [];

async function loadEgresos(viajeId) {
  const listEl = document.getElementById("egresos-list");
  const btnAdd = document.getElementById("btn-agregar-egreso");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);

  if (btnAdd) btnAdd.style.display = esWorkerOAdmin ? "" : "none";

  // Query principal de egresos
  const { data, error } = await supabaseClient
    .from("egresos")
    .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente")
    .eq("viaje_id", viajeId)
    .order("fecha", { ascending: false });

  if (error) {
    console.error("Error cargando egresos:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar egresos</div>`;
    return;
  }

  // Traer nombres de categorías y métodos de pago por separado (más robusto que el join)
  const [{ data: catData }, { data: metData }] = await Promise.all([
    supabaseClient.from("categorias").select("id, nombre"),
    supabaseClient.from("metodos_de_pago").select("id, nombre")
  ]);
  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries((metData || []).map(m => [m.id, m.metodo_de_pago]));

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Sin egresos registrados
      </div>`;
    return;
  }

  const totalEgresos = data.reduce((s, e) => s + (e.monto || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row">
      <span class="egresos-total-label">Total egresos</span>
      <span class="egresos-total-valor">Gs. ${totalEgresos.toLocaleString("es-PY")}</span>
    </div>
    ${data.map(e => {
      const categoria = catMap[e.categoria_id] || "Sin categoría";
      const caja      = metMap[e.caja_saliente] || "—";
      const fecha     = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
      return `
  <div class="egreso-row" style="cursor:pointer"
       onclick="abrirEgresoDetalle('${e.id}', '${viajeId}')">
    <div class="egreso-info">
      <div class="egreso-concepto">${categoria}</div>
      <div class="egreso-fecha">${fecha}${e.ejecutor ? " · " + e.ejecutor : ""}</div>
    </div>
    <div style="display:flex;align-items:center;gap:.5rem">
      <div class="egreso-monto">Gs. ${(e.monto || 0).toLocaleString("es-PY")}</div>
      <span style="color:var(--text-muted);font-size:1.1rem">›</span>
    </div>
  </div>
`;    }).join("")}
  `;

  // Mover botón "Registrar egreso" justo después del total-row
  if (btnAdd) {
    const totalRow = listEl.querySelector(".egresos-total-row");
    if (totalRow) {
      btnAdd.style.marginTop = ".5rem";
      btnAdd.style.marginBottom = ".5rem";
      totalRow.after(btnAdd);
    }
  }
}

async function _cargarOpcionesFormEgreso() {
  // Categorías: solo las presupuestadas para este viaje + exclusivas del viaje
  // Siempre re-consultamos (el caché se invalida en mostrarFormEgreso)
  const [
    { data: presupuestadas },
    { data: exclusivas }
  ] = await Promise.all([
    // Categorías con presupuesto en este viaje (join con presupuesto_viaje)
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, categorias(id, nombre, scope)")
      .eq("viaje_id", parseInt(viajeActualId)),
    // Categorías exclusivas del viaje (scope = viajeActualId), aunque no estén presupuestadas
    supabaseClient
      .from("categorias")
      .select("id, nombre, scope")
      .eq("scope", parseInt(viajeActualId))
      .order("nombre", { ascending: true })
  ]);

  // Armar lista deduplicada
  const vistos = new Set();
  _egresosCategorias = [];

  (presupuestadas || []).forEach(row => {
    const c = row.categorias;
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });
  (exclusivas || []).forEach(c => {
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });

  // Ordenar alfabéticamente
  _egresosCategorias.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Métodos de pago (caja saliente)
  if (_egresosMetodos.length === 0) {
    const { data } = await supabaseClient
      .from("metodos_de_pago")
      .select("id, metodo_de_pago")
      .order("metodo_de_pago", { ascending: true });
    _egresosMetodos = data || [];
  }

  const selCat = document.getElementById("egreso-categoria");
  const selCaja = document.getElementById("egreso-caja");

  if (selCat) {
    const opcionesCats = _egresosCategorias.length > 0
      ? _egresosCategorias.map(c => {
          const label = c.scope ? `${c.nombre} (exclusiva)` : c.nombre;
          return `<option value="${c.id}">${label}</option>`;
        }).join("")
      : "";

    selCat.innerHTML =
      `<option value="">— Seleccionar categoría —</option>` +
      opcionesCats +
      `<option value="__nuevo__">+ Otro tipo…</option>`;

    // Mostrar/ocultar input de nueva categoría al cambiar
    selCat.onchange = () => _toggleNuevaCategoriaInput(selCat.value === "__nuevo__");
  }

  if (selCaja) {
    selCaja.innerHTML = `<option value="">— Seleccionar caja —</option>` +
      _egresosMetodos.map(m => `<option value="${m.id}">${m.metodo_de_pago}</option>`).join("");
  }
}

function _toggleNuevaCategoriaInput(mostrar) {
  let wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (mostrar) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "egreso-nueva-cat-wrap";
      wrap.style.cssText = "margin-top:.5rem";
      wrap.innerHTML = `
        <input id="egreso-nueva-cat-nombre" class="form-input"
               type="text" placeholder="Nombre del nuevo tipo de egreso" />
      `;
      document.getElementById("egreso-categoria").after(wrap);
    }
    wrap.style.display = "";
    document.getElementById("egreso-nueva-cat-nombre")?.focus();
  } else if (wrap) {
    wrap.style.display = "none";
  }
}

async function mostrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (!form) return;

  // Fecha de hoy por defecto
  const fechaEl = document.getElementById("egreso-fecha");
  if (fechaEl && !fechaEl.value) {
    fechaEl.value = new Date().toISOString().split("T")[0];
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";

  // Invalidar caché si cambiamos de viaje
  _egresosCategorias = [];
  await _cargarOpcionesFormEgreso();
}

function cerrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (form) form.style.display = "none";
  if (btn) {
    const esWorkerOAdmin = Array.isArray(currentUserRole)
      ? currentUserRole.some(r => ["admin", "worker"].includes(r))
      : ["admin", "worker"].includes(currentUserRole);
    btn.style.display = esWorkerOAdmin ? "" : "none";
  }

  ["egreso-categoria", "egreso-monto", "egreso-fecha", "egreso-descripcion", "egreso-ejecutor", "egreso-caja", "egreso-archivo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Limpiar input de nueva categoría si quedó visible
  const wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (wrap) wrap.remove();
}

async function guardarEgreso() {
  let categoriaSelVal = document.getElementById("egreso-categoria")?.value;
  const monto        = parseInt(document.getElementById("egreso-monto")?.value);
  const fecha        = document.getElementById("egreso-fecha")?.value || null;
  const descripcion  = document.getElementById("egreso-descripcion")?.value.trim() || null;
  const ejecutor     = document.getElementById("egreso-ejecutor")?.value.trim();
  const cajaId       = document.getElementById("egreso-caja")?.value;
  const archivo      = document.getElementById("egreso-archivo")?.files[0];
  const nuevaCatNombre = document.getElementById("egreso-nueva-cat-nombre")?.value.trim();

  // Validaciones
  let valido = true;
  if (!categoriaSelVal) {
    document.getElementById("egreso-categoria")?.classList.add("error");
    valido = false;
  }
  if (categoriaSelVal === "__nuevo__" && !nuevaCatNombre) {
    document.getElementById("egreso-nueva-cat-nombre")?.classList.add("error");
    valido = false;
  }
  if (!monto || monto <= 0) {
    document.getElementById("egreso-monto")?.classList.add("error");
    valido = false;
  }
  if (!fecha) {
    document.getElementById("egreso-fecha")?.classList.add("error");
    valido = false;
  }
  if (!ejecutor) {
    document.getElementById("egreso-ejecutor")?.classList.add("error");
    valido = false;
  }
  if (!cajaId) {
    document.getElementById("egreso-caja")?.classList.add("error");
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById("btn-guardar-egreso");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  // Si eligió "+ Otro tipo…", crear la categoría exclusiva del viaje primero
  let categoriaId = categoriaSelVal;
  if (categoriaSelVal === "__nuevo__") {
    const { data: nuevaCat, error: errCat } = await supabaseClient
      .from("categorias")
      .insert([{ nombre: nuevaCatNombre, scope: parseInt(viajeActualId) }])
      .select("id")
      .single();

    if (errCat || !nuevaCat) {
      console.error("Error creando categoría:", errCat);
      alert("Error al crear el tipo de egreso. Intentá de nuevo.");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
    categoriaId = nuevaCat.id;
    // Invalidar caché de categorías para que la próxima apertura del form la muestre
    _egresosCategorias = [];
  }

  const { data: { user } } = await supabaseClient.auth.getUser();

  let comprobante_url = null;

  if (archivo) {
    try {
      comprobante_url = await uploadEgresoFile(archivo);
    } catch (e) {
      console.error(e);
      alert("Error subiendo comprobante");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("egresos")
    .insert([{
      viaje_id: viajeActualId,
      categoria_id: categoriaId,
      monto,
      descripcion,
      fecha,
      ejecutor,
      caja_saliente: cajaId,
      comprobante_nro: comprobante_url,
      creado_por: user?.email || null
    }]);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando egreso:", error);
    alert("Error al guardar el egreso. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormEgreso();
  loadEgresos(viajeActualId);
}

/* ── EGRESO DETALLE ────────────────────────── */

function abrirEgresoDetalle(egresoId, viajeId) {
  navigateTo("egreso-detalle", { egresoId, viajeId });
}

async function initEgresoDetalleView({ egresoId, viajeId }) {
  const cont = document.getElementById("egreso-detalle-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  // Query egreso + categorías + métodos en paralelo
  const [
    { data: e, error },
    { data: catData },
    { data: metData }
  ] = await Promise.all([
    supabaseClient.from("egresos")
      .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente, comprobante_nro")
      .eq("id", egresoId)
      .single(),
    supabaseClient.from("categorias").select("id, nombre"),
    supabaseClient.from("metodos_de_pago").select("id, metodo_de_pago")
  ]);

  if (error || !e) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar el egreso.</div>`;
    return;
  }

  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries((metData || []).map(m => [m.id, m.metodo_de_pago]));

  const categoria  = catMap[e.categoria_id] || "Sin categoría";
  const caja       = metMap[e.caja_saliente] || "—";
  const fecha      = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
  const monto      = (e.monto || 0).toLocaleString("es-PY");
  const descripcion = e.descripcion || "—";
  const ejecutor   = e.ejecutor || "—";
  const creadoPor  = e.creado_por || "—";

  const comprobanteHtml = e.comprobante_nro
    ? `<a href="${e.comprobante_nro}" target="_blank" class="egreso-det-comprobante">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Ver comprobante
      </a>`
    : `<span class="egreso-det-sin-comprobante">Sin comprobante adjunto</span>`;

  cont.innerHTML = `
    <div class="egreso-det-monto-hero">
      <span class="egreso-det-monto-label">Monto</span>
      <span class="egreso-det-monto-valor">Gs. ${monto}</span>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Información
      </div>
      <div class="egreso-det-grid">
        <div class="egreso-det-field">
          <span class="egreso-det-label">Categoría</span>
          <span class="egreso-det-value">${categoria}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Fecha</span>
          <span class="egreso-det-value">${fecha}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Caja saliente</span>
          <span class="egreso-det-value">${caja}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Ejecutor</span>
          <span class="egreso-det-value">${ejecutor}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Descripción</span>
          <span class="egreso-det-value">${descripcion}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Registrado por</span>
          <span class="egreso-det-value">${creadoPor}</span>
        </div>
      </div>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Comprobante
      </div>
      ${comprobanteHtml}
    </div>
  `;
}

/* ── PRESUPUESTO ───────────────────────────── */

let _presupuestoCategorias = [];   // caché de categorías globales
let _presupuestoOriginal   = {};   // { categoria_id: monto } al cargar para detectar cambios
let _presupuestoModoEdicion = false;

async function loadPresupuesto(viajeId) {
  const listEl  = document.getElementById("presupuesto-list");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const formEl  = document.getElementById("form-presupuesto");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
  if (formEl)  formEl.style.display  = "none";

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  // Traer presupuesto guardado + categorías en paralelo
  const [{ data: filas, error }, { data: globales }, { data: locales }] = await Promise.all([
    supabaseClient
      .from("presupuesto_viaje")
      .select("id, categoria_id, monto_presupuestado")
      .eq("viaje_id", viajeId),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true }),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .eq("scope", parseInt(viajeId))
      .order("nombre", { ascending: true })
  ]);

  if (error) {
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar presupuesto.</div>`;
    return;
  }

  _presupuestoCategorias = [...(globales || []), ...(locales || [])];

  const hayPresupuesto = filas && filas.length > 0;

  if (!hayPresupuesto) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Sin presupuesto registrado
      </div>`;
    if (btnReg && esWorkerOAdmin) btnReg.style.display = "";
    return;
  }

  // Hay presupuesto — construir mapa para renderizar
  const catMap = Object.fromEntries(_presupuestoCategorias.map(c => [c.id, c.nombre]));
  _presupuestoOriginal = {};
  filas.forEach(f => { _presupuestoOriginal[f.categoria_id] = f.monto_presupuestado; });

  const total = filas.reduce((s, f) => s + (f.monto_presupuestado || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row" style="margin-bottom:.85rem">
      <span class="egresos-total-label">Total presupuestado</span>
      <span class="egresos-total-valor">Gs. ${total.toLocaleString("es-PY")}</span>
    </div>
    ${filas.map(f => `
    <div class="egreso-row">
      <div class="egreso-info">
        <div class="egreso-concepto">${catMap[f.categoria_id] || "—"}</div>
      </div>
      <div class="egreso-monto" style="color:var(--accent)">
        Gs. ${(f.monto_presupuestado || 0).toLocaleString("es-PY")}
      </div>
    </div>`).join("")}
  `;

  if (btnEdit && esAdmin) btnEdit.style.display = "";
}

function confirmarEditarPresupuesto() {
  const advertencia = document.getElementById("presupuesto-advertencia");
  if (advertencia) {
    advertencia.remove();
    mostrarFormPresupuesto(true);
    return;
  }

  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const warn = document.createElement("div");
  warn.id = "presupuesto-advertencia";
  warn.className = "presupuesto-advertencia";
  warn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    Estás por editar un presupuesto ya registrado. Los cambios reemplazarán los valores actuales.
    <div class="presupuesto-adv-actions">
      <button class="btn-cancel" onclick="this.closest('#presupuesto-advertencia').remove()">Cancelar</button>
      <button class="btn-save" onclick="this.closest('#presupuesto-advertencia').remove(); mostrarFormPresupuesto(true)">Continuar</button>
    </div>
  `;
  if (btnEdit) btnEdit.after(warn);
}

async function mostrarFormPresupuesto(esEdicion) {
  _presupuestoModoEdicion = esEdicion;

  const formEl    = document.getElementById("form-presupuesto");
  const fieldsEl  = document.getElementById("presupuesto-form-fields");
  const btnReg    = document.getElementById("btn-registrar-presupuesto");
  const btnEdit   = document.getElementById("btn-editar-presupuesto");
  if (!formEl || !fieldsEl) return;

  // Cargar categorías si no están en caché
  if (_presupuestoCategorias.length === 0) {
    const { data } = await supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true });
    _presupuestoCategorias = data || [];
  }

  fieldsEl.innerHTML = `
    <p class="presupuesto-form-hint">Completá los montos por categoría. Las categorías sin monto serán ignoradas.</p>
    <div class="detail-grid">
      ${_presupuestoCategorias.map(c => {
        const valorPrevio = _presupuestoOriginal[c.id] || "";
        return `
        <div class="form-field">
          <label class="form-label">${c.nombre}</label>
          <input type="number" class="form-input presupuesto-input"
                 data-cat-id="${c.id}" min="0" placeholder="0"
                 value="${valorPrevio}" />
        </div>`;
      }).join("")}
    </div>`;

  formEl.style.display = "";
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
}

function cerrarFormPresupuesto() {
  const formEl  = document.getElementById("form-presupuesto");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const advertencia = document.getElementById("presupuesto-advertencia");

  if (formEl)       formEl.style.display  = "none";
  if (advertencia)  advertencia.remove();

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  const hayPresupuesto = Object.keys(_presupuestoOriginal).length > 0;
  if (btnReg)  btnReg.style.display  = (!hayPresupuesto && esWorkerOAdmin) ? "" : "none";
  if (btnEdit) btnEdit.style.display = (hayPresupuesto && esAdmin) ? "" : "none";
}

async function guardarPresupuesto() {
  const inputs = document.querySelectorAll(".presupuesto-input");
  const btn    = document.getElementById("btn-guardar-presupuesto");

  // Construir filas a upsert: solo las que tienen monto > 0
  const filas = [];
  inputs.forEach(input => {
    const catId = parseInt(input.dataset.catId);
    const monto = parseInt(input.value) || 0;
    if (monto > 0) {
      filas.push({
        viaje_id:            viajeActualId,
        categoria_id:        catId,
        monto_presupuestado: monto
      });
    }
  });

  if (filas.length === 0) {
    inputs[0]?.classList.add("error");
    return;
  }

  // En modo edición: detectar cambios y solo upsert los que cambiaron
  let filasAGuardar = filas;
  if (_presupuestoModoEdicion) {
    filasAGuardar = filas.filter(f => {
      const original = _presupuestoOriginal[f.categoria_id];
      return !original || original !== f.monto_presupuestado;
    });

    // Categorías que tenían monto y ahora quedaron vacías → eliminar
    const catIdsNuevos = new Set(filas.map(f => f.categoria_id));
    const aEliminar = Object.keys(_presupuestoOriginal).filter(id => !catIdsNuevos.has(id));
    if (aEliminar.length > 0) {
      await supabaseClient
        .from("presupuesto_viaje")
        .delete()
        .eq("viaje_id", viajeActualId)
        .in("categoria_id", aEliminar);
    }

    if (filasAGuardar.length === 0) {
      cerrarFormPresupuesto();
      loadPresupuesto(viajeActualId);
      return;
    }
  }

  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("presupuesto_viaje")
    .upsert(filasAGuardar, { onConflict: "viaje_id,categoria_id" });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando presupuesto:", error);
    alert("Error al guardar. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormPresupuesto();
  loadPresupuesto(viajeActualId);
}

async function agregarCatExtra() {
  const input = document.getElementById("input-cat-extra");
  if (!input) return;

  const nombre = input.value.trim();
  if (!nombre) {
    input.classList.add("error");
    input.focus();
    return;
  }
  input.classList.remove("error");

  // Deshabilitar el botón mientras se guarda
  const btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = "Agregando…"; }

  // Insertar categoría local (scope = viajeActualId)
  const { data: nueva, error } = await supabaseClient
    .from("categorias")
    .insert([{ nombre, scope: viajeActualId }])
    .select("id, nombre")
    .single();

  if (btn) { btn.disabled = false; btn.textContent = "+ Agregar"; }

  if (error) {
    console.error("Error al crear categoría extra:", JSON.stringify(error));
    alert("Error: " + (error.message || error.details || JSON.stringify(error)));
    return;
  }

  // Agregar al caché local
  _presupuestoCategorias.push(nueva);

  // Agregar el campo al grid del formulario
  const grid = document.querySelector("#presupuesto-form-fields .detail-grid");
  if (grid) {
    const div = document.createElement("div");
    div.className = "form-field";
    div.innerHTML = `
      <label class="form-label">${nueva.nombre}</label>
      <input type="number" class="form-input presupuesto-input"
             data-cat-id="${nueva.id}" min="0" placeholder="0" value="" />`;
    grid.appendChild(div);
  }

  // Limpiar el input y enfocar el nuevo campo
  input.value = "";
  const nuevoInput = document.querySelector(`.presupuesto-input[data-cat-id="${nueva.id}"]`);
  if (nuevoInput) nuevoInput.focus();
}

// ── Generador de Historial de Pagos PDF ──────────────────────────────────────
const APPS_SCRIPT_PDF_URL = "https://script.google.com/macros/s/AKfycbzal5GP399HgePINzuV7ifuSl_N5wiLGfkurCQ2XbMtdX4BaCJFb9PetaS3Qn6VHGFn/exec";

async function generarHistorialPDF(event, vpId, nombrePasajero) {
  event.stopPropagation();

  const btn = event.currentTarget;
  btn.disabled = true;
  btn.classList.add("btn-pdf-loading");

  try {
    // 1. Datos del viaje_pasajero
    const { data: vp, error: vpErr } = await supabaseClient
      .from("viaje_pasajeros")
      .select("total_a_pagar")
      .eq("id", parseInt(vpId))
      .single();

    if (vpErr || !vp) throw new Error("No se pudo obtener datos del pasajero.");

    // 2. Pagos + métodos de pago (join por metodo_pago_id)
    const [{ data: pagos, error: pgErr }] = await Promise.all([
      supabaseClient
        .from("pagos")
        .select("monto, tipo, fecha_pago, banco, comprobante_nro")
        .eq("viaje_pasajero_id", parseInt(vpId))
        .order("fecha_pago", { ascending: true }),
    ]);

    if (pgErr) throw new Error("No se pudo obtener el historial de pagos.");

    const listaPagos     = pagos || [];
    const pagosReales    = listaPagos.filter(p => p.tipo === "Pago");
    const devoluciones   = listaPagos.filter(p => p.tipo === "Devolución");
    const transferencias = listaPagos.filter(p => p.tipo === "Transferencia");

    const sumaPagado  = pagosReales.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaDevuelto = devoluciones.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaTransf  = transferencias.reduce((s, p) => s + (p.monto || 0), 0);
    const neto        = sumaPagado - sumaDevuelto - sumaTransf;
    const total       = vp.total_a_pagar || 0;
    const saldo       = Math.max(0, total - neto);

    const formatFechaLocal = (fechaStr) => {
      if (!fechaStr) return "—";
      const d = new Date(fechaStr + "T00:00:00");
      return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    // 3. Armar payload para Apps Script
    const payload = {
      pasajero : nombrePasajero,
      viaje    : viajeActualData?.nombre || "—",
      total    : total,
      suma     : neto,
      saldo    : saldo,
      pagos    : listaPagos.map(p => ({
        fecha       : formatFechaLocal(p.fecha_pago),
        banco       : p.banco       || "—",
        comprobante : p.comprobante_nro || "—",
        monto       : (p.tipo === "Devolución" || p.tipo === "Transferencia")
                        ? -Math.abs(p.monto || 0)
                        : (p.monto || 0)
      }))
    };

    // 4. Llamar al Apps Script
    const response = await fetch(APPS_SCRIPT_PDF_URL, {
      method : "POST",
      body   : JSON.stringify(payload)
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Error en Apps Script");

    // 5. Descargar el PDF
    const byteChars = atob(result.pdf);
    const byteArray = new Uint8Array([...byteChars].map(c => c.charCodeAt(0)));
    const blob      = new Blob([byteArray], { type: "application/pdf" });
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement("a");
    a.href          = url;
    a.download      = `Historial_${nombrePasajero.replace(/\s+/g, "_")}_${(viajeActualData?.nombre || "viaje").replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Error generando PDF:", err);
    alert("No se pudo generar el PDF: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-pdf-loading");
  }
}
