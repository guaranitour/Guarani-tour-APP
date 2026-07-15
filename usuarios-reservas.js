/* usuarios-reservas.js — Gestión de accesos de staff para
   Destino Guaraní (selección de asientos), tabla reservas.staff.

   Diferencias clave respecto a usuarios.js (staff de esta APP):
   - Vive en el schema "reservas" del mismo proyecto Supabase.
   - Columnas: user_id (uuid, nullable), email, role, created_at.
     No tiene "nombre" ni "status".
   - Roles: 'staff' | 'admin'.
   - Alta por email: se inserta con user_id = null. Cuando la
     persona inicia sesión con Google en Destino Guaraní por
     primera vez, esa fila "reclama" el user_id automáticamente
     (ver auth.js de Destino Guaraní, _resolveRole).
   - No hay "deshabilitar": para revocar acceso se elimina la fila.

   Requiere un cliente Supabase apuntando al schema "reservas".
   Se usa supabaseReservas (definido más abajo) para no interferir
   con el cliente "supabaseClient" que ya usa el resto de la APP
   contra el schema public. Ambos comparten el mismo proyecto.
*/

// Cliente separado, mismo proyecto, schema "reservas".
// Mismas credenciales que usa Destino Guaraní (ver su supabase-client.js).
// Ojo: usa una storageKey propia para no pisar la sesión de esta APP
// (que vive en el schema public) ni la de Destino Guaraní si se abre
// en el mismo navegador.
//
// IMPORTANTE: "window.supabase" en esta APP ya fue sobreescrito por
// supabaseClient.js con la INSTANCIA del cliente (no la librería).
// Por eso acá usamos window.supabaseJs, que debe ser la librería CDN
// cruda. Si tu supabaseClient.js también pisa window.supabase con la
// instancia, agregá esta línea ANTES en index.html:
//   <script>window.supabaseJs = window.supabase;</script>
// justo después de cargar el <script src="...supabase-js@2">, y antes
// de que supabaseClient.js reasigne window.supabase.
const SUPABASE_URL_RESERVAS = "https://pmxwpmxiemhbeliywhpj.supabase.co";
const SUPABASE_ANON_KEY_RESERVAS = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBteHdwbXhpZW1oYmVsaXl3aHBqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDEwOTQsImV4cCI6MjA5MzU3NzA5NH0.Jhsdv_kh4JbmEh2ZmMvGqPNGjg1dYNXsYBtUyvnshxg";

const supabaseReservas = (window.supabaseJs || window.supabase).createClient(
  SUPABASE_URL_RESERVAS,
  SUPABASE_ANON_KEY_RESERVAS,
  {
    db: { schema: "reservas" },
    auth: { storageKey: "sb-reservas-admin-auth-token" }
  }
);

function getInitialsReservas(email) {
  const local = email.split("@")[0];
  const parts = local.split(/[._-]/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function showFeedbackReservas(el, tipo) {
  const prev = el.parentElement.querySelector(".user-feedback");
  if (prev) prev.remove();

  const fb = document.createElement("span");
  fb.className = `user-feedback ${tipo}`;
  fb.textContent = tipo === "ok" ? "✓ Guardado" : "Error al guardar";
  el.parentElement.appendChild(fb);

  requestAnimationFrame(() => fb.classList.add("show"));
  setTimeout(() => {
    fb.classList.remove("show");
    setTimeout(() => fb.remove(), 300);
  }, 1800);
}

async function loadUsersReservas() {
  const list = document.getElementById("users-reservas-list");
  if (!list) return;

  list.innerHTML = `<div class="list-state">Cargando…</div>`;

  const { data, error } = await supabaseReservas
    .from("staff")
    .select("user_id, email, role, created_at")
    .order("created_at", { ascending: false });

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
      <div class="user-info">
        <div class="user-email" title="${u.email}">
          ${u.email}
          ${u.user_id
            ? '<span class="user-status-dot" title="Ya inició sesión" style="color:#2e9c5c">●</span>'
            : '<span class="user-status-dot" title="Pendiente: aún no inició sesión" style="color:#c9a227">●</span>'
          }
        </div>
        <div class="user-controls">
          <select
            onchange="updateUserRoleReservas('${u.email}', this)"
            class="user-select select-role"
            title="Rol">
            <option value="staff" ${u.role === 'staff' ? 'selected' : ''}>Staff</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>

          <button
            class="btn-icon-danger"
            title="Quitar acceso"
            onclick="deleteUserReservas('${u.email}', this)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `).join("");
}

async function createUserReservas() {
  const email = document.getElementById("ur-email").value.trim().toLowerCase();
  const role  = document.getElementById("ur-role").value;

  const emailInput = document.getElementById("ur-email");

  if (!email) {
    emailInput.focus();
    emailInput.classList.add("error");
    setTimeout(() => emailInput.classList.remove("error"), 2000);
    return;
  }

  const btn = document.querySelector('#view-usuarios-reservas .btn-save');
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseReservas
    .from("staff")
    .insert([{ email, role }]);

  if (btn) { btn.disabled = false; btn.textContent = "Dar acceso"; }

  if (error) {
    console.error(error);
    emailInput.classList.add("error");
    setTimeout(() => emailInput.classList.remove("error"), 2000);
    // Duplicado (email ya existe): mensaje más claro.
    if (error.code === "23505") {
      showToast?.("Ese correo ya tiene acceso asignado.");
    }
    return;
  }

  document.getElementById("ur-email").value = "";
  loadUsersReservas();
}

async function updateUserRoleReservas(email, selectEl) {
  const newRole = selectEl.value;
  const { error } = await supabaseReservas
    .from("staff")
    .update({ role: newRole })
    .eq("email", email);

  showFeedbackReservas(selectEl, error ? "err" : "ok");
  if (error) console.error(error);
}

async function deleteUserReservas(email, btnEl) {
  if (!confirm(`¿Quitar el acceso de ${email} a Destino Guaraní?`)) return;

  btnEl.disabled = true;

  const { error } = await supabaseReservas
    .from("staff")
    .delete()
    .eq("email", email);

  if (error) {
    console.error(error);
    btnEl.disabled = false;
    showFeedbackReservas(btnEl, "err");
    return;
  }

  loadUsersReservas();
}
