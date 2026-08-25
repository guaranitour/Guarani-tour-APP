// =====================================================================
// activity-log.js — Vista "Registro de actividad" (admin) sobre la
// tabla activity_log. Lista paginada con filtros por tabla y por
// usuario, cada fila expandible (<details>) mostrando el diff entre
// old_data y new_data.
// =====================================================================

const ACTIVITY_LOG_PAGE_SIZE = 25;

// Nombres amigables para mostrar en vez del nombre técnico de tabla
const ACTIVITY_LOG_TABLE_LABELS = {
  egresos: "Egresos",
  pagos: "Pagos",
  viajes: "Viajes",
  viaje_pasajeros: "Viaje pasajeros",
};

const ACTIVITY_LOG_OP_LABELS = {
  INSERT: { label: "Creación", cls: "al-op-insert" },
  UPDATE: { label: "Edición", cls: "al-op-update" },
  DELETE: { label: "Eliminación", cls: "al-op-delete" },
};

// Estado de paginación/filtros de la vista. Se resetea cada vez que se
// entra a la vista o cambia un filtro.
let _activityLogState = {
  offset: 0,
  tabla: "",
  usuario: "",
  terminado: false, // true cuando ya no hay más páginas
  cargando: false,
};

// Cache simple de "id de usuario -> email" para no repetir el join en
// cada fila; se llena on-demand al armar el <select> de usuarios.
let _activityLogUsuariosCargados = false;

async function loadActivityLog({ reset = false } = {}) {
  if (reset) {
    _activityLogState = { offset: 0, tabla: "", usuario: "", terminado: false, cargando: false };
    const listEl = document.getElementById("activity-log-list");
    if (listEl) listEl.innerHTML = "";
    const selTabla = document.getElementById("al-filtro-tabla");
    if (selTabla) selTabla.value = "";
    const selUsuario = document.getElementById("al-filtro-usuario");
    if (selUsuario) selUsuario.value = "";
    await _cargarUsuariosFiltroActivityLog();
  }
  await _fetchActivityLogPage();
}

function filtrarActivityLog() {
  const selTabla = document.getElementById("al-filtro-tabla");
  const selUsuario = document.getElementById("al-filtro-usuario");
  _activityLogState.tabla = selTabla ? selTabla.value : "";
  _activityLogState.usuario = selUsuario ? selUsuario.value : "";
  _activityLogState.offset = 0;
  _activityLogState.terminado = false;
  const listEl = document.getElementById("activity-log-list");
  if (listEl) listEl.innerHTML = "";
  _fetchActivityLogPage();
}

function cargarMasActivityLog() {
  if (_activityLogState.terminado || _activityLogState.cargando) return;
  _fetchActivityLogPage();
}

// Llena el <select> de usuarios a partir de los emails distintos que
// ya aparecen en activity_log (evita depender de permisos sobre auth.users).
async function _cargarUsuariosFiltroActivityLog() {
  if (_activityLogUsuariosCargados) return;
  const selUsuario = document.getElementById("al-filtro-usuario");
  if (!selUsuario) return;

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

  for (const op of opciones) {
    const optEl = document.createElement("option");
    optEl.value = op.id;
    optEl.textContent = op.email;
    selUsuario.appendChild(optEl);
  }

  _activityLogUsuariosCargados = true;
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

  if (_activityLogState.tabla) query = query.eq("table_name", _activityLogState.tabla);
  if (_activityLogState.usuario) query = query.eq("changed_by", _activityLogState.usuario);

  const { data, error } = await query;

  _activityLogState.cargando = false;

  if (error) {
    console.error("[activity-log] error cargando registro de actividad:", error);
    if (btnVerMas) { btnVerMas.disabled = false; btnVerMas.textContent = "Ver más"; }
    return;
  }

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
      <span class="al-summary-record">#${_escapeHtmlAL(String(row.record_id))}</span>
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
