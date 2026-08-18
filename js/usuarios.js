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


async function loadUsers() {
  const list = document.getElementById("users-list");
  if (!list) return;

  list.innerHTML = `<div class="list-state">Cargando…</div>`;

  const { data, error } = await supabaseClient
    .from("staff")
    .select("id, email, role, status, nombre, last_seen")
    .order("email");

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

  list.innerHTML = data.map(u => {
    const online = isOnline(u.last_seen);
    return `
    <div class="user-card">

      <div class="user-card-header">
        <div class="user-avatar" aria-hidden="true">${getInitials(u.email)}</div>

        <div class="user-info">
          <input
            type="text"
            class="user-nombre-input"
            value="${u.nombre || ""}"
            placeholder="Nombre…"
            onblur="updateUserNombre('${u.id}', this)"
            onkeydown="if(event.key==='Enter') this.blur()"
          />
          <div class="user-email" title="${u.email}">${u.email}</div>
        </div>

        <span class="user-presence-dot ${online ? 'online' : ''}"
              title="${online ? 'En línea' : 'Desconectado'}"
              aria-label="${online ? 'En línea' : 'Desconectado'}"></span>
      </div>

      <div class="user-controls">

        <div class="user-field-wrap">
          <button type="button" tabindex="-1" class="user-badge badge-role">
            ${ROLE_LABELS[u.role] || u.role}
          </button>
          <select
            onchange="updateUserRole('${u.id}', this); this.previousElementSibling.textContent = this.options[this.selectedIndex].text;"
            class="user-select-hidden select-role"
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
            onchange="updateUserStatus('${u.id}', this); this.previousElementSibling.textContent = this.options[this.selectedIndex].text; this.previousElementSibling.setAttribute('data-status', this.value);"
            class="user-select-hidden select-status"
            aria-label="Estado de ${u.email}">
            <option value="enabled"  ${u.status === 'enabled'  ? 'selected' : ''}>Activo</option>
            <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Inactivo</option>
          </select>
        </div>

      </div>

      <div class="user-card-footer">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
        </svg>
        ${formatLastSeen(u.last_seen)}
      </div>

    </div>`;
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

  const btn = document.querySelector('#view-usuarios .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("staff")
    .insert([{ email, role, status, nombre: nombre || null }]);

  if (btn) { btn.disabled = false; btn.textContent = "Agregar usuario"; }

  if (error) {
    console.error(error);
    const emailInput = document.getElementById("u-email");
    emailInput.classList.add("error");
    setTimeout(() => emailInput.classList.remove("error"), 2000);
    return;
  }

  document.getElementById("u-nombre").value = "";
  document.getElementById("u-email").value = "";
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
  if (error) console.error(error);
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
  if (error) console.error(error);
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
    // Revertir color/etiqueta si falla
    const reverted = newStatus === "enabled" ? "disabled" : "enabled";
    selectEl.value = reverted;
    if (badgeEl) {
      badgeEl.setAttribute("data-status", reverted);
      badgeEl.textContent = reverted === "enabled" ? "Activo" : "Inactivo";
    }
  }
}
