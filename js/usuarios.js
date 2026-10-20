/* usuarios.js — Gestión de usuarios del staff */

// Extrae iniciales de un email (ej: "jperez@mail.com" → "JP")
function getInitials(email) {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

// Formatea un timestamp de última conexión como texto relativo en español.
// < 1 min → "Activo ahora" · < 60 min → "Activo hace N min"
// < 24 h  → "Activo hace N h" · resto → "Últ. vez DD mes, HH:MM"
function formatLastSeen(iso) {
  if (!iso) return "Sin conexiones registradas";

  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1)  return "Activo ahora";
  if (diffMin < 60) return `Activo hace ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Activo hace ${diffH} h`;

  const dia = then.getDate();
  const mes = then.toLocaleDateString("es-PY", { month: "short" }).replace(".", "");
  const hora = then.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" });
  return `Últ. vez ${dia} ${mes}, ${hora}`;
}

// Un usuario se considera "en línea" (dot verde) si conectó en los últimos 15 min
function isOnline(iso) {
  if (!iso) return false;
  return (Date.now() - new Date(iso).getTime()) < 15 * 60 * 1000;
}

// Arma el markup del avatar: usa la foto de Google (staff.avatar_url) si
// existe, con fallback automático a iniciales si la imagen falla al cargar
// (token revocado, imagen expirada, etc.). Sin avatar_url, va directo a
// iniciales sin intentar red.
function renderAvatar(email, avatarUrl) {
  const initials = getInitials(email);
  if (!avatarUrl) {
    return `<div class="user-avatar" aria-hidden="true">${initials}</div>`;
  }
  return `
    <div class="user-avatar" aria-hidden="true">
      <img src="${avatarUrl}" alt="" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.closest('.user-avatar').classList.add('fallback'); this.remove();">
      <span class="user-avatar-fallback">${initials}</span>
    </div>`;
}

// Muestra un feedback breve debajo de un select (reemplaza alert)
function showFeedback(selectEl, tipo) {
  // Si el trigger es un select oculto dentro de .user-field-wrap (rol/estado),
  // el feedback se ancla al contenedor .user-controls en vez del wrapper
  // chico del badge, que quedaría recortado. Para el input de nombre, se
  // ancla a su parentElement normal (comportamiento original).
  const anchor = selectEl.closest(".user-controls") || selectEl.parentElement;

  const prev = anchor.querySelector(".user-feedback");
  if (prev) prev.remove();

  const fb = document.createElement("span");
  fb.className = `user-feedback ${tipo}`;
  fb.textContent = tipo === "ok" ? "✓ Guardado" : "Error al guardar";
  anchor.appendChild(fb);

  requestAnimationFrame(() => fb.classList.add("show"));
  setTimeout(() => {
    fb.classList.remove("show");
    setTimeout(() => fb.remove(), 300);
  }, 1800);
}


// Traduce el error de Supabase a un mensaje entendible. Las reglas viven en
// la base (trigger _staff_proteger_cambios + RLS de staff), así que el
// texto del trigger se reutiliza y el resto se mapea por código.
function mensajeErrorStaff(error, accion = "guardar") {
  const msg = error?.message || "";
  if (error?.code === "23505") return "Ya existe un usuario con ese correo";
  if (error?.code === "42501") {
    // Mensajes propios del trigger ("requiere la tarea…", "No podés…")
    if (msg && !/row-level security/i.test(msg)) return msg;
    return `No tenés permiso para ${accion} usuarios`;
  }
  return msg ? `No se pudo ${accion}: ${msg}` : `No se pudo ${accion}`;
}

async function loadUsers() {
  const list = document.getElementById("users-list");
  if (!list) return;

  list.innerHTML = `<div class="list-state">Cargando…</div>`;

  // El alta de usuarios se muestra solo con la tarea usuarios.crear
  const addToggle = document.getElementById("u-add-toggle");
  if (addToggle) addToggle.style.display = can("usuarios.crear") ? "" : "none";

  const [staffRes, catRes, rolRes, spRes] = await Promise.all([
    supabaseClient
      .from("staff")
      .select("id, email, role, status, nombre, last_seen, avatar_url")
      .order("email"),
    supabaseClient.from("permisos").select("codigo, modulo, descripcion").order("codigo"),
    supabaseClient.from("rol_permisos").select("role, permiso"),
    supabaseClient.from("staff_permisos").select("staff_id, permiso, concedido"),
  ]);
  const { data, error } = staffRes;
  if (catRes.error || rolRes.error || spRes.error) {
    console.warn("No se pudieron cargar las tareas:", catRes.error || rolRes.error || spRes.error);
  }
  _cargarTareasCache(catRes.data, rolRes.data, spRes.data);
  _usuariosList = data || [];

  if (error) {
    console.error(error);
    list.innerHTML = `<div class="list-state">Error al cargar usuarios</div>`;
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = `
      <div class="users-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
        </svg>
        Sin usuarios registrados
      </div>`;

    const titleEl = list.closest(".detalle-section")?.querySelector(".section-title");
    if (titleEl) titleEl.setAttribute("data-count", "0");
    return;
  }

  // Actualizar contador en el título
  const titleEl = list.closest(".detalle-section")?.querySelector(".section-title");
  if (titleEl) {
    titleEl.classList.add("with-count");
    titleEl.setAttribute("data-count", data.length);
  }

  const ROLE_LABELS = { admin: "Admin", worker: "Worker", viewer: "Viewer", finanzas: "Finanzas" };

  const miEmail = (document.getElementById("user-email")?.textContent || "").trim().toLowerCase();
  const puedeEditar   = can("usuarios.editar");
  const puedeRol      = can("usuarios.permisos");
  const puedeEliminar = can("usuarios.eliminar");

  list.innerHTML = data.map(u => {
    const online = isOnline(u.last_seen);
    const esYo = (u.email || "").trim().toLowerCase() === miEmail;
    const dNombre = puedeEditar ? "" : "disabled";
    const dRol    = (puedeRol && !esYo) ? "" : "disabled";
    const dEstado = (puedeEditar && !esYo) ? "" : "disabled";
    return `
    <details class="user-card">

      <summary class="user-card-header">
        <div class="user-avatar-wrap">
          ${renderAvatar(u.email, u.avatar_url)}
          <span class="user-presence-dot ${online ? 'online' : ''}"
                title="${online ? 'En línea' : 'Desconectado'}"
                aria-label="${online ? 'En línea' : 'Desconectado'}"></span>
        </div>

        <div class="user-info">
          <input
            type="text"
            class="user-nombre-input"
            value="${u.nombre || ""}"
            placeholder="Nombre…"
            ${dNombre}
            onclick="event.stopPropagation()"
            onblur="updateUserNombre('${u.id}', this)"
            onkeydown="if(event.key==='Enter') this.blur()"
          />
          <div class="user-card-footer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
            </svg>
            ${formatLastSeen(u.last_seen)}
          </div>
        </div>

        <svg class="user-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </summary>

      <div class="user-card-body">

        <div class="user-email" title="${u.email}">${u.email}</div>

        <div class="user-controls">

          <div class="user-field-wrap">
            <button type="button" tabindex="-1" class="user-badge badge-role">
              ${ROLE_LABELS[u.role] || u.role}
            </button>
            <select
              onclick="event.stopPropagation()"
              onchange="updateUserRole('${u.id}', this); this.previousElementSibling.textContent = this.options[this.selectedIndex].text;"
              class="user-select-hidden select-role"
              ${dRol}
              aria-label="Rol de ${u.email}">
              <option value="admin"    ${u.role === 'admin'    ? 'selected' : ''}>Admin</option>
              <option value="worker"   ${u.role === 'worker'   ? 'selected' : ''}>Worker</option>
              <option value="viewer"   ${u.role === 'viewer'   ? 'selected' : ''}>Viewer</option>
              <option value="finanzas" ${u.role === 'finanzas' ? 'selected' : ''}>Finanzas</option>
            </select>
          </div>

          <div class="user-field-wrap">
            <button type="button" tabindex="-1" class="user-badge badge-status" data-status="${u.status}">
              ${u.status === 'enabled' ? 'Activo' : 'Inactivo'}
            </button>
            <select
              onclick="event.stopPropagation()"
              onchange="updateUserStatus('${u.id}', this); this.previousElementSibling.textContent = this.options[this.selectedIndex].text; this.previousElementSibling.setAttribute('data-status', this.value);"
              class="user-select-hidden select-status"
              ${dEstado}
              aria-label="Estado de ${u.email}">
              <option value="enabled"  ${u.status === 'enabled'  ? 'selected' : ''}>Activo</option>
              <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Inactivo</option>
            </select>
          </div>

        </div>

        ${_tareasSeccionHtml(u, esYo)}

        ${(puedeEliminar && !esYo) ? `
        <div class="user-danger-zone">
          <button type="button" class="user-btn-eliminar" onclick="event.stopPropagation(); eliminarUsuario('${u.id}')">
            Eliminar usuario
          </button>
        </div>` : ""}

      </div>

    </details>`;
  }).join("");
}


async function createUser() {
  const nombre = document.getElementById("u-nombre").value.trim();
  const email  = document.getElementById("u-email").value.trim();
  const role   = document.getElementById("u-role").value;
  const status = document.getElementById("u-status").value;

  if (!email) {
    document.getElementById("u-email").focus();
    document.getElementById("u-email").classList.add("error");
    setTimeout(() => document.getElementById("u-email").classList.remove("error"), 2000);
    return;
  }

  // Aviso previo para no esperar a la base: sin usuarios.permisos solo se
  // pueden crear viewers (lo exige el trigger de staff, esto es solo UX).
  if (role !== "viewer" && !can("usuarios.permisos")) {
    showToast("Crear un usuario con un rol distinto de Viewer requiere la tarea usuarios.permisos", "error", 4500);
    return;
  }

  const btn = document.querySelector('#view-usuarios .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("staff")
    .insert([{ email, role, status, nombre: nombre || null }]);

  if (btn) { btn.disabled = false; btn.textContent = "Agregar usuario"; }

  if (error) {
    console.error(error);
    showToast(mensajeErrorStaff(error, "agregar"), "error", 4500);
    // El correo solo se marca en rojo si el problema es el correo mismo
    if (error.code === "23505" || error.code === "23514") {
      const emailInput = document.getElementById("u-email");
      emailInput.classList.add("error");
      setTimeout(() => emailInput.classList.remove("error"), 2000);
    }
    return;
  }

  document.getElementById("u-nombre").value = "";
  document.getElementById("u-email").value = "";

  const toggle = document.getElementById("u-add-toggle");
  if (toggle) toggle.open = false;

  showToast("Usuario agregado", "success");
  loadUsers();
}


// ── CAMBIAR ROL ────────────────────────────────────────────────────────────
async function updateUserRole(id, selectEl) {
  const newRole = selectEl.value;
  const { error } = await supabaseClient
    .from("staff")
    .update({ role: newRole })
    .eq("id", id);

  showFeedback(selectEl, error ? "err" : "ok");
  if (error) {
    console.error(error);
    showToast(mensajeErrorStaff(error, "cambiar el rol de"), "error", 4500);
    loadUsers(); // resincroniza el badge que el onchange ya había actualizado
    return;
  }

  // El paquete del rol cambió: recalcular las tareas efectivas del usuario
  const u = _usuariosList.find(x => x.id === id);
  if (u) { u.role = newRole; _refrescarTareasUsuario(u); }
}


// ── CAMBIAR NOMBRE ─────────────────────────────────────────────────────────
async function updateUserNombre(id, inputEl) {
  const nuevoNombre = inputEl.value.trim() || null;
  const anterior = inputEl.defaultValue.trim() || null;
  if (nuevoNombre === anterior) return;

  const { error } = await supabaseClient
    .from("staff")
    .update({ nombre: nuevoNombre })
    .eq("id", id);

  if (!error) inputEl.defaultValue = nuevoNombre || "";
  showFeedback(inputEl, error ? "err" : "ok");
  if (error) {
    console.error(error);
    showToast(mensajeErrorStaff(error, "cambiar el nombre de"), "error", 4500);
  }
}


// ── CAMBIAR ESTADO ─────────────────────────────────────────────────────────
async function updateUserStatus(id, selectEl) {
  const newStatus = selectEl.value;
  // El badge visible es el elemento anterior al select oculto en el DOM
  // (ver estructura .user-field-wrap en loadUsers). El color/etiqueta ya
  // se actualiza vía el atributo onchange inline; acá solo persistimos.
  const badgeEl = selectEl.previousElementSibling;

  const { error } = await supabaseClient
    .from("staff")
    .update({ status: newStatus })
    .eq("id", id);

  showFeedback(selectEl, error ? "err" : "ok");
  if (error) {
    console.error(error);
    showToast(mensajeErrorStaff(error, "cambiar el estado de"), "error", 4500);
    // Revertir color/etiqueta si falla
    const reverted = newStatus === "enabled" ? "disabled" : "enabled";
    selectEl.value = reverted;
    if (badgeEl) {
      badgeEl.setAttribute("data-status", reverted);
      badgeEl.textContent = reverted === "enabled" ? "Activo" : "Inactivo";
    }
  }
}

// ── TAREAS POR USUARIO ─────────────────────────────────────────────────────
// Tarea efectiva = override individual (staff_permisos.concedido) si existe;
// si no, lo que trae el paquete del rol (rol_permisos). Un switch que
// coincide con el paquete del rol borra el override (queda "limpio").
let _usuariosList     = [];  // filas de staff de la última carga
let _catalogoTareas   = [];  // [{ codigo, modulo, descripcion }]
let _tareasPorRol     = {};  // role -> Set(codigo)
let _overridesUsuario = {};  // staffId -> { codigo: boolean }

function _cargarTareasCache(catalogo, rolPerms, staffPerms) {
  _catalogoTareas = catalogo || [];
  _tareasPorRol = {};
  (rolPerms || []).forEach(r => {
    (_tareasPorRol[r.role] = _tareasPorRol[r.role] || new Set()).add(r.permiso);
  });
  _overridesUsuario = {};
  (staffPerms || []).forEach(sp => {
    (_overridesUsuario[sp.staff_id] = _overridesUsuario[sp.staff_id] || {})[sp.permiso] = sp.concedido;
  });
}

function _escU(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function _tareaPorRol(u, codigo) {
  return !!(_tareasPorRol[u.role] && _tareasPorRol[u.role].has(codigo));
}

function _tareaEfectiva(u, codigo) {
  const ov = (_overridesUsuario[u.id] || {})[codigo];
  return ov !== undefined ? ov : _tareaPorRol(u, codigo);
}

function _tareasConteoTexto(u) {
  const activas = _catalogoTareas.filter(t => _tareaEfectiva(u, t.codigo)).length;
  return `${activas} / ${_catalogoTareas.length}`;
}

let _modulosTareasAbiertos = {};  // staffId -> Set(módulos desplegados)

function _recordarModuloTareas(staffId, modulo, abierto) {
  const s = (_modulosTareasAbiertos[staffId] = _modulosTareasAbiertos[staffId] || new Set());
  if (abierto) s.add(modulo); else s.delete(modulo);
}

function _tareasCuerpoHtml(u, esYo) {
  const editable = can("usuarios.permisos") && !esYo;
  const grupos = {};
  _catalogoTareas.forEach(t => { (grupos[t.modulo] = grupos[t.modulo] || []).push(t); });

  const nota = esYo
    ? `<p class="user-tareas-nota">No podés modificar tus propias tareas.</p>`
    : (!editable ? `<p class="user-tareas-nota">Solo lectura: se requiere la tarea usuarios.permisos.</p>` : "");

  // Módulos que estaban abiertos, para no cerrarlos al re-pintar tras un cambio
  const abiertos = _modulosTareasAbiertos[u.id] || new Set();

  const bloques = Object.keys(grupos).sort().map(modulo => {
    let activas = 0;
    const filas = grupos[modulo].map(t => {
      const porRol = _tareaPorRol(u, t.codigo);
      const efectiva = _tareaEfectiva(u, t.codigo);
      if (efectiva) activas++;
      const accion = t.codigo.slice(modulo.length + 1) || t.codigo;
      let chip = "";
      if (efectiva && !porRol) chip = `<span class="user-tarea-chip extra" title="Concedida solo a este usuario">Extra</span>`;
      else if (!efectiva && porRol) chip = `<span class="user-tarea-chip quitada" title="Incluida en el rol, quitada a este usuario">Quitada</span>`;
      return `
        <label class="user-tarea" title="${_escU(t.codigo)}">
          <span class="user-tarea-nombre">${_escU(t.descripcion || accion)}</span>
          ${chip}
          <input type="checkbox" class="user-tarea-switch"
                 ${efectiva ? "checked" : ""} ${editable ? "" : "disabled"}
                 onclick="event.stopPropagation()"
                 onchange="toggleTareaUsuario('${u.id}', '${_escU(t.codigo)}', this)">
        </label>`;
    }).join("");
    return `
      <details class="user-tareas-grupo" ${abiertos.has(modulo) ? "open" : ""}
               ontoggle="_recordarModuloTareas('${u.id}', '${_escU(modulo)}', this.open)">
        <summary onclick="event.stopPropagation()">${_escU(modulo)} <span class="user-tareas-count">${activas}/${grupos[modulo].length}</span></summary>
        ${filas}
      </details>`;
  }).join("");

  return nota + bloques;
}

function _tareasSeccionHtml(u, esYo) {
  if (!_catalogoTareas.length) return "";
  return `
    <details class="user-tareas" id="tareas-${u.id}" data-yo="${esYo ? 1 : 0}">
      <summary class="user-tareas-summary" onclick="event.stopPropagation()">
        Tareas
        <span class="user-tareas-count" id="tareas-count-${u.id}">${_tareasConteoTexto(u)}</span>
      </summary>
      <div class="user-tareas-body" id="tareas-body-${u.id}">${_tareasCuerpoHtml(u, esYo)}</div>
    </details>`;
}

// Re-pinta el cuerpo y el contador sin cerrar el <details> abierto.
function _refrescarTareasUsuario(u) {
  const det = document.getElementById(`tareas-${u.id}`);
  const body = document.getElementById(`tareas-body-${u.id}`);
  const count = document.getElementById(`tareas-count-${u.id}`);
  if (!det || !body) return;
  body.innerHTML = _tareasCuerpoHtml(u, det.dataset.yo === "1");
  if (count) count.textContent = _tareasConteoTexto(u);
}

async function toggleTareaUsuario(staffId, codigo, inputEl) {
  const u = _usuariosList.find(x => x.id === staffId);
  if (!u) return;
  const quiere = inputEl.checked;
  const porRol = _tareaPorRol(u, codigo);
  inputEl.disabled = true;

  let error;
  if (quiere === porRol) {
    // Coincide con el paquete del rol: se elimina la excepción individual
    ({ error } = await supabaseClient
      .from("staff_permisos")
      .delete()
      .eq("staff_id", staffId)
      .eq("permiso", codigo));
  } else {
    ({ error } = await supabaseClient
      .from("staff_permisos")
      .upsert({ staff_id: staffId, permiso: codigo, concedido: quiere }, { onConflict: "staff_id,permiso" }));
  }

  if (error) {
    console.error(error);
    showToast("No se pudo guardar la tarea", "error");
    inputEl.checked = !quiere;
    inputEl.disabled = false;
    return;
  }

  const ov = (_overridesUsuario[staffId] = _overridesUsuario[staffId] || {});
  if (quiere === porRol) delete ov[codigo]; else ov[codigo] = quiere;
  _refrescarTareasUsuario(u);
}

// ── ELIMINAR USUARIO ───────────────────────────────────────────────────────
async function eliminarUsuario(id) {
  if (!can("usuarios.eliminar")) return;
  const u = _usuariosList.find(x => x.id === id);
  if (!u) return;

  const ok = await confirmar({
    titulo: "Eliminar usuario",
    mensaje: `¿Eliminar a "${u.nombre || u.email}"? Perderá el acceso a la app. Si solo querés quitarle el acceso, marcalo como Inactivo.`,
    confirmarTexto: "Eliminar",
    peligro: true,
  });
  if (!ok) return;

  const { data, error } = await supabaseClient
    .from("staff")
    .delete()
    .eq("id", id)
    .select("id");

  if (error) {
    console.error(error);
    showToast(error.message || "No se pudo eliminar el usuario", "error");
    return;
  }
  if (!data || data.length === 0) {
    showToast("No tenés permiso para eliminar este usuario", "error");
    return;
  }
  showToast("Usuario eliminado", "success");
  loadUsers();
}

// ── Tabs de la vista Usuarios (App / Selección de asientos) ────────────────
// Carga perezosa: cada tab sólo pide sus datos a Supabase la primera vez
// que se abre, para no pegarle a ambos backends si el admin sólo usa uno.
const _usuariosTabsLoaded = { app: false, reservas: false };
let _usuariosTabActual = "app";

function switchUsuariosTab(tab, opts = {}) {
  const isApp = tab === "app";
  _usuariosTabActual = tab;

  document.getElementById("tab-panel-app").style.display = isApp ? "" : "none";
  document.getElementById("tab-panel-reservas").style.display = isApp ? "none" : "";

  document.getElementById("tab-btn-app").classList.toggle("active", isApp);
  document.getElementById("tab-btn-reservas").classList.toggle("active", !isApp);
  document.getElementById("tab-btn-app").setAttribute("aria-selected", String(isApp));
  document.getElementById("tab-btn-reservas").setAttribute("aria-selected", String(!isApp));

  if (opts.force || !_usuariosTabsLoaded[tab]) {
    if (isApp) {
      loadUsers();
    } else {
      loadUsersReservas();
    }
    _usuariosTabsLoaded[tab] = true;
  }
}
