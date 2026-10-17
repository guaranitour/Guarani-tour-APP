// ══════════════════════════════════════════════════════════════════════
//  EGRESOS DE VIAJE
//  Separado de viajes_activos.js para mantener archivos más chicos.
//
//  Dependencias globales (definidas en otros scripts, cargados antes en
//  index.html): supabaseClient, currentUserRole, viajeActualId,
//  getMetodosPago(), initCustomSelect(), navigateTo(), uploadEgresoFile().
//
//  Nota sobre presupuesto_viaje: _cargarOpcionesFormEgreso() consulta la
//  tabla "presupuesto_viaje" para saber qué categorías tienen presupuesto
//  asignado en este viaje (y así armar el desplegable del formulario).
//  Es una dependencia de DATOS (misma tabla en Supabase), no de código:
//  no llama a ninguna función de viajes_presupuesto.js ni usa sus
//  variables (_presupuestoCategorias, etc.). Por eso el orden de carga
//  entre viajes_egresos.js y viajes_presupuesto.js no importa.
// ══════════════════════════════════════════════════════════════════════

/* ── EGRESOS ───────────────────────────────── */

// Caché para los selects del form
let _egresosCategorias = [];
let _egresosMetodos    = [];
let _egresosLoadToken  = 0; // Descarta respuestas tardías de un viaje distinto al que se está viendo

async function loadEgresos(viajeId) {
  const miToken = ++_egresosLoadToken;
  const listEl = document.getElementById("egresos-list");
  const btnAdd = document.getElementById("btn-agregar-egreso");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  if (btnAdd) btnAdd.style.display = can("egresos.registrar") ? "" : "none";

  // Query principal de egresos
  const { data, error } = await supabaseClient
    .from("egresos")
    .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente")
    .eq("viaje_id", viajeId)
    .order("fecha", { ascending: false });

  // Si mientras esperábamos esta respuesta el usuario ya cambió de viaje
  // (o volvió a entrar a este mismo tab, dos veces seguidas), esta
  // respuesta quedó obsoleta: no pisar la vista con datos de otro viaje.
  if (miToken !== _egresosLoadToken) return;
  if (viajeId !== viajeActualId) return;

  if (error) {
    console.error("Error cargando egresos:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar egresos</div>`;
    return;
  }

  // Traer nombres de categorías (sin cache) y métodos desde cache global
  const [{ data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);

  if (miToken !== _egresosLoadToken) return;
  if (viajeId !== viajeActualId) return;

  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

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

// Categorías elegibles para un egreso del viaje: las presupuestadas + las
// exclusivas del viaje (aunque no estén presupuestadas), sin duplicados y
// ordenadas alfabéticamente. Siempre re-consulta.
async function _categoriasDisponiblesViaje(viajeId) {
  const [
    { data: presupuestadas },
    { data: exclusivas }
  ] = await Promise.all([
    // Categorías con presupuesto en este viaje (join con presupuesto_viaje)
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, categorias(id, nombre, scope)")
      .eq("viaje_id", parseInt(viajeId)),
    // Categorías exclusivas del viaje (scope = viajeId), aunque no estén presupuestadas
    supabaseClient
      .from("categorias")
      .select("id, nombre, scope")
      .eq("scope", parseInt(viajeId))
      .order("nombre", { ascending: true })
  ]);

  const vistos = new Set();
  const lista = [];
  (presupuestadas || []).forEach(row => {
    const c = row.categorias;
    if (c && !vistos.has(c.id)) { vistos.add(c.id); lista.push(c); }
  });
  (exclusivas || []).forEach(c => {
    if (c && !vistos.has(c.id)) { vistos.add(c.id); lista.push(c); }
  });

  return lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

async function _cargarOpcionesFormEgreso() {
  // Siempre re-consultamos (el caché se invalida en mostrarFormEgreso)
  _egresosCategorias = await _categoriasDisponiblesViaje(viajeActualId);

  // Métodos de pago (caja saliente) — desde caché global
  const metodosList = await getMetodosPago();
  _egresosMetodos = metodosList;

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

  // Inicializar custom selects (idempotente: se refresca si ya existe)
  initCustomSelect("egreso-categoria");
  initCustomSelect("egreso-caja");
}

// Los ids por defecto son los del form de alta; la vista de edición pasa los suyos.
function _toggleNuevaCategoriaInput(mostrar, selId = "egreso-categoria", prefijo = "egreso") {
  const wrapId  = `${prefijo}-nueva-cat-wrap`;
  const inputId = `${prefijo}-nueva-cat-nombre`;
  let wrap = document.getElementById(wrapId);
  if (mostrar) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = wrapId;
      wrap.style.cssText = "margin-top:.5rem";
      wrap.innerHTML = `
        <input id="${inputId}" class="form-input"
               type="text" placeholder="Nombre del nuevo tipo de egreso" />
      `;
      document.getElementById(selId).after(wrap);
    }
    wrap.style.display = "";
    document.getElementById(inputId)?.focus();
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
  if (btn) btn.style.display = can("egresos.registrar") ? "" : "none";

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
  const monto        = _numeroDesdeMiles(document.getElementById("egreso-monto")?.value);
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
      showToast("Error al crear el tipo de egreso. Intentá de nuevo.", "error");
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
      showToast("Error subiendo comprobante", "error");
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
    showToast("Error al guardar el egreso. Revisá los datos e intentá de nuevo.", "error");
    return;
  }

  showToast("Egreso registrado", "success");
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
  const [{ data: e, error }, { data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("egresos")
      .select("id, viaje_id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente, comprobante_nro")
      .eq("id", egresoId)
      .single(),
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);

  if (error || !e) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar el egreso.</div>`;
    return;
  }

  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

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

    ${(can("egresos.editar") || can("egresos.eliminar")) ? `
    <div class="egreso-det-acciones">
      ${can("egresos.editar") ? `
      <button type="button" class="btn-save" onclick="abrirEgresoEditar('${e.id}', '${e.viaje_id ?? viajeId}')">Editar egreso</button>` : ""}
      ${can("egresos.eliminar") ? `
      <button type="button" class="egreso-btn-eliminar" onclick="eliminarEgreso('${e.id}', '${e.viaje_id ?? viajeId}')">Eliminar egreso</button>` : ""}
    </div>` : ""}
  `;
}

/* ── EGRESO ELIMINAR / EDITAR ──────────────── */

// Vuelve al viaje parado en el tab Egresos (loadViajeDetalle consume _tabInicialViaje).
function _volverAEgresosViaje(viajeId) {
  _tabInicialViaje = "egresos";
  navigateTo("viaje-detalle", parseInt(viajeId, 10));
}

async function eliminarEgreso(egresoId, viajeId) {
  if (!can("egresos.eliminar")) {
    showToast("No tenés permiso para eliminar egresos", "error");
    return;
  }

  const ok = await confirmar({
    titulo: "Eliminar egreso",
    mensaje: "¿Eliminar este egreso? Esta acción es irrevocable.",
    confirmarTexto: "Eliminar",
    peligro: true,
  });
  if (!ok) return;

  // .select() devuelve las filas borradas (y su comprobante): RLS no da
  // error si no borra nada
  const { data, error } = await supabaseClient
    .from("egresos")
    .delete()
    .eq("id", egresoId)
    .select("id, comprobante_nro");

  if (error || !data?.length) {
    console.error("Error eliminando egreso:", error);
    showToast("No se pudo eliminar el egreso", "error");
    return;
  }

  // Ya eliminado: se borra su comprobante del bucket, si tenía
  if (data[0].comprobante_nro) await _borrarComprobanteEgreso(data[0].comprobante_nro);

  showToast("Egreso eliminado", "success");
  _volverAEgresosViaje(viajeId);
}

let _egresoEditando = null; // { id, viajeId, comprobante } del egreso abierto en la vista de edición

function abrirEgresoEditar(egresoId, viajeId) {
  navigateTo("egreso-editar", { egresoId, viajeId });
}

function _escAttrEgreso(v) {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Borra un comprobante del bucket "egresos" a partir de su URL pública.
async function _borrarComprobanteEgreso(url) {
  const marca = "/object/public/egresos/";
  const i = url ? url.indexOf(marca) : -1;
  if (i === -1) return false;
  const path = decodeURIComponent(url.slice(i + marca.length).split("?")[0]);
  const { error } = await supabaseClient.storage.from("egresos").remove([path]);
  if (error) console.warn("No se pudo borrar el comprobante del bucket:", error);
  return !error;
}

async function initEgresoEditarView({ egresoId, viajeId }) {
  const cont = document.getElementById("egreso-editar-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;
  _egresoEditando = null;

  const [{ data: e, error }, categorias, metodos] = await Promise.all([
    supabaseClient.from("egresos")
      .select("id, viaje_id, monto, descripcion, fecha, ejecutor, categoria_id, caja_saliente, comprobante_nro")
      .eq("id", egresoId)
      .single(),
    _categoriasDisponiblesViaje(viajeId),
    getMetodosPago()
  ]);

  if (error || !e) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar el egreso.</div>`;
    return;
  }

  // La categoría actual puede haber quedado fuera de las elegibles (ej. se
  // quitó del presupuesto): se incluye igual para no perderla al editar.
  if (!categorias.some(c => String(c.id) === String(e.categoria_id))) {
    const { data: actual } = await supabaseClient
      .from("categorias").select("id, nombre, scope").eq("id", e.categoria_id).maybeSingle();
    if (actual) categorias.push(actual);
  }

  _egresoEditando = { id: e.id, viajeId: e.viaje_id, comprobante: e.comprobante_nro };

  const fecha = e.fecha ? e.fecha.split("T")[0] : "";
  const opcionesCat = categorias.map(c =>
    `<option value="${c.id}"${String(c.id) === String(e.categoria_id) ? " selected" : ""}>${c.scope ? `${c.nombre} (exclusiva)` : c.nombre}</option>`
  ).join("");
  const opcionesCaja = metodos.map(m =>
    `<option value="${m.id}"${String(m.id) === String(e.caja_saliente) ? " selected" : ""}>${m.metodo_de_pago}</option>`
  ).join("");

  const comprobanteActual = e.comprobante_nro
    ? `<a href="${e.comprobante_nro}" target="_blank" class="egreso-det-comprobante">Ver comprobante actual</a>`
    : `<span class="egreso-det-sin-comprobante">Sin comprobante adjunto</span>`;

  cont.innerHTML = `
    <div class="pago-form-inner">
      <div class="detail-grid">
        <div class="form-field full">
          <label class="form-label">Categoría <span class="req">*</span></label>
          <select id="egreso-ed-categoria" class="form-input">${opcionesCat}<option value="__nuevo__">+ Otro tipo…</option></select>
        </div>
        <div class="form-field">
          <label class="form-label">Monto (Gs.) <span class="req">*</span></label>
          <input type="text" inputmode="numeric" autocomplete="off" id="egreso-ed-monto" class="form-input input-miles" value="${_formatearMiles(e.monto)}" />
        </div>
        <div class="form-field">
          <label class="form-label">Fecha <span class="req">*</span></label>
          <input type="date" id="egreso-ed-fecha" class="form-input" value="${fecha}" />
        </div>
        <div class="form-field full">
          <label class="form-label">Descripción</label>
          <input type="text" id="egreso-ed-descripcion" class="form-input" value="${_escAttrEgreso(e.descripcion)}" />
        </div>
        <div class="form-field full">
          <label class="form-label">Comprobante</label>
          <div style="margin-bottom:.4rem">${comprobanteActual}</div>
          <input type="file" id="egreso-ed-archivo" class="form-input" accept="image/*,application/pdf">
          <p class="presupuesto-form-hint" style="margin:.4rem 0 0">Opcional. Si adjuntás uno nuevo, reemplaza al actual y el anterior se elimina.</p>
        </div>
        <div class="form-field">
          <label class="form-label">Ejecutor <span class="req">*</span></label>
          <input type="text" id="egreso-ed-ejecutor" class="form-input" value="${_escAttrEgreso(e.ejecutor)}" />
        </div>
        <div class="form-field">
          <label class="form-label">Caja saliente <span class="req">*</span></label>
          <select id="egreso-ed-caja" class="form-input">${opcionesCaja}</select>
        </div>
      </div>

      <div class="form-actions" style="margin-top:.75rem">
        <button class="btn-cancel" onclick="navigateTo('egreso-detalle', { egresoId: '${e.id}', viajeId: '${e.viaje_id}' })">Cancelar</button>
        <button class="btn-save" id="btn-guardar-egreso-ed" onclick="guardarEdicionEgreso()">Guardar cambios</button>
      </div>
    </div>`;

  const selCat = document.getElementById("egreso-ed-categoria");
  selCat.onchange = () => _toggleNuevaCategoriaInput(selCat.value === "__nuevo__", "egreso-ed-categoria", "egreso-ed");

  initCustomSelect("egreso-ed-categoria");
  initCustomSelect("egreso-ed-caja");
}

async function guardarEdicionEgreso() {
  if (!can("egresos.editar")) {
    showToast("No tenés permiso para editar egresos", "error");
    return;
  }
  const ctx = _egresoEditando;
  if (!ctx) return;

  const categoriaSelVal = document.getElementById("egreso-ed-categoria")?.value;
  const nuevaCatNombre  = document.getElementById("egreso-ed-nueva-cat-nombre")?.value.trim();
  const monto       = _numeroDesdeMiles(document.getElementById("egreso-ed-monto")?.value);
  const fecha       = document.getElementById("egreso-ed-fecha")?.value || null;
  const descripcion = document.getElementById("egreso-ed-descripcion")?.value.trim() || null;
  const ejecutor    = document.getElementById("egreso-ed-ejecutor")?.value.trim();
  const cajaId      = document.getElementById("egreso-ed-caja")?.value;
  const archivo     = document.getElementById("egreso-ed-archivo")?.files[0];

  const marcar = (id) => { document.getElementById(id)?.classList.add("error"); return false; };
  let valido = true;
  if (!categoriaSelVal)   valido = marcar("egreso-ed-categoria");
  if (categoriaSelVal === "__nuevo__" && !nuevaCatNombre) valido = marcar("egreso-ed-nueva-cat-nombre");
  if (!monto || monto <= 0) valido = marcar("egreso-ed-monto");
  if (!fecha)             valido = marcar("egreso-ed-fecha");
  if (!ejecutor)          valido = marcar("egreso-ed-ejecutor");
  if (!cajaId)            valido = marcar("egreso-ed-caja");
  if (!valido) return;

  const ok = await confirmar({
    titulo: "Guardar cambios",
    mensaje: "¿Guardar los cambios de este egreso? La edición es irrevocable: los valores anteriores no se pueden recuperar.",
    confirmarTexto: "Guardar",
    peligro: true,
  });
  if (!ok) return;

  const btn = document.getElementById("btn-guardar-egreso-ed");
  const restaurarBtn = () => { if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; } };
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  // Si eligió "+ Otro tipo…", crear la categoría exclusiva del viaje primero
  let categoriaId = categoriaSelVal;
  if (categoriaSelVal === "__nuevo__") {
    const { data: nuevaCat, error: errCat } = await supabaseClient
      .from("categorias")
      .insert([{ nombre: nuevaCatNombre, scope: parseInt(ctx.viajeId) }])
      .select("id")
      .single();

    if (errCat || !nuevaCat) {
      console.error("Error creando categoría:", errCat);
      showToast("Error al crear el tipo de egreso. Intentá de nuevo.", "error");
      restaurarBtn();
      return;
    }
    categoriaId = nuevaCat.id;
    _egresosCategorias = []; // para que el próximo form de alta la muestre
  }

  // Comprobante nuevo: se convierte a WebP al subir (uploadEgresoFile)
  let nuevaUrl = null;
  if (archivo) {
    try {
      nuevaUrl = await uploadEgresoFile(archivo, ctx.viajeId);
    } catch (e) {
      console.error(e);
      showToast("Error subiendo comprobante", "error");
      restaurarBtn();
      return;
    }
  }

  const cambios = {
    categoria_id: categoriaId,
    monto,
    fecha,
    descripcion,
    ejecutor,
    caja_saliente: cajaId
  };
  if (nuevaUrl) cambios.comprobante_nro = nuevaUrl;

  // .select() devuelve las filas actualizadas: RLS no da error si no toca nada
  const { data, error } = await supabaseClient
    .from("egresos")
    .update(cambios)
    .eq("id", ctx.id)
    .select("id");

  if (error || !data?.length) {
    console.error("Error editando egreso:", error);
    if (nuevaUrl) _borrarComprobanteEgreso(nuevaUrl); // deshacer la subida
    showToast("No se pudo guardar el egreso. Revisá los datos e intentá de nuevo.", "error");
    restaurarBtn();
    return;
  }

  // Ya guardado: se elimina del bucket el comprobante que reemplazó
  if (nuevaUrl && ctx.comprobante) await _borrarComprobanteEgreso(ctx.comprobante);

  showToast("Egreso actualizado", "success");
  navigateTo("egreso-detalle", { egresoId: ctx.id, viajeId: ctx.viajeId });
}
