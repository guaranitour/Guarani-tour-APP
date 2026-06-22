/* ─────────────────────────────────────────────
   viajes_activos.js — Lista, detalle y pasajeros
   Egresos  → egresos.js
   Presupuesto → presupuesto.js
───────────────────────────────────────────── */

let viajeActualId = null;
let pasajeroSeleccionado = null;
let viajeActualData = null;
let pasajerosDelViaje = [];
// CIs normalizados presentes en basesycondiciones (aceptaron ByC)
let _bycAceptados = new Set();
/* ─────────────────────────────────────────────
   viajes_activos.js — Gestión de viajes
───────────────────────────────────────────── */

let allViajes = [];

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
    <div class="viaje-card-media">
      ${v.imagen_url ? `<img src="${v.imagen_url}" class="viaje-card-img" />` : placeholder}
      <div class="viaje-card-overlay">
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
async function crearViaje() {
  const nombre   = document.getElementById("v-nombre").value.trim();
  const salida   = document.getElementById("v-salida").value;
  const regreso  = document.getElementById("v-regreso").value;
  const estado   = document.getElementById("v-estado").value;
  const puntos_destino = parseInt(document.getElementById("v-puntos").value) || 0;
  const file     = document.getElementById("v-imagen").files[0];

  if (!nombre) {
    document.getElementById("v-nombre").classList.add("error");
    setTimeout(() => document.getElementById("v-nombre").classList.remove("error"), 2000);
    return;
  }

  const btn = document.querySelector("#view-viaje-nuevo .btn-save");
  if (btn) {
    if (btn.disabled) return;          // guard doble ejecución
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-dots"><span>.</span><span>.</span><span>.</span></span> Guardando`;
  }

  let imagen_url = null;

  if (file) {
    try {
      imagen_url = await uploadViajeImage(file);
    } catch (e) {
      console.error(e);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar viaje`;
      }
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
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar viaje`;
    }
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

  // Etapa 1: viaje, lista de pasajeros y BYC no dependen entre sí → en paralelo
  const [
    { data: viaje },
    { data: pasajeros, error: errPasajeros },
    { data: bycData },
  ] = await Promise.all([
    supabaseClient
      .from("viajes")
      .select("*")
      .eq("id", viajeId)
      .single(),
    supabaseClient
      .from("viaje_pasajeros")
      .select(`
        id,
        pasajero_id,
        total_a_pagar,
        puntos_destino,
        asistencia,
        pasajeros ( id, Pasajero, "Documento de Identidad", Vendedor )
      `)
      .eq("viaje_id", viajeId),
    supabaseClient
      .from("basesycondiciones")
      .select("ci"),
  ]);

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
    ${viaje.puntos_destino ? `<span class="viaje-puntos viaje-puntos-claro" style="margin-left:.4rem">⭐ ${viaje.puntos_destino} pts base</span>` : ""}
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

  if (errPasajeros) { console.error("Error cargando pasajeros:", errPasajeros); }

  // ── Insignia de pendientes BYC ──────────────────────────────────────────
  _bycAceptados = new Set();
  if (pasajeros && pasajeros.length > 0) {
    (bycData || []).forEach(r => {
      const norm = (r.ci || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
      if (norm) _bycAceptados.add(norm);
    });
  }
  // ───────────────────────────────────────────────────────────────────────

  // Botón agregar pasajero: visible para todos los roles (admin, worker, viewer)
  const btnAgregarEarly = document.getElementById("btn-agregar-vp");
  if (btnAgregarEarly) btnAgregarEarly.style.display = "";

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

  // Botón agregar pasajero: visible para todos los roles (admin, worker, viewer)
  const btnAgregar = document.getElementById("btn-agregar-vp");
  if (btnAgregar) btnAgregar.style.display = "";

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

  // Habilitar swipe horizontal entre tabs (solo una vez)
  _initSwipeTabsViaje();

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
      <div class="form-field">
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
    const ciNorm   = (p.pasajeros?.["Documento de Identidad"] || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
    const sinByc   = !ciNorm || !_bycAceptados.has(ciNorm);
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
        <div class="vp-nombre${sinByc ? " byc-pendiente" : ""}">${nombre}</div>
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
      showToast("Error: no hay viaje seleccionado", "error");
      return;
    }

    if (!pasajeroSeleccionado) {
      showToast("Seleccioná un pasajero", "warning");
      return;
    }

    const total = parseInt(document.getElementById("input-total").value);

    if (total == null || isNaN(total) || total < 0) {
      showToast("Ingresá un monto válido", "warning");
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
      showToast("Error al guardar en base de datos", "error");
      return;
    }

    showToast("✅ Pasajero agregado correctamente", "success");

    navigateTo("viaje-detalle", viajeActualId);
  } catch (e) {
    console.error("ERROR GENERAL:", e);
    showToast("Error inesperado", "error");
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

  // Cargar vendedores desde caché global
  const vendedoresData = await getVendedores();

  const optsVendedor = vendedoresData
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

/* ── SWIPE HORIZONTAL ENTRE TABS (desde las cards) ─── */
let _swipeTabsInit = false;
function _initSwipeTabsViaje() {
  if (_swipeTabsInit) return;
  _swipeTabsInit = true;

  const wrap = document.getElementById("viaje-tab-panels");
  if (!wrap) return;

  let startX = 0, startY = 0, tracking = false, isHorizontal = false;
  const UMBRAL_DIRECCION = 10; // px para decidir si el gesto es horizontal
  const UMBRAL_CAMBIO    = 50; // px para considerar que se quiso cambiar de tab

  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    isHorizontal = false;
  }, { passive: true });

  wrap.addEventListener("touchmove", (e) => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isHorizontal && (Math.abs(dx) > UMBRAL_DIRECCION || Math.abs(dy) > UMBRAL_DIRECCION)) {
      isHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    // Si el gesto es horizontal, evitamos que el navegador haga scroll vertical
    if (isHorizontal) e.preventDefault();
  }, { passive: false });

  wrap.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    if (!isHorizontal) return;

    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < UMBRAL_CAMBIO) return;

    // Deslizar hacia la izquierda → siguiente tab. Hacia la derecha → tab anterior.
    _cambiarTabViajePorSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function _cambiarTabViajePorSwipe(direccion) {
  const ordenTabs = ["pasajeros", "egresos", "presupuesto", "resumen"];

  // Solo se consideran las tabs visibles según el rol del usuario
  const visibles = ordenTabs.filter(t => {
    const btn = document.getElementById("tab-" + t);
    return btn && btn.style.display !== "none";
  });

  const actual = visibles.find(t => document.getElementById("tab-" + t).classList.contains("active"));
  let idx = visibles.indexOf(actual);
  if (idx === -1) idx = 0;

  idx += direccion;
  if (idx < 0 || idx >= visibles.length) return; // ya está en el extremo

  switchViajeTab(visibles[idx]);

  // Asegura que el tab activo quede visible dentro del scroll de tabs
  const tabBtn = document.getElementById("tab-" + visibles[idx]);
  if (tabBtn && tabBtn.scrollIntoView) {
    tabBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

/* ── EGRESOS ───────────────────────────────── */

// Caché para los selects del form
let _egresosCategorias = [];
let _egresosMetodos    = [];

