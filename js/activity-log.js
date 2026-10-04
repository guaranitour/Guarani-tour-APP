// =====================================================================
// activity-log.js — Vista "Registro de actividad" (admin) sobre la
// tabla activity_log. Lista paginada con filtros múltiples (usuario,
// fecha, tipo, tabla) en un panel lateral con Aceptar/Cancelar. Cada fila
// es expandible (<details>) y muestra el diff entre old_data y new_data.
// Los ids de referencia (viaje_id, pasajero_id, etc.) se traducen a
// nombres al mostrar (ver _resolverReferenciasAL).
// =====================================================================

const ACTIVITY_LOG_PAGE_SIZE = 25;

// Nombres amigables para mostrar en vez del nombre técnico de tabla
const ACTIVITY_LOG_TABLE_LABELS = {
  egresos: "Egresos",
  pagos: "Pagos",
  viajes: "Viajes",
  viaje_pasajeros: "Viaje pasajeros",
  categorias: "Categorías",
  contactos_emergencia: "Contactos de emergencia",
  servicio_extra_pasajeros: "Servicio extra pasajeros",
  servicios_extra: "Servicios extra",
};

const ACTIVITY_LOG_OP_LABELS = {
  INSERT: { label: "Creación", cls: "al-op-insert" },
  UPDATE: { label: "Edición", cls: "al-op-update" },
  DELETE: { label: "Eliminación", cls: "al-op-delete" },
};

// Columna de activity_log.old_data/new_data que guarda un id -> tabla y
// columna con el nombre legible. viaje_pasajero_id se resuelve aparte
// (pasajero + viaje) porque la tabla puente no tiene nombre propio.
const AL_REFS = {
  viaje_id:          { tabla: "viajes",          col: "nombre",          label: "Viaje" },
  scope:             { tabla: "viajes",          col: "nombre",          label: "Viaje (ámbito)" },
  pasajero_id:       { tabla: "pasajeros",       col: "Pasajero",        label: "Pasajero" },
  metodo_pago_id:    { tabla: "metodos_de_pago", col: "metodo_de_pago",  label: "Método de pago" },
  de_caja:           { tabla: "metodos_de_pago", col: "metodo_de_pago",  label: "Caja origen" },
  a_caja:            { tabla: "metodos_de_pago", col: "metodo_de_pago",  label: "Caja destino" },
  categoria_id:      { tabla: "categorias",      col: "nombre",          label: "Categoría" },
  servicio_extra_id: { tabla: "servicios_extra", col: "nombre",          label: "Servicio extra" },
  viaje_pasajero_id: { tabla: "viaje_pasajeros", col: null,              label: "Pasajero en viaje" },
};

// Cache de resolución: tabla -> Map(id -> nombre | null si ya no existe)
const _alCache = {
  viajes: new Map(), pasajeros: new Map(), metodos_de_pago: new Map(),
  categorias: new Map(), servicios_extra: new Map(),
  viaje_pasajeros: new Map(), // id -> { pasajero_id, viaje_id } | null
};

// Filtros aplicados (los que usa la query) y borrador (lo que se edita
// en el panel; solo pasa a "aplicados" al tocar Aceptar).
const _alFiltrosVacios = () => ({ usuarios: [], tipos: [], tablas: [], fechaInicio: "", fechaFin: "" });
let _alFiltros = _alFiltrosVacios();
let _alBorrador = _alFiltrosVacios();

// Paginación de la vista. Se resetea cada vez que se entra a la vista.
let _activityLogState = { offset: 0, terminado: false, cargando: false };

let _activityLogUsuariosCargados = false;
let _activityLogUsuariosOpciones = [];

// Entrada de historial "de más" mientras el panel está abierto: así
// "atrás" lo cierra (cancelando) en vez de salir de la vista. La consume
// el listener de popstate de app.js.
let _alDrawerHistoryOpen = false;

async function loadActivityLog({ reset = false, restaurar = false } = {}) {
  // Al volver con "atrás": si ya hay filas cargadas, se deja la lista, los
  // filtros y la paginación tal cual estaban (el scroll lo restaura app.js).
  if (restaurar && _activityLogState.offset > 0) return;
  if (reset) {
    _activityLogState = { offset: 0, terminado: false, cargando: false };
    _alFiltros = _alFiltrosVacios();
    _alBorrador = _alFiltrosVacios();
    const listEl = document.getElementById("activity-log-list");
    if (listEl) listEl.innerHTML = "";
    _alDrawerHistoryOpen = false;
    _cerrarDrawerUIAL();
    _actualizarResumenFiltrosAL();
  }
  await _fetchActivityLogPage();
}

function cargarMasActivityLog() {
  if (_activityLogState.terminado || _activityLogState.cargando) return;
  _fetchActivityLogPage();
}

// ── Panel lateral de filtros ──────────────────────────────
function abrirFiltrosActivityLog() {
  _alBorrador = JSON.parse(JSON.stringify(_alFiltros));
  _renderDrawerBodyAL();

  const drawer = document.getElementById("al-drawer");
  const overlay = document.getElementById("al-drawer-overlay");
  if (!drawer || !overlay) return;
  drawer.classList.add("open");
  overlay.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", _onKeydownDrawerAL);

  if (!_alDrawerHistoryOpen) {
    history.pushState({ alDrawer: true }, "", location.hash);
    _alDrawerHistoryOpen = true;
  }
  _cargarUsuariosFiltroActivityLog();
}

// Solo cierra lo visual. Lo llaman el cierre normal y el popstate de app.js.
function _cerrarDrawerUIAL() {
  const drawer = document.getElementById("al-drawer");
  const overlay = document.getElementById("al-drawer-overlay");
  if (drawer) { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); }
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
  document.removeEventListener("keydown", _onKeydownDrawerAL);
}

function _cerrarDrawerAL() {
  // Con la entrada extra abierta, history.back() dispara popstate, que
  // apaga la bandera y llama a _cerrarDrawerUIAL.
  if (_alDrawerHistoryOpen) history.back();
  else _cerrarDrawerUIAL();
}

function _onKeydownDrawerAL(ev) {
  if (ev.key === "Escape") cancelarFiltrosActivityLog();
}

function cancelarFiltrosActivityLog() {
  _cerrarDrawerAL(); // el borrador se descarta: _alFiltros no cambia
}

function aplicarFiltrosActivityLog() {
  const ini = document.getElementById("al-f-fecha-inicio");
  const fin = document.getElementById("al-f-fecha-fin");
  if (ini) _alBorrador.fechaInicio = ini.value;
  if (fin) _alBorrador.fechaFin = fin.value;
  if (_alBorrador.fechaInicio && _alBorrador.fechaFin && _alBorrador.fechaInicio > _alBorrador.fechaFin) {
    if (typeof showToast === "function") showToast("La fecha de inicio es posterior a la de fin");
    return;
  }
  _alFiltros = JSON.parse(JSON.stringify(_alBorrador));
  _cerrarDrawerAL();
  _actualizarResumenFiltrosAL();
  filtrarActivityLog();
}

function limpiarFiltrosBorradorActivityLog() {
  _alBorrador = _alFiltrosVacios();
  _renderDrawerBodyAL();
}

// Cantidad de grupos de filtro con algo seleccionado
function _gruposActivosAL(f) {
  const grupos = [];
  if (f.usuarios.length) grupos.push("Usuario");
  if (f.fechaInicio || f.fechaFin) grupos.push("Fecha");
  if (f.tipos.length) grupos.push("Tipo");
  if (f.tablas.length) grupos.push("Tabla");
  return grupos;
}

function _actualizarResumenFiltrosAL() {
  const grupos = _gruposActivosAL(_alFiltros);
  const badge = document.getElementById("al-filter-badge");
  if (badge) {
    badge.style.display = grupos.length ? "" : "none";
    badge.textContent = String(grupos.length);
  }
  const resumen = document.getElementById("al-filter-resumen");
  if (resumen) resumen.textContent = grupos.length ? grupos.join(" · ") : "";
}

function _renderDrawerBodyAL() {
  const body = document.getElementById("al-drawer-body");
  if (!body) return;

  const chips = (grupo, opciones, seleccion) => opciones.map(([valor, label]) => `
    <button type="button" class="al-chip${seleccion.includes(valor) ? " is-on" : ""}"
            data-grupo="${grupo}" data-valor="${_escapeHtmlAL(valor)}"
            aria-pressed="${seleccion.includes(valor)}">${_escapeHtmlAL(label)}</button>`).join("");

  const tipos = Object.entries(ACTIVITY_LOG_OP_LABELS).map(([k, v]) => [k, v.label]);
  const tablas = Object.entries(ACTIVITY_LOG_TABLE_LABELS);

  body.innerHTML = `
    <section class="al-f-sec">
      <h3>Tipo</h3>
      <div class="al-chips">${chips("tipos", tipos, _alBorrador.tipos)}</div>
    </section>
    <section class="al-f-sec">
      <h3>Tabla</h3>
      <div class="al-chips">${chips("tablas", tablas, _alBorrador.tablas)}</div>
    </section>
    <section class="al-f-sec">
      <h3>Usuario</h3>
      <div class="al-f-usuarios" id="al-f-usuarios"></div>
    </section>
    <section class="al-f-sec">
      <h3>Fecha</h3>
      <div class="al-filtro-fecha-rango">
        <input type="date" class="al-filtro-fecha-input" id="al-f-fecha-inicio" aria-label="Fecha inicio" value="${_alBorrador.fechaInicio}" />
        <span class="al-filtro-fecha-sep">–</span>
        <input type="date" class="al-filtro-fecha-input" id="al-f-fecha-fin" aria-label="Fecha fin" value="${_alBorrador.fechaFin}" />
      </div>
    </section>`;

  _pintarUsuariosDrawerAL();
}

// Selección múltiple por delegación (chips de tipo/tabla y usuarios)
document.addEventListener("click", (ev) => {
  const el = ev.target.closest?.("#al-drawer-body [data-grupo]");
  if (!el) return;
  const lista = _alBorrador[el.dataset.grupo];
  if (!Array.isArray(lista)) return;
  const valor = el.dataset.valor;
  const i = lista.indexOf(valor);
  if (i === -1) lista.push(valor); else lista.splice(i, 1);
  const on = i === -1;
  el.classList.toggle("is-on", on);
  el.setAttribute("aria-pressed", String(on));
});

function _pintarUsuariosDrawerAL() {
  const cont = document.getElementById("al-f-usuarios");
  if (!cont) return;
  if (!_activityLogUsuariosCargados) {
    cont.innerHTML = `<p class="al-f-cargando">Cargando usuarios…</p>`;
    return;
  }
  if (_activityLogUsuariosOpciones.length === 0) {
    cont.innerHTML = `<p class="al-f-cargando">Sin usuarios registrados.</p>`;
    return;
  }
  cont.innerHTML = _activityLogUsuariosOpciones.map((op) => `
    <button type="button" class="al-user-row${_alBorrador.usuarios.includes(op.id) ? " is-on" : ""}"
            data-grupo="usuarios" data-valor="${_escapeHtmlAL(op.id)}"
            aria-pressed="${_alBorrador.usuarios.includes(op.id)}">
      <span class="al-user-check" aria-hidden="true"></span>
      <span class="al-user-email">${_escapeHtmlAL(op.email)}</span>
    </button>`).join("");
}

function filtrarActivityLog() {
  _activityLogState.offset = 0;
  _activityLogState.terminado = false;
  const listEl = document.getElementById("activity-log-list");
  if (listEl) listEl.innerHTML = "";
  _fetchActivityLogPage();
}

// Usuarios a partir de los emails distintos que ya aparecen en
// activity_log (evita depender de permisos sobre auth.users).
async function _cargarUsuariosFiltroActivityLog() {
  if (_activityLogUsuariosCargados) return;

  const { data, error } = await supabaseClient
    .from("activity_log")
    .select("changed_by, changed_by_email")
    .order("changed_at", { ascending: false })
    .limit(500); // suficiente para poblar el filtro sin traer toda la tabla

  if (error) {
    console.error("[activity-log] error cargando usuarios para filtro:", error);
    return;
  }

  const vistos = new Set();
  const opciones = [];
  for (const row of data || []) {
    if (!row.changed_by || vistos.has(row.changed_by)) continue;
    vistos.add(row.changed_by);
    opciones.push({ id: row.changed_by, email: row.changed_by_email || row.changed_by });
  }
  opciones.sort((a, b) => a.email.localeCompare(b.email));

  _activityLogUsuariosOpciones = opciones;
  _activityLogUsuariosCargados = true;
  _pintarUsuariosDrawerAL();
}

async function _fetchActivityLogPage() {
  if (_activityLogState.cargando) return;
  _activityLogState.cargando = true;

  const btnVerMas = document.getElementById("activity-log-ver-mas");
  if (btnVerMas) { btnVerMas.disabled = true; btnVerMas.textContent = "Cargando…"; }

  let query = supabaseClient
    .from("activity_log")
    .select("id, table_name, record_id, operation, old_data, new_data, changed_by, changed_by_email, changed_at")
    .order("changed_at", { ascending: false })
    .range(_activityLogState.offset, _activityLogState.offset + ACTIVITY_LOG_PAGE_SIZE - 1);

  const f = _alFiltros;
  if (f.tablas.length)   query = query.in("table_name", f.tablas);
  if (f.usuarios.length) query = query.in("changed_by", f.usuarios);
  if (f.tipos.length)    query = query.in("operation", f.tipos);
  // Los <input type="date"> entregan "YYYY-MM-DD" en hora local; para
  // "fin" se suma el día completo (hasta las 23:59:59.999) para que el
  // filtro sea inclusivo del día elegido.
  if (f.fechaInicio) query = query.gte("changed_at", `${f.fechaInicio}T00:00:00.000`);
  if (f.fechaFin)    query = query.lte("changed_at", `${f.fechaFin}T23:59:59.999`);

  const { data, error } = await query;

  if (error) {
    _activityLogState.cargando = false;
    console.error("[activity-log] error cargando registro de actividad:", error);
    const listEl = document.getElementById("activity-log-list");
    if (listEl && _activityLogState.offset === 0) {
      listEl.innerHTML = `<p class="al-empty">Error al cargar: ${_escapeHtmlAL(error.message || String(error))}</p>`;
    }
    if (btnVerMas) { btnVerMas.disabled = false; btnVerMas.textContent = "Ver más"; }
    return;
  }

  // Traducir ids a nombres antes de pintar (si falla, se muestran los ids)
  try {
    await _resolverReferenciasAL(data);
  } catch (e) {
    console.error("[activity-log] error resolviendo nombres:", e);
  }

  _activityLogState.cargando = false;

  const listEl = document.getElementById("activity-log-list");
  if (listEl) {
    if (_activityLogState.offset === 0 && (!data || data.length === 0)) {
      listEl.innerHTML = `<p class="al-empty">No hay actividad registrada con estos filtros.</p>`;
    } else {
      for (const row of data) listEl.appendChild(_renderActivityLogRow(row));
    }
  }

  _activityLogState.offset += data.length;
  _activityLogState.terminado = data.length < ACTIVITY_LOG_PAGE_SIZE;

  if (btnVerMas) {
    btnVerMas.disabled = false;
    btnVerMas.textContent = "Ver más";
    btnVerMas.style.display = _activityLogState.terminado ? "none" : "";
  }
}

// ── Traducción de ids a nombres ───────────────────────────
// Junta los ids de referencia de las filas, consulta en lote solo los que
// faltan en cache y deja el resultado en _alCache. Un id que ya no existe
// (registro eliminado) queda en null y se muestra como "#id (eliminado)".
async function _resolverReferenciasAL(rows) {
  const faltan = {};
  for (const t of Object.keys(_alCache)) faltan[t] = new Set();
  const agregar = (tabla, id) => {
    if (id === null || id === undefined || typeof id === "object") return;
    if (!_alCache[tabla].has(id)) faltan[tabla].add(id);
  };

  for (const row of rows || []) {
    for (const datos of [row.old_data, row.new_data]) {
      if (!datos) continue;
      for (const [clave, ref] of Object.entries(AL_REFS)) {
        if (clave in datos) agregar(ref.tabla, datos[clave]);
      }
    }
  }

  // Paso 1: viaje_pasajeros (aporta más ids de pasajero y viaje)
  if (faltan.viaje_pasajeros.size) {
    const ids = [...faltan.viaje_pasajeros];
    const { data } = await supabaseClient
      .from("viaje_pasajeros").select("id, pasajero_id, viaje_id").in("id", ids);
    const halladas = new Map((data || []).map((r) => [r.id, r]));
    for (const id of ids) {
      const r = halladas.get(id) || null;
      _alCache.viaje_pasajeros.set(id, r);
      if (r) { agregar("pasajeros", r.pasajero_id); agregar("viajes", r.viaje_id); }
    }
  }

  // Paso 2: el resto, en paralelo
  const tareas = [];
  const columnas = {
    viajes: "nombre", pasajeros: "Pasajero", metodos_de_pago: "metodo_de_pago",
    categorias: "nombre", servicios_extra: "nombre",
  };
  for (const [tabla, col] of Object.entries(columnas)) {
    if (!faltan[tabla].size) continue;
    const ids = [...faltan[tabla]];
    tareas.push(
      supabaseClient.from(tabla).select(`id, ${col}`).in("id", ids).then(({ data }) => {
        const halladas = new Map((data || []).map((r) => [r.id, r[col]]));
        for (const id of ids) _alCache[tabla].set(id, halladas.get(id) ?? null);
      })
    );
  }
  await Promise.all(tareas);
}

// Texto legible de un id de referencia (o null si no se pudo resolver)
function _nombreRefAL(clave, valor) {
  const ref = AL_REFS[clave];
  if (!ref || valor === null || valor === undefined) return null;
  if (clave === "viaje_pasajero_id") {
    const vp = _alCache.viaje_pasajeros.get(valor);
    if (!vp) return null;
    const pas = _alCache.pasajeros.get(vp.pasajero_id);
    const via = _alCache.viajes.get(vp.viaje_id);
    return [pas, via].filter(Boolean).join(" · ") || null;
  }
  return _alCache[ref.tabla].get(valor) ?? null;
}

// Descripción corta del registro afectado, para la fila colapsada
function _descripcionRegistroAL(row) {
  const d = row.new_data || row.old_data || {};
  if (d.nombre) return String(d.nombre);
  const partes = [];
  const pas = _nombreRefAL("pasajero_id", d.pasajero_id);
  if (pas) partes.push(pas);
  const vp = _nombreRefAL("viaje_pasajero_id", d.viaje_pasajero_id);
  if (vp) partes.push(vp);
  const via = _nombreRefAL("viaje_id", d.viaje_id);
  if (via) partes.push(via);
  return partes.join(" · ") || `#${row.record_id}`;
}

function _renderActivityLogRow(row) {
  const det = document.createElement("details");
  det.className = "al-item";

  const opInfo = ACTIVITY_LOG_OP_LABELS[row.operation] || { label: row.operation, cls: "" };
  const tablaLabel = ACTIVITY_LOG_TABLE_LABELS[row.table_name] || row.table_name;
  const fecha = _formatFechaActivityLog(row.changed_at);

  const summary = document.createElement("summary");
  summary.className = "al-summary";
  summary.innerHTML = `
    <span class="al-op-badge ${opInfo.cls}">${opInfo.label}</span>
    <span class="al-summary-main">
      <span class="al-summary-tabla">${_escapeHtmlAL(tablaLabel)}</span>
      <span class="al-summary-desc">${_escapeHtmlAL(_descripcionRegistroAL(row))}</span>
    </span>
    <span class="al-summary-meta">
      <span class="al-summary-user">${_escapeHtmlAL(row.changed_by_email || "—")}</span>
      <span class="al-summary-fecha">${fecha}</span>
    </span>
  `;
  det.appendChild(summary);

  const body = document.createElement("div");
  body.className = "al-body";
  body.appendChild(_renderActivityLogDiff(row));
  det.appendChild(body);

  return det;
}

// Arma el diff entre old_data y new_data. Si es INSERT, muestra todos
// los campos como "nuevo"; si es DELETE, todos como "eliminado"; si es
// UPDATE, solo las claves cuyo valor cambió (con antes → después).
function _renderActivityLogDiff(row) {
  const wrap = document.createElement("div");
  wrap.className = "al-diff";

  if (row.operation === "INSERT") {
    wrap.appendChild(_renderCamposSimples(row.new_data, "al-diff-nuevo"));
    return wrap;
  }
  if (row.operation === "DELETE") {
    wrap.appendChild(_renderCamposSimples(row.old_data, "al-diff-eliminado"));
    return wrap;
  }

  // UPDATE: comparar clave por clave
  const oldD = row.old_data || {};
  const newD = row.new_data || {};
  const claves = Array.from(new Set([...Object.keys(oldD), ...Object.keys(newD)])).sort();

  const tabla = document.createElement("table");
  tabla.className = "al-diff-table";
  let hayCambios = false;

  for (const clave of claves) {
    const antes = oldD[clave];
    const despues = newD[clave];
    if (JSON.stringify(antes) === JSON.stringify(despues)) continue; // sin cambio, no se muestra
    hayCambios = true;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="al-diff-campo">${_etiquetaCampoAL(clave)}</td>
      <td class="al-diff-antes">${_formatValorAL(antes, clave)}</td>
      <td class="al-diff-despues">${_formatValorAL(despues, clave)}</td>
    `;
    tabla.appendChild(tr);
  }

  if (!hayCambios) {
    const p = document.createElement("p");
    p.className = "al-empty";
    p.textContent = "Sin cambios detectados en los campos.";
    wrap.appendChild(p);
  } else {
    wrap.appendChild(tabla);
  }

  return wrap;
}

function _renderCamposSimples(datos, cls) {
  const tabla = document.createElement("table");
  tabla.className = `al-diff-table ${cls}`;
  for (const [clave, valor] of Object.entries(datos || {})) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="al-diff-campo">${_etiquetaCampoAL(clave)}</td>
      <td class="al-diff-valor" colspan="2">${_formatValorAL(valor, clave)}</td>
    `;
    tabla.appendChild(tr);
  }
  return tabla;
}

function _etiquetaCampoAL(clave) {
  return _escapeHtmlAL(AL_REFS[clave]?.label || clave);
}

function _formatValorAL(valor, clave) {
  if (valor === null || valor === undefined) return `<span class="al-null">—</span>`;
  if (clave && AL_REFS[clave] && typeof valor !== "object") {
    const nombre = _nombreRefAL(clave, valor);
    if (nombre) return `${_escapeHtmlAL(nombre)} <span class="al-id">#${_escapeHtmlAL(valor)}</span>`;
    return `<span class="al-id">#${_escapeHtmlAL(valor)} (eliminado)</span>`;
  }
  if (typeof valor === "object") return _escapeHtmlAL(JSON.stringify(valor));
  return _escapeHtmlAL(String(valor));
}

function _formatFechaActivityLog(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("es-PY", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function _escapeHtmlAL(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
