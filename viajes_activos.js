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
async function loadViajes() {
  const list = document.getElementById("viajes-list");
  if (!list) return;

  list.innerHTML = "Cargando…";

  const hoy = new Date().toISOString().split("T")[0];

  const { data, error } = await supabaseClient
    .from("viajes")
    .select("*")
    .gte("fecha_regreso", hoy)
    .order("fecha_salida", { ascending: false });

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


list.innerHTML = data.map(v => {
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
  viajeActualId = viajeId;
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
  navigateTo("viaje-detalle", viajeId);
}
async function loadViajeDetalle(viajeId) {
  viajeActualId = viajeId;

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
  infoEl.innerHTML = `
    <span class="viaje-pill ${estado}" style="font-size:.75rem">${estado}</span>
    ${viaje.puntos_destino ? `<span class="viaje-puntos" style="margin-left:.4rem">⭐ ${viaje.puntos_destino} pts base</span>` : ""}
    ${viaje.fecha_salida ? `<span style="margin-left:.4rem;font-size:.8rem;color:var(--text-muted)">📅 ${formatFecha(viaje.fecha_salida)}${viaje.fecha_regreso ? " → " + formatFecha(viaje.fecha_regreso) : ""}</span>` : ""}
  `;


  const { data: pasajeros, error: errPasajeros } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      id,
      pasajero_id,
      total_a_pagar,
      puntos_destino,
      asistencia,
      pasajeros ( id, Pasajero, "Documento de Identidad" )
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

  // Guardar para filtrado
  pasajerosDelViaje = pasajeros.map(p => ({
    ...p,
    _nombre: p.pasajeros?.Pasajero || "Sin nombre",
    _pagos: pagosPorVP[p.id] || []
  }));

  // Mostrar/ocultar botón agregar
  const btnAgregar = document.getElementById("btn-agregar-vp");
  if (btnAgregar) btnAgregar.style.display = esWorkerOAdmin ? "" : "none";

  // Limpiar buscador al cargar
  const buscador = document.getElementById("buscador-vp");
  if (buscador) buscador.value = "";

  renderPasajerosViaje(pasajerosDelViaje, esAdmin, pagosPorVP);
}

function filtrarPasajerosViaje(q) {
  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const filtrados = q.trim()
    ? pasajerosDelViaje.filter(p =>
        p._nombre.toLowerCase().includes(q.toLowerCase())
      )
    : pasajerosDelViaje;
  const pagosPorVP = {};
  pasajerosDelViaje.forEach(p => { pagosPorVP[p.id] = p._pagos; });
  renderPasajerosViaje(filtrados, esAdmin, pagosPorVP);
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
    const pagado   = (pagosPorVP[p.id] || [])
      .filter(pg => pg.tipo === "Pago" || pg.tipo === "Transferencia")
      .reduce((s, pg) => s + (pg.monto || 0), 0);
    const restante = Math.max(0, total - pagado);
    const restanteStr = restante.toLocaleString("es-PY");
    const saldado  = restante === 0 && total > 0;

    const pct = total > 0 ? pagado / total : 0;
    const pillClass = saldado ? "saldado" : pct >= 0.5 ? "parcial" : "deuda";
    const pillLabel = saldado
      ? "✅ Saldado"
      : `Gs. ${restanteStr}`;

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

  if (!total || total <= 0) {
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

    if (!total || total <= 0) {
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
  // Botones
  document.getElementById("tab-pasajeros").classList.toggle("active", tab === "pasajeros");
  document.getElementById("tab-egresos").classList.toggle("active", tab === "egresos");

  // Paneles
  document.getElementById("panel-pasajeros").style.display = tab === "pasajeros" ? "" : "none";
  document.getElementById("panel-egresos").style.display   = tab === "egresos"   ? "" : "none";

  if (tab === "egresos") {
    loadEgresos(viajeActualId);
  }
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
}

async function _cargarOpcionesFormEgreso() {
  // Categorías: globales (viaje_id null) + exclusivas del viaje actual
  // Dos queries separadas porque .or() con is.null no es confiable en supabase-js v2
  if (_egresosCategorias.length === 0) {
    const [{ data: globales }, { data: exclusivas }] = await Promise.all([
      supabaseClient
        .from("categorias")
        .select("id, nombre, scope")
        .is("scope", null)
        .order("nombre", { ascending: true }),
      supabaseClient
        .from("categorias")
        .select("id, nombre, scope")
        .eq("scope", parseInt(viajeActualId))
        .order("nombre", { ascending: true })
    ]);
    _egresosCategorias = [...(globales || []), ...(exclusivas || [])];
  }

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
    selCat.innerHTML = `<option value="">— Seleccionar categoría —</option>` +
      _egresosCategorias.map(c => {
        const label = c.scope ? `${c.nombre} (exclusiva)` : c.nombre;
        return `<option value="${c.id}">${label}</option>`;
      }).join("");
  }

  if (selCaja) {
    selCaja.innerHTML = `<option value="">— Seleccionar caja —</option>` +
      _egresosMetodos.map(m => `<option value="${m.id}">${m.metodo_de_pago}</option>`).join("");
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
  if (btn)  btn.style.display  = "";

["egreso-categoria", "egreso-monto", "egreso-fecha", "egreso-descripcion", "egreso-ejecutor", "egreso-caja", "egreso-archivo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

async function guardarEgreso() {
  const categoriaId  = document.getElementById("egreso-categoria")?.value;
  const monto        = parseInt(document.getElementById("egreso-monto")?.value);
  const fecha        = document.getElementById("egreso-fecha")?.value || null;
  const descripcion  = document.getElementById("egreso-descripcion")?.value.trim() || null;
  const ejecutor     = document.getElementById("egreso-ejecutor")?.value.trim();
  const cajaId       = document.getElementById("egreso-caja")?.value;
  const archivo = document.getElementById("egreso-archivo")?.files[0];

  // Validaciones
  let valido = true;
  if (!categoriaId) {
    document.getElementById("egreso-categoria")?.classList.add("error");
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

  const { data: { user } } = await supabaseClient.auth.getUser();

  let comprobante_url = null;

  if (archivo) {
    try {
      comprobante_url = await uploadEgresoFile(archivo);
    } catch (e) {
      console.error(e);
      alert("Error subiendo comprobante");
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
