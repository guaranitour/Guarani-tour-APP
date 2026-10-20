/* ═══════════════════════════════════════════════
   notificaciones.js — Recordatorios y consejos para el staff
   · Bandeja: cada persona ve sus notificaciones (leído / no leído)
   · Administrar: crear, programar, repetir, pausar y eliminar
   Tablas: notificaciones, notificaciones_bandeja
   Envío: edge function send-notifications (ver sql/notificaciones.sql)
═══════════════════════════════════════════════ */

const NOTIF_TIPOS = {
  recordatorio: { label: "Recordatorio", icono: "⏰" },
  consejo:      { label: "Consejo",      icono: "💡" },
  correo:       { label: "Correo",       icono: "⚠️" },   // automática (resend-webhook), no se crea a mano
};
const NOTIF_ROLES = ["admin", "worker", "finanzas", "viewer"];
const NOTIF_FRECUENCIAS = { unica: "Una sola vez", diaria: "Todos los días", semanal: "Cada semana", mensual: "Cada mes" };

let _notifTab        = "bandeja";
let _notifAdminList  = [];
let _notifStaff      = null;   // [{ id, nombre, email, role }], se pide una vez
let _notifEditandoId = null;

function _escN(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function _notifPuedeAdministrar() {
  return can("notificaciones.crear") || can("notificaciones.editar") || can("notificaciones.eliminar");
}

function _notifFechaCorta(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-PY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function _notifTiempoRelativo(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} d`;
  return _notifFechaCorta(iso);
}

// ── Contador de no leídas (menú hamburguesa) ───────────────
let _notifUltimoConteo = 0;

// Una sola consulta: cuenta las no leídas y trae la más reciente
// (para la campana, el menú y la tarjeta del Inicio).
async function actualizarBadgeNotificaciones() {
  if (typeof can !== "function" || !can("notificaciones.ver")) return;
  const { data, count, error } = await supabaseClient
    .from("notificaciones_bandeja")
    .select("id, tipo, titulo, mensaje, created_at", { count: "exact" })
    .is("leida_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) return;
  const n = count || 0;
  const texto = n > 99 ? "99+" : String(n);

  const badge = document.getElementById("menu-notif-badge");
  if (badge) {
    badge.textContent = texto;
    badge.style.display = n > 0 ? "" : "none";
  }

  const bell = document.getElementById("topbar-bell");
  if (bell) {
    bell.style.display = "";
    const c = document.getElementById("topbar-bell-count");
    if (c) {
      c.textContent = texto;
      c.style.display = n > 0 ? "" : "none";
    }
    // La campana se mueve unos segundos solo cuando hay novedades
    if (n > _notifUltimoConteo) {
      bell.classList.remove("ring");
      void bell.offsetWidth;
      bell.classList.add("ring");
    }
  }
  _notifUltimoConteo = n;

  _renderTarjetaNotifInicio(n, data && data[0]);
}

// Tarjeta arriba del Inicio con la última notificación sin leer
function _renderTarjetaNotifInicio(total, ultima) {
  const card = document.getElementById("dash-notif-card");
  if (!card) return;
  if (!ultima || total === 0) {
    card.style.display = "none";
    card.innerHTML = "";
    return;
  }
  const t = NOTIF_TIPOS[ultima.tipo] || NOTIF_TIPOS.recordatorio;
  card.innerHTML = `
    <button type="button" class="dash-notif" onclick="navigateTo('notificaciones')">
      <span class="notif-item-icono">${t.icono}</span>
      <span class="notif-item-body">
        <span class="dash-notif-titulo">${_escN(ultima.titulo)}</span>
        <span class="dash-notif-mensaje">${_escN(ultima.mensaje)}</span>
        <span class="notif-item-meta">${_notifTiempoRelativo(ultima.created_at)}${total > 1 ? ` · y ${total - 1} más sin leer` : ""}</span>
      </span>
      <span class="dash-notif-ver">Ver</span>
    </button>`;
  card.style.display = "";
}

// ── Vista ────────────────────────────────────────────────────
async function loadNotificaciones() {
  const tabs = document.getElementById("notif-tabs");
  if (!tabs) return;

  const admin = _notifPuedeAdministrar();
  tabs.style.display = admin ? "" : "none";
  if (!admin) _notifTab = "bandeja";
  switchNotifTab(_notifTab);
}

function switchNotifTab(tab) {
  _notifTab = tab;
  document.querySelectorAll("#notif-tabs .notif-tab").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.getElementById("notif-bandeja").style.display = tab === "bandeja" ? "" : "none";
  document.getElementById("notif-admin").style.display   = tab === "admin"   ? "" : "none";
  if (tab === "bandeja") cargarBandeja();
  else cargarAdminNotificaciones();
}

// ── BANDEJA ──────────────────────────────────────────────────
async function cargarBandeja() {
  const cont = document.getElementById("notif-bandeja-list");
  if (!cont) return;
  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const { data, error } = await supabaseClient
    .from("notificaciones_bandeja")
    .select("id, tipo, titulo, mensaje, created_at, leida_at")
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) {
    console.error(error);
    cont.innerHTML = `<div class="viaje-pasajeros-empty">No se pudieron cargar las notificaciones</div>`;
    return;
  }

  const sinLeer = (data || []).filter(n => !n.leida_at).length;
  const btnTodas = document.getElementById("notif-marcar-todas");
  if (btnTodas) btnTodas.style.display = sinLeer > 0 ? "" : "none";

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">No tenés notificaciones</div>`;
    return;
  }

  cont.innerHTML = data.map(n => {
    const t = NOTIF_TIPOS[n.tipo] || NOTIF_TIPOS.recordatorio;
    return `
      <div class="notif-item ${n.leida_at ? "" : "sin-leer"} tipo-${_escN(n.tipo)}" onclick="marcarNotificacionLeida('${n.id}', this)">
        <span class="notif-item-icono">${t.icono}</span>
        <div class="notif-item-body">
          <div class="notif-item-titulo">${_escN(n.titulo)}</div>
          <div class="notif-item-mensaje">${_escN(n.mensaje)}</div>
          <div class="notif-item-meta">${t.label} · ${_notifTiempoRelativo(n.created_at)}</div>
        </div>
        <span class="notif-item-punto"></span>
      </div>`;
  }).join("");
}

async function marcarNotificacionLeida(id, el) {
  if (!el.classList.contains("sin-leer")) return;
  el.classList.remove("sin-leer");
  const { error } = await supabaseClient
    .from("notificaciones_bandeja")
    .update({ leida_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    el.classList.add("sin-leer");
    return;
  }
  actualizarBadgeNotificaciones();
  if (!document.querySelector("#notif-bandeja-list .sin-leer")) {
    const b = document.getElementById("notif-marcar-todas");
    if (b) b.style.display = "none";
  }
}

async function marcarTodasLeidas() {
  const { error } = await supabaseClient
    .from("notificaciones_bandeja")
    .update({ leida_at: new Date().toISOString() })
    .is("leida_at", null);
  if (error) { showToast("No se pudo actualizar", "error"); return; }
  actualizarBadgeNotificaciones();
  cargarBandeja();
}

// ── ADMINISTRAR ─────────────────────────────────────────────
async function cargarAdminNotificaciones() {
  const cont = document.getElementById("notif-admin-list");
  if (!cont) return;

  const btnNueva = document.getElementById("notif-btn-nueva");
  if (btnNueva) btnNueva.style.display = can("notificaciones.crear") ? "" : "none";

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;
  const { data, error } = await supabaseClient
    .from("notificaciones")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    cont.innerHTML = `<div class="viaje-pasajeros-empty">No se pudieron cargar las notificaciones</div>`;
    return;
  }
  _notifAdminList = data || [];

  if (_notifAdminList.length === 0) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Todavía no creaste ninguna notificación</div>`;
    return;
  }

  const puedeEditar   = can("notificaciones.editar");
  const puedeEliminar = can("notificaciones.eliminar");

  cont.innerHTML = _notifAdminList.map(n => {
    const t = NOTIF_TIPOS[n.tipo] || NOTIF_TIPOS.recordatorio;
    const destino = n.destino === "todos" ? "Todos"
      : n.destino === "roles" ? n.roles.join(", ")
      : `${n.staff_ids.length} persona${n.staff_ids.length === 1 ? "" : "s"}`;
    const estado = n.activa
      ? `<span class="notif-estado activa">Próximo: ${_notifFechaCorta(n.proxima_ejecucion)}</span>`
      : `<span class="notif-estado">${n.ultimo_envio ? "Enviada " + _notifFechaCorta(n.ultimo_envio) : "Pausada"}</span>`;
    return `
      <div class="notif-admin-item ${n.activa ? "" : "inactiva"}">
        <div class="notif-admin-head">
          <span class="notif-item-icono">${t.icono}</span>
          <div class="notif-item-body">
            <div class="notif-item-titulo">${_escN(n.titulo)}</div>
            <div class="notif-item-mensaje">${_escN(n.mensaje)}</div>
            <div class="notif-item-meta">${_escN(destino)} · ${NOTIF_FRECUENCIAS[n.frecuencia]}</div>
          </div>
        </div>
        <div class="notif-admin-foot">
          ${estado}
          <span class="notif-admin-acciones">
            ${puedeEditar ? `<button type="button" onclick="editarNotificacion('${n.id}')">Editar</button>` : ""}
            ${puedeEditar && n.activa ? `<button type="button" onclick="pausarNotificacion('${n.id}')">Pausar</button>` : ""}
            ${puedeEliminar ? `<button type="button" class="peligro" onclick="eliminarNotificacion('${n.id}')">Eliminar</button>` : ""}
          </span>
        </div>
      </div>`;
  }).join("");
}

async function pausarNotificacion(id) {
  if (!can("notificaciones.editar")) return;
  const { error } = await supabaseClient
    .from("notificaciones")
    .update({ activa: false, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) { showToast("No se pudo pausar", "error"); return; }
  showToast("Notificación pausada", "success");
  cargarAdminNotificaciones();
}

async function eliminarNotificacion(id) {
  if (!can("notificaciones.eliminar")) return;
  const n = _notifAdminList.find(x => x.id === id);
  if (!n) return;
  const ok = await confirmar({
    titulo: "Eliminar notificación",
    mensaje: `¿Eliminar "${n.titulo}"? Deja de enviarse; lo que ya recibieron queda en sus bandejas.`,
    confirmarTexto: "Eliminar",
    peligro: true,
  });
  if (!ok) return;
  const { error } = await supabaseClient.from("notificaciones").delete().eq("id", id);
  if (error) { showToast("No se pudo eliminar", "error"); return; }
  showToast("Notificación eliminada", "success");
  cargarAdminNotificaciones();
}

// ── FORMULARIO ──────────────────────────────────────────────
async function _notifCargarStaff() {
  if (_notifStaff) return _notifStaff;
  const { data, error } = await supabaseClient
    .from("staff")
    .select("id, nombre, email, role")
    .eq("status", "enabled")
    .order("nombre");
  if (error) { console.warn("No se pudo cargar el staff:", error); return []; }
  _notifStaff = data || [];
  return _notifStaff;
}

// datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local
function _notifParaInput(date) {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

async function abrirFormNotificacion(n = null) {
  _notifEditandoId = n ? n.id : null;
  const staff = await _notifCargarStaff();
  const form = document.getElementById("notif-form");

  const rolesSel = new Set(n?.roles || []);
  const staffSel = new Set(n?.staff_ids || []);
  const cuando   = n?.proxima_ejecucion ? new Date(n.proxima_ejecucion) : new Date(Date.now() + 3600000);

  form.innerHTML = `
    <div class="form-field">
      <label class="form-label">Tipo</label>
      <div class="notif-segmento" id="nf-tipo">
        ${Object.entries(NOTIF_TIPOS).filter(([k]) => k !== "correo").map(([k, t]) => `
          <button type="button" data-v="${k}" class="${(n?.tipo || "recordatorio") === k ? "active" : ""}"
                  onclick="_notifSeg(this)">${t.icono} ${t.label}</button>`).join("")}
      </div>
    </div>
    <div class="form-field">
      <label class="form-label">Título <span class="req">*</span></label>
      <input type="text" id="nf-titulo" class="form-input" maxlength="80" value="${_escN(n?.titulo || "")}" placeholder="Ej: Cargar los egresos del viaje" />
    </div>
    <div class="form-field">
      <label class="form-label">Mensaje <span class="req">*</span></label>
      <textarea id="nf-mensaje" class="form-input" rows="3" maxlength="400" placeholder="Qué querés que lean">${_escN(n?.mensaje || "")}</textarea>
    </div>
    <div class="form-field">
      <label class="form-label">Para</label>
      <select id="nf-destino" class="form-input" onchange="_notifDestinoCambio()">
        <option value="todos"    ${n?.destino === "roles" || n?.destino === "usuarios" ? "" : "selected"}>Todo el staff</option>
        <option value="roles"    ${n?.destino === "roles" ? "selected" : ""}>Por rol</option>
        <option value="usuarios" ${n?.destino === "usuarios" ? "selected" : ""}>Personas específicas</option>
      </select>
    </div>
    <div class="form-field notif-opciones" id="nf-roles" style="display:none">
      ${NOTIF_ROLES.map(r => `
        <label><input type="checkbox" value="${r}" ${rolesSel.has(r) ? "checked" : ""}> ${r}</label>`).join("")}
    </div>
    <div class="form-field notif-opciones" id="nf-usuarios" style="display:none">
      ${staff.length ? staff.map(s => `
        <label><input type="checkbox" value="${s.id}" ${staffSel.has(s.id) ? "checked" : ""}> ${_escN(s.nombre || s.email)}</label>`).join("")
        : `<span class="notif-item-meta">No se pudo cargar la lista de personas</span>`}
    </div>
    <div class="form-field">
      <label class="form-label">Cuándo</label>
      <select id="nf-cuando" class="form-input" onchange="_notifCuandoCambio()">
        ${n ? "" : `<option value="ahora">Enviar ahora</option>`}
        <option value="programar" ${n ? "selected" : ""}>Programar fecha y hora</option>
      </select>
    </div>
    <div class="form-field" id="nf-fecha-wrap" style="display:none">
      <label class="form-label">Fecha y hora</label>
      <input type="datetime-local" id="nf-fecha" class="form-input" value="${_notifParaInput(cuando)}" />
    </div>
    <div class="form-field">
      <label class="form-label">Repetir</label>
      <select id="nf-frecuencia" class="form-input" onchange="_notifCuandoCambio()">
        ${Object.entries(NOTIF_FRECUENCIAS).map(([k, l]) =>
          `<option value="${k}" ${(n?.frecuencia || "unica") === k ? "selected" : ""}>${l}</option>`).join("")}
      </select>
    </div>
    <div class="form-field" id="nf-termina-wrap" style="display:none">
      <label class="form-label">Dejar de repetir el (opcional)</label>
      <input type="date" id="nf-termina" class="form-input" value="${n?.termina_en ? n.termina_en.slice(0, 10) : ""}" />
    </div>
    <div class="form-error" id="nf-error"></div>
    <div class="form-actions">
      <button type="button" class="btn-cancel" onclick="cerrarFormNotificacion()">Cancelar</button>
      <button type="button" class="btn-save" id="nf-guardar" onclick="guardarNotificacion()">${n ? "Guardar cambios" : "Crear"}</button>
    </div>`;

  document.getElementById("notif-form-wrap").style.display = "";
  document.getElementById("notif-admin-list").style.display = "none";
  document.getElementById("notif-btn-nueva").style.display = "none";
  _notifDestinoCambio();
  _notifCuandoCambio();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editarNotificacion(id) {
  if (!can("notificaciones.editar")) return;
  const n = _notifAdminList.find(x => x.id === id);
  if (n) abrirFormNotificacion(n);
}

function cerrarFormNotificacion() {
  _notifEditandoId = null;
  document.getElementById("notif-form-wrap").style.display = "none";
  document.getElementById("notif-admin-list").style.display = "";
  document.getElementById("notif-btn-nueva").style.display = can("notificaciones.crear") ? "" : "none";
}

function _notifSeg(btn) {
  btn.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
}

function _notifDestinoCambio() {
  const d = document.getElementById("nf-destino").value;
  document.getElementById("nf-roles").style.display    = d === "roles" ? "" : "none";
  document.getElementById("nf-usuarios").style.display = d === "usuarios" ? "" : "none";
}

function _notifCuandoCambio() {
  const programar = document.getElementById("nf-cuando").value === "programar";
  document.getElementById("nf-fecha-wrap").style.display = programar ? "" : "none";
  document.getElementById("nf-termina-wrap").style.display =
    document.getElementById("nf-frecuencia").value !== "unica" ? "" : "none";
}

async function guardarNotificacion() {
  const editando = !!_notifEditandoId;
  if (!can(editando ? "notificaciones.editar" : "notificaciones.crear")) return;

  const errEl = document.getElementById("nf-error");
  const val = (id) => document.getElementById(id).value;
  const marcados = (id) => [...document.querySelectorAll(`#${id} input:checked`)].map(i => i.value);

  const titulo  = val("nf-titulo").trim();
  const mensaje = val("nf-mensaje").trim();
  const destino = val("nf-destino");
  const roles   = destino === "roles" ? marcados("nf-roles") : [];
  const staffIds = destino === "usuarios" ? marcados("nf-usuarios") : [];
  const frecuencia = val("nf-frecuencia");

  if (!titulo || !mensaje) { errEl.textContent = "Completá el título y el mensaje."; return; }
  if (destino === "roles" && roles.length === 0) { errEl.textContent = "Elegí al menos un rol."; return; }
  if (destino === "usuarios" && staffIds.length === 0) { errEl.textContent = "Elegí al menos una persona."; return; }

  const ahora = val("nf-cuando") === "ahora";
  let proxima = new Date();
  if (!ahora) {
    proxima = new Date(val("nf-fecha"));
    if (isNaN(proxima)) { errEl.textContent = "Elegí la fecha y hora."; return; }
    if (!editando && proxima.getTime() < Date.now() - 60000) {
      errEl.textContent = "La fecha ya pasó."; return;
    }
  }

  let terminaEn = null;
  if (frecuencia !== "unica" && val("nf-termina")) {
    terminaEn = new Date(val("nf-termina") + "T23:59:59");
    if (terminaEn <= proxima) { errEl.textContent = "La fecha final debe ser posterior al primer envío."; return; }
  }
  errEl.textContent = "";

  const fila = {
    tipo: document.querySelector("#nf-tipo .active")?.dataset.v || "recordatorio",
    titulo, mensaje, destino, roles, staff_ids: staffIds, frecuencia,
    proxima_ejecucion: proxima.toISOString(),
    termina_en: terminaEn ? terminaEn.toISOString() : null,
    activa: true,
    updated_at: new Date().toISOString(),
  };

  const btn = document.getElementById("nf-guardar");
  btn.disabled = true;

  let error;
  if (editando) {
    ({ error } = await supabaseClient.from("notificaciones").update(fila).eq("id", _notifEditandoId));
  } else {
    const { data: u } = await supabaseClient.auth.getUser();
    ({ error } = await supabaseClient.from("notificaciones").insert({ ...fila, creada_por: u?.user?.email || null }));
  }

  if (error) {
    console.error(error);
    errEl.textContent = error.message || "No se pudo guardar.";
    btn.disabled = false;
    return;
  }

  // Si vence ya, se dispara el envío sin esperar al cron de 5 minutos
  if (proxima.getTime() <= Date.now() + 60000) {
    supabaseClient.functions.invoke("send-notifications").catch(e => console.warn("send-notifications:", e));
    showToast("Notificación enviada", "success");
  } else {
    showToast(editando ? "Cambios guardados" : "Notificación programada", "success");
  }

  cerrarFormNotificacion();
  setTimeout(cargarAdminNotificaciones, ahora ? 1500 : 0);
}
