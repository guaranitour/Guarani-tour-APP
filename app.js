// ── Estado global ──────────────────────────────────────────
let allPassengers = [];
let avatarCache   = {};  // { id: dataURL }

// ── Auth ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    enterApp(session.user);
  } else {
    showLogin();
  }

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) enterApp(session.user);
    else showLogin();
  });
});

function showLogin() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("app-view").classList.add("hidden");
}

async function enterApp(user) {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email;
  await loadPassengers();
}

// ── Carga de pasajeros ─────────────────────────────────────
async function loadPassengers() {
  const listEl = document.getElementById("passenger-list");
  listEl.innerHTML = `<div class="list-state"><div class="icon">⏳</div>Cargando pasajeros…</div>`;

  const { data, error } = await supabaseClient
    .from("Pasajeros")
    .select(`Pasajero, "Documento de Identidad", Vendedor, "Fecha de nacimiento", Sexo, "E-mail", ByC, "Club destino"`)
    .order("Pasajero", { ascending: true });

  if (error) {
    console.error(error);
    listEl.innerHTML = `<div class="list-state"><div class="icon">⚠️</div>Error al cargar los datos.</div>`;
    return;
  }

  // Guardar una copia con id interno para el modal
  allPassengers = data.map((p, i) => ({ ...p, _idx: i }));
  renderList(allPassengers);
}

// ── Render lista ───────────────────────────────────────────
function renderList(passengers) {
  const listEl  = document.getElementById("passenger-list");
  const countEl = document.getElementById("passenger-count");
  countEl.textContent = `${passengers.length} pasajero${passengers.length !== 1 ? "s" : ""}`;

  if (passengers.length === 0) {
    listEl.innerHTML = `<div class="list-state"><div class="icon">🔍</div>Sin resultados para esa búsqueda.</div>`;
    return;
  }

  listEl.innerHTML = passengers.map((p, i) => {
    const name    = p.Pasajero || "Sin nombre";
    const ci      = p["Documento de Identidad"] || "—";
    const initials = getInitials(name);
    const avatarHTML = avatarCache[p._idx]
      ? `<img src="${avatarCache[p._idx]}" alt="${name}" />`
      : initials;

    return `
      <div class="passenger-row" style="animation-delay:${i * 0.03}s"
           onclick="openModal(${p._idx})">
        <div class="p-avatar">${avatarHTML}</div>
        <div class="p-info">
          <div class="p-name">${name}</div>
          <div class="p-sub">${p["E-mail"] || "Sin email"}</div>
        </div>
        <span class="p-pill">CI ${ci}</span>
        <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </div>`;
  }).join("");
}

// ── Buscador ───────────────────────────────────────────────
function filterPassengers() {
  const q = document.getElementById("search-input").value.toLowerCase().trim();
  if (!q) { renderList(allPassengers); return; }

  const filtered = allPassengers.filter(p =>
    (p.Pasajero || "").toLowerCase().includes(q) ||
    (p["Documento de Identidad"] || "").toLowerCase().includes(q) ||
    (p["E-mail"] || "").toLowerCase().includes(q)
  );
  renderList(filtered);
}

// ── Modal detalle ──────────────────────────────────────────
function openModal(idx) {
  const p = allPassengers.find(x => x._idx === idx);
  if (!p) return;

  const name = p.Pasajero || "Sin nombre";

  // Avatar
  const avatarEl = document.getElementById("modal-avatar");
  const initialsEl = document.getElementById("modal-initials");
  if (avatarCache[idx]) {
    initialsEl.textContent = "";
    // Limpiar img anterior si existe
    const old = avatarEl.querySelector("img");
    if (old) old.remove();
    const img = document.createElement("img");
    img.src = avatarCache[idx];
    avatarEl.insertBefore(img, initialsEl);
  } else {
    const old = avatarEl.querySelector("img");
    if (old) old.remove();
    initialsEl.textContent = getInitials(name);
  }
  avatarEl.dataset.idx = idx;

  // Nombre
  document.getElementById("modal-name").textContent = name;

  // Chips
  const chips = [];
  if (p.ByC)             chips.push(`<span class="chip chip-byc">${p.ByC}</span>`);
  if (p["Club destino"]) chips.push(`<span class="chip chip-club">${p["Club destino"]}</span>`);
  if (p.Sexo)            chips.push(`<span class="chip chip-sexo">${p.Sexo}</span>`);
  document.getElementById("modal-chips").innerHTML = chips.join("");

  // Campos
  setField("d-ci",       p["Documento de Identidad"]);
  setField("d-fecha",    formatDate(p["Fecha de nacimiento"]));
  setField("d-sexo",     p.Sexo);
  setField("d-vendedor", p.Vendedor);
  setField("d-email",    p["E-mail"]);
  setField("d-byc",      p.ByC);
  setField("d-club",     p["Club destino"]);

  document.getElementById("detail-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  const overlay = document.getElementById("detail-modal");
  overlay.classList.add("closing");
  setTimeout(() => {
    overlay.classList.add("hidden");
    overlay.classList.remove("closing");
    document.body.style.overflow = "";
  }, 180);
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById("detail-modal")) closeModal();
}

// Cerrar con Escape
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

// ── Avatar upload (local, solo en sesión) ──────────────────
function triggerAvatarUpload() {
  document.getElementById("avatar-file-input").click();
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const idx = parseInt(document.getElementById("modal-avatar").dataset.idx);
  const reader = new FileReader();
  reader.onload = e => {
    const dataURL = e.target.result;
    avatarCache[idx] = dataURL;
    // Actualizar avatar en modal
    const avatarEl     = document.getElementById("modal-avatar");
    const initialsEl   = document.getElementById("modal-initials");
    const old = avatarEl.querySelector("img");
    if (old) old.remove();
    initialsEl.textContent = "";
    const img = document.createElement("img");
    img.src = dataURL;
    avatarEl.insertBefore(img, initialsEl);
    // Re-render lista para reflejar la foto
    filterPassengers();
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

// ── Helpers ────────────────────────────────────────────────
function getInitials(name) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function formatDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" });
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (value) {
    el.textContent = value;
    el.classList.remove("empty");
  } else {
    el.textContent = "No registrado";
    el.classList.add("empty");
  }
}
