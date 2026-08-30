// =====================================================================
// activity-log.js — Vista "Registro de actividad" (admin) sobre la
// tabla activity_log. Lista paginada con un filtro por dimensión
// (todo/usuario/fecha/tipo/tabla) accesible desde un ícono, cada fila
// expandible (<details>) mostrando el diff entre old_data y new_data.
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

// Dimensiones de filtro disponibles desde el ícono. Cada una define
// cómo se renderiza su panel dinámico y cómo se aplica a la query.
const ACTIVITY_LOG_DIMENSIONES = ["todo", "usuario", "fecha", "tipo", "tabla"];
const ACTIVITY_LOG_DIMENSION_LABELS = {
  todo: "Todo",
  usuario: "Usuario",
  fecha: "Fecha",
  tipo: "Tipo",
  tabla: "Tabla",
};

// Estado de paginación/filtros de la vista. Se resetea cada vez que se
// entra a la vista. `dimension` indica qué filtro está activo; los
// campos usuario/fechaInicio/fechaFin/tipo/tabla solo importan si
// dimension coincide con ellos.
let _activityLogState = {
  offset: 0,
  dimension: "todo",
  usuario: "",
  fechaInicio: "",
  fechaFin: "",
  tipo: "",
  tabla: "",
  terminado: false, // true cuando ya no hay más páginas
  cargando: false,
};

// Cache simple de "id de usuario -> email" para no repetir el join en
// cada fila; se llena on-demand al abrir el panel de usuario.
let _activityLogUsuariosCargados = false;
let _activityLogUsuariosOpciones = [];

async function loadActivityLog({ reset = false } = {}) {
  if (reset) {
    _activityLogState = {
      offset: 0, dimension: "todo", usuario: "", fechaInicio: "", fechaFin: "",
      tipo: "", tabla: "", terminado: false, cargando: false,
    };
    const listEl = document.getElementById("activity-log-list");
    if (listEl) listEl.innerHTML = "";
    _cerrarMenuFiltroActivityLog();
    _marcarDimensionActivaActivityLog("todo");
    _renderPanelFiltroActivityLog();
    _actualizarBadgeFiltroActivityLog();
  }
  await _fetchActivityLogPage();
}

function cargarMasActivityLog() {
  if (_activityLogState.terminado || _activityLogState.cargando) return;
  _fetchActivityLogPage();
}

// ── Ícono de filtro: abrir/cerrar el menú de dimensiones ──
function toggleActivityLogFilterMenu() {
  const menu = document.getElementById("al-filter-menu");
  const btn = document.getElementById("al-filter-toggle");
  if (!menu || !btn) return;
  const abierto = menu.style.display !== "none";
  if (abierto) {
    _cerrarMenuFiltroActivityLog();
  } else {
    menu.style.display = "";
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", _onClickFueraMenuFiltroActivityLog, { capture: true });
  }
}

function _cerrarMenuFiltroActivityLog() {
  const menu = document.getElementById("al-filter-menu");
  const btn = document.getElementById("al-filter-toggle");
  if (menu) menu.style.display = "none";
  if (btn) btn.setAttribute("aria-expanded", "false");
  document.removeEventListener("click", _onClickFueraMenuFiltroActivityLog, { capture: true });
}

function _onClickFueraMenuFiltroActivityLog(ev) {
  const dropdown = document.getElementById("al-filter-dropdown");
  if (dropdown && !dropdown.contains(ev.target)) _cerrarMenuFiltroActivityLog();
}

// Selección de dimensión desde el menú del ícono: cambia qué panel
// dinámico se muestra a la derecha y dispara la búsqueda cuando
// corresponde (p. ej. "todo" no necesita un segundo valor).
function seleccionarDimensionActivityLog(dimension) {
  if (!ACTIVITY_LOG_DIMENSIONES.includes(dimension)) return;
  _activityLogState.dimension = dimension;
  _activityLogState.usuario = "";
  _activityLogState.fechaInicio = "";
  _activityLogState.fechaFin = "";
  _activityLogState.tipo = "";
  _activityLogState.tabla = "";
  _marcarDimensionActivaActivityLog(dimension);
  _cerrarMenuFiltroActivityLog();
  _renderPanelFiltroActivityLog();
  _actualizarBadgeFiltroActivityLog();

  if (dimension === "todo") {
    filtrarActivityLog();
  }
  // Para las demás dimensiones, la búsqueda se dispara recién cuando
  // el usuario elige un valor en el panel dinámico (ver los listeners
  // "change" agregados en _renderPanelFiltroActivityLog), no al abrir
  // el panel.
}

function _marcarDimensionActivaActivityLog(dimension) {
  const items = document.querySelectorAll("#al-filter-menu .al-filter-menu-item");
  items.forEach((el) => el.classList.toggle("is-active", el.dataset.dim === dimension));
}

function _actualizarBadgeFiltroActivityLog() {
  const badge = document.getElementById("al-filter-badge");
  if (!badge) return;
  const activo = _activityLogState.dimension !== "todo";
  badge.style.display = activo ? "" : "none";
}

// Arma el panel dinámico según la dimensión activa. Se reconstruye
// entero cada vez que cambia la dimensión (es liviano: a lo sumo dos
// selects o dos inputs de fecha).
function _renderPanelFiltroActivityLog() {
  const cont = document.getElementById("al-filter-dynamic");
  if (!cont) return;
  cont.innerHTML = "";

  const dim = _activityLogState.dimension;

  if (dim === "todo") {
    return; // sin segundo control
  }

  if (dim === "tipo") {
    const sel = document.createElement("select");
    sel.className = "mov-filtro-select al-filtro-dynamic-select";
    sel.id = "al-filtro-tipo";
    sel.innerHTML = `
      <option value="">Todo</option>
      <option value="INSERT">Creación</option>
      <option value="UPDATE">Edición</option>
      <option value="DELETE">Eliminación</option>
    `;
    sel.value = _activityLogState.tipo;
    sel.addEventListener("change", () => {
      _activityLogState.tipo = sel.value;
      filtrarActivityLog();
    });
    cont.appendChild(sel);
    return;
  }

  if (dim === "tabla") {
    const sel = document.createElement("select");
    sel.className = "mov-filtro-select al-filtro-dynamic-select";
    sel.id = "al-filtro-tabla";
    sel.innerHTML = `
      <option value="">Todas</option>
      <option value="egresos">Egresos</option>
      <option value="pagos">Pagos</option>
      <option value="viajes">Viajes</option>
      <option value="viaje_pasajeros">Viaje pasajeros</option>
      <option value="categorias">Categorías</option>
      <option value="contactos_emergencia">Contactos de emergencia</option>
      <option value="servicio_extra_pasajeros">Servicio extra pasajeros</option>
      <option value="servicios_extra">Servicios extra</option>
    `;
    sel.value = _activityLogState.tabla;
    sel.addEventListener("change", () => {
      _activityLogState.tabla = sel.value;
      filtrarActivityLog();
    });
    cont.appendChild(sel);
    return;
  }

  if (dim === "usuario") {
    const sel = document.createElement("select");
    sel.className = "mov-filtro-select al-filtro-dynamic-select";
    sel.id = "al-filtro-usuario";
    sel.innerHTML = `<option value="">Todos</option>`;
    cont.appendChild(sel);
    sel.addEventListener("change", () => {
      _activityLogState.usuario = sel.value;
      filtrarActivityLog();
    });
    _cargarUsuariosFiltroActivityLog(sel);
    return;
  }

  if (dim === "fecha") {
    const wrap = document.createElement("div");
    wrap.className = "al-filtro-fecha-rango";
    wrap.innerHTML = `
      <input type="date" class="al-filtro-fecha-input" id="al-filtro-fecha-inicio" aria-label="Fecha inicio" />
      <span class="al-filtro-fecha-sep">–</span>
      <input type="date" class="al-filtro-fecha-input" id="al-filtro-fecha-fin" aria-label="Fecha fin" />
    `;
    cont.appendChild(wrap);

    const inputInicio = wrap.querySelector("#al-filtro-fecha-inicio");
    const inputFin = wrap.querySelector("#al-filtro-fecha-fin");
    inputInicio.value = _activityLogState.fechaInicio;
    inputFin.value = _activityLogState.fechaFin;

    const onChangeFecha = () => {
      _activityLogState.fechaInicio = inputInicio.value;
      _activityLogState.fechaFin = inputFin.value;
      // Solo buscamos cuando hay al menos una fecha cargada, para no
      // relanzar la query en cada apertura del panel sin datos.
      if (_activityLogState.fechaInicio || _activityLogState.fechaFin) {
        filtrarActivityLog();
      }
    };
    inputInicio.addEventListener("change", onChangeFecha);
    inputFin.addEventListener("change", onChangeFecha);
    return;
  }
}

function filtrarActivityLog() {
  _activityLogState.offset = 0;
  _activityLogState.terminado = false;
  const listEl = document.getElementById("activity-log-list");
  if (listEl) listEl.innerHTML = "";
  _fetchActivityLogPage();
}

// Llena el <select> de usuarios a partir de los emails distintos que
// ya aparecen en activity_log (evita depender de permisos sobre auth.users).
async function _cargarUsuariosFiltroActivityLog(selUsuario) {
  if (!selUsuario) return;

  if (_activityLogUsuariosCargados) {
    _pintarOpcionesUsuarioActivityLog(selUsuario);
    return;
  }

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
  _pintarOpcionesUsuarioActivityLog(selUsuario);
}

function _pintarOpcionesUsuarioActivityLog(selUsuario) {
  for (const op of _activityLogUsuariosOpciones) {
    const optEl = document.createElement("option");
    optEl.value = op.id;
    optEl.textContent = op.email;
    selUsuario.appendChild(optEl);
  }
  selUsuario.value = _activityLogState.usuario;
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

  const st = _activityLogState;
  if (st.dimension === "tabla" && st.tabla) query = query.eq("table_name", st.tabla);
  if (st.dimension === "usuario" && st.usuario) query = query.eq("changed_by", st.usuario);
  if (st.dimension === "tipo" && st.tipo) query = query.eq("operation", st.tipo);
  if (st.dimension === "fecha") {
    // Los <input type="date"> entregan "YYYY-MM-DD" en hora local; para
    // "fin" sumamos el día completo (hasta las 23:59:59.999) para que
    // el filtro sea inclusivo del día elegido.
    if (st.fechaInicio) query = query.gte("changed_at", `${st.fechaInicio}T00:00:00.000`);
    if (st.fechaFin) query = query.lte("changed_at", `${st.fechaFin}T23:59:59.999`);
  }

  const { data, error } = await query;

  _activityLogState.cargando = false;

  if (error) {
    console.error("[activity-log] error cargando registro de actividad:", error);
    const listEl = document.getElementById("activity-log-list");
    if (listEl && _activityLogState.offset === 0) {
      listEl.innerHTML = `<p class="al-empty">Error al cargar: ${_escapeHtmlAL(error.message || String(error))}</p>`;
    }
    if (btnVerMas) { btnVerMas.disabled = false; btnVerMas.textContent = "Ver más"; }
    return;
  }

  console.log("[activity-log] filas recibidas:", data.length, data);

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
  const cambiosVisibles = [];

  for (const clave of claves) {
    const antes = oldD[clave];
    const despues = newD[clave];
    if (JSON.stringify(antes) === JSON.stringify(despues)) continue; // sin cambio, no se muestra
    cambiosVisibles.push(clave);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="al-diff-campo">${_escapeHtmlAL(clave)}</td>
      <td class="al-diff-antes">${_formatValorAL(antes)}</td>
      <td class="al-diff-despues">${_formatValorAL(despues)}</td>
    `;
    tabla.appendChild(tr);
  }

  if (cambiosVisibles.length === 0) {
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
      <td class="al-diff-campo">${_escapeHtmlAL(clave)}</td>
      <td class="al-diff-valor" colspan="2">${_formatValorAL(valor)}</td>
    `;
    tabla.appendChild(tr);
  }
  return tabla;
}

function _formatValorAL(valor) {
  if (valor === null || valor === undefined) return `<span class="al-null">—</span>`;
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
