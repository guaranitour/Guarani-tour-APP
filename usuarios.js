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

// Muestra un feedback breve debajo de un select (reemplaza alert)
function showFeedback(selectEl, tipo) {
  // Eliminar feedback anterior si existe
  const prev = selectEl.parentElement.querySelector(".user-feedback");
  if (prev) prev.remove();

  const fb = document.createElement("span");
  fb.className = `user-feedback ${tipo}`;
  fb.textContent = tipo === "ok" ? "✓ Guardado" : "Error al guardar";
  selectEl.parentElement.appendChild(fb);

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
    .select("id, email, role, status, nombre")
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

  const titleEl = list.closest(".detalle-section")?.querySelector(".section-title");
  if (titleEl) {
    titleEl.classList.add("with-count");
    titleEl.setAttribute("data-count", data.length);
  }

  list.innerHTML = data.map(u => `
    <div class="user-card">

      <div class="user-avatar">${u.nombre ? u.nombre.trim().split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase() : getInitials(u.email)}</div>

      <div class="user-info">
        ${u.nombre ? `<div class="user-nombre">${u.nombre}</div>` : ""}
        <div class="user-email" title="${u.email}">${u.email}</div>

        <div class="user-nombre-edit">
          <input
            type="text"
            class="user-nombre-input"
            value="${u.nombre || ""}"
            placeholder="Agregar nombre…"
            onblur="updateUserNombre('${u.id}', this)"
            onkeydown="if(event.key==='Enter') this.blur()"
          />
        </div>

        <div class="user-controls">

          <select
            onchange="updateUserRole('${u.id}', this)"
            class="user-select select-role"
            title="Rol">
            <option value="admin"       ${u.role === 'admin'       ? 'selected' : ''}>Admin</option>
            <option value="worker"      ${u.role === 'worker'      ? 'selected' : ''}>Worker</option>
            <option value="viewer"      ${u.role === 'viewer'      ? 'selected' : ''}>Viewer</option>
            <option value="facturacion" ${u.role === 'facturacion' ? 'selected' : ''}>Facturación</option>
          </select>

          <select
            onchange="updateUserStatus('${u.id}', this)"
            class="user-select select-status"
            data-status="${u.status}"
            title="Estado">
            <option value="enabled"  ${u.status === 'enabled'  ? 'selected' : ''}>Activo</option>
            <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Inactivo</option>
          </select>

        </div>
      </div>

    </div>
  `).join("");
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

  // Si el valor no cambió respecto al placeholder, no hacer nada
  const nombreActual = inputEl.defaultValue.trim() || null;
  if (nuevoNombre === nombreActual) return;

  const { error } = await supabaseClient
    .from("staff")
    .update({ nombre: nuevoNombre })
    .eq("id", id);

  if (!error) {
    inputEl.defaultValue = nuevoNombre || "";
    // Actualizar avatar e indicador de nombre visibles en la card
    const card = inputEl.closest(".user-card");
    if (card) {
      const avatarEl = card.querySelector(".user-avatar");
      const nombreEl = card.querySelector(".user-nombre");
      const emailEl  = card.querySelector(".user-email");
      if (avatarEl) {
        avatarEl.textContent = nuevoNombre
          ? nuevoNombre.split(" ").slice(0,2).map(w=>w[0]).join("").toUpperCase()
          : getInitials(emailEl?.textContent || "");
      }
      if (nuevoNombre) {
        if (nombreEl) nombreEl.textContent = nuevoNombre;
        else {
          const div = document.createElement("div");
          div.className = "user-nombre";
          div.textContent = nuevoNombre;
          emailEl?.insertAdjacentElement("beforebegin", div);
        }
      } else {
        nombreEl?.remove();
      }
    }
  }

  showFeedback(inputEl, error ? "err" : "ok");
  if (error) console.error(error);
}


// ── CAMBIAR ESTADO ─────────────────────────────────────────────────────────
async function updateUserStatus(id, selectEl) {
  const newStatus = selectEl.value;

  // Actualizar color semántico inmediatamente
  selectEl.setAttribute("data-status", newStatus);

  const { error } = await supabaseClient
    .from("staff")
    .update({ status: newStatus })
    .eq("id", id);

  showFeedback(selectEl, error ? "err" : "ok");
  if (error) {
    console.error(error);
    // Revertir color si falla
    selectEl.setAttribute("data-status", newStatus === "enabled" ? "disabled" : "enabled");
  }
}
