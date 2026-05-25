// ── Estado global ──────────────────────────────────────────
let allPassengers  = [];
let avatarCache    = {};
let currentView    = "home"; // "home" | "clientes" | "detalle"
let selectedIdx    = null;

// ── Auth ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  session?.user ? enterApp(session.user) : showLogin();

  supabaseClient.auth.onAuthStateChange((_e, session) => {
    session?.user ? enterApp(session.user) : showLogin();
  });
});

function showLogin() {
  show("login-view");
  hide("app-view");
}

async function enterApp(user) {
  hide("login-view");
  show("app-view");
  document.getElementById("user-email").textContent = user.email;
  navigateTo("home");
}

// ── Navegación ─────────────────────────────────────────────
function navigateTo(view, idx = null) {
  currentView  = view;
  selectedIdx  = idx;

  hide("view-home");
  hide("view-clientes");
  hide("view-detalle");

  if (view === "home") {
    show("view-home");
    updateBreadcrumb([{ label: "Inicio" }]);
  } else if (view === "clientes") {
    show("view-clientes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes" }
    ]);
    if (allPassengers.length === 0) loadPassengers();
    else renderList(allPassengers);
  } else if (view === "detalle") {
    show("view-detalle");
    renderDetalle(idx);
    const p = allPassengers.find(x => x._idx === idx);
    updateBreadcrumb([
      { label: "Inicio",           action: () => navigateTo("home") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: p?.Pasajero || "Detalle" }
    ]);
  }
}

function updateBreadcrumb(items) {
  const el = document.getElementById("breadcrumb");
  el.innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) return `<span class="bc-current">${item.label}</span>`;
    return `<span class="bc-link" onclick="(${item.action})()">${item.label}</span>
            <span class="bc-sep">›</span>`;
  }).join("");
}

// ── Carga de pasajeros ─────────────────────────────────────
async function loadPassengers() {
  setListState("loading");

  const { data, error } = await supabaseClient
    .from("Pasajeros")
    .select(`Pasajero, "Documento de Identidad", Vendedor, "Fecha de nacimiento", Sexo, "E-mail", ByC, "Club destino"`)
    .order("Pasajero", { ascending: true });

  if (error) {
    console.error(error);
    setListState("error");
    return;
  }

  allPassengers = data.map((p, i) => ({ ...p, _idx: i }));
  renderList(allPassengers);
}

// ── Render lista (sin parpadeo) ────────────────────────────
function renderList(passengers) {
  const listEl  = document.getElementById("passenger-list");
  const countEl = document.getElementById("passenger-count");
  countEl.textContent = `${passengers.length} pasajero${passengers.length !== 1 ? "s" : ""}`;

  if (passengers.length === 0) {
    setListState("empty");
    return;
  }

  // Construir mapa de filas existentes por _idx para reutilizarlas
  const existing = {};
  listEl.querySelectorAll(".passenger-row[data-idx]").forEach(el => {
    existing[el.dataset.idx] = el;
  });

  // Construir nuevo orden sin re-crear nodos que ya existen
  const fragment = document.createDocumentFragment();
  passengers.forEach((p, i) => {
    let row = existing[p._idx];
    if (!row) {
      row = createRow(p, i);
    }
    fragment.appendChild(row);
  });

  // Ocultar estado vacío/error si estaba visible
  const stateEl = listEl.querySelector(".list-state");
  if (stateEl) stateEl.remove();

  // Reemplazar contenido solo con los nodos necesarios
  listEl.replaceChildren(fragment);
}

function createRow(p, i) {
  const name     = p.Pasajero || "Sin nombre";
  const ci       = p["Documento de Identidad"] || "—";
  const initials = getInitials(name);

  const row = document.createElement("div");
  row.className = "passenger-row";
  row.dataset.idx = p._idx;
  row.style.animationDelay = `${i * 0.025}s`;
  row.onclick = () => navigateTo("detalle", p._idx);

  const avatarInner = avatarCache[p._idx]
    ? `<img src="${avatarCache[p._idx]}" alt="${name}" />`
    : `<span>${initials}</span>`;

  row.innerHTML = `
    <div class="p-avatar">${avatarInner}</div>
    <div class="p-info">
      <div class="p-name">${name}</div>
      <div class="p-sub">${p["E-mail"] || "Sin email"}</div>
    </div>
    <span class="p-pill">CI ${ci}</span>
    <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>`;
  return row;
}

function setListState(type) {
  const listEl = document.getElementById("passenger-list");
  const states = {
    loading: `<div class="list-state"><div class="icon">⏳</div>Cargando pasajeros…</div>`,
    error:   `<div class="list-state"><div class="icon">⚠️</div>Error al cargar los datos.</div>`,
    empty:   `<div class="list-state"><div class="icon">🔍</div>Sin resultados.</div>`,
  };
  listEl.innerHTML = states[type] || "";
}

// ── Buscador (debounce para evitar parpadeo) ───────────────
let searchTimer = null;
function filterPassengers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = document.getElementById("search-input").value.toLowerCase().trim();
    const filtered = q
      ? allPassengers.filter(p =>
          (p.Pasajero || "").toLowerCase().includes(q) ||
          (p["Documento de Identidad"] || "").toLowerCase().includes(q) ||
          (p["E-mail"] || "").toLowerCase().includes(q))
      : allPassengers;
    renderList(filtered);
  }, 160);
}

// ── Vista detalle (página completa) ───────────────────────
function renderDetalle(idx) {
  const p    = allPassengers.find(x => x._idx === idx);
  if (!p) return;
  const name = p.Pasajero || "Sin nombre";

  // Avatar
  const avatarEl = document.getElementById("detalle-avatar");
  avatarEl.dataset.idx = idx;
  const imgEl = avatarEl.querySelector("img");
  const initEl = avatarEl.querySelector(".d-initials");
  if (avatarCache[idx]) {
    imgEl.src = avatarCache[idx];
    imgEl.classList.remove("hidden");
    initEl.classList.add("hidden");
  } else {
    imgEl.classList.add("hidden");
    initEl.classList.remove("hidden");
    initEl.textContent = getInitials(name);
  }

  document.getElementById("detalle-name").textContent = name;

  // Chips
  const chips = [];
  if (p.ByC)             chips.push(`<span class="chip chip-byc">${p.ByC}</span>`);
  if (p["Club destino"]) chips.push(`<span class="chip chip-club">${p["Club destino"]}</span>`);
  if (p.Sexo)            chips.push(`<span class="chip chip-sexo">${p.Sexo}</span>`);
  document.getElementById("detalle-chips").innerHTML = chips.join("");

  // Campos
  setField("d-ci",       p["Documento de Identidad"]);
  setField("d-fecha",    formatDate(p["Fecha de nacimiento"]));
  setField("d-sexo",     p.Sexo);
  setField("d-vendedor", p.Vendedor);
  setField("d-email",    p["E-mail"]);
  setField("d-byc",      p.ByC);
  setField("d-club",     p["Club destino"]);
}

// ── Avatar upload ──────────────────────────────────────────
function triggerAvatarUpload() {
  document.getElementById("avatar-file-input").click();
}

function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const idx = parseInt(document.getElementById("detalle-avatar").dataset.idx);
  const reader = new FileReader();
  reader.onload = e => {
    avatarCache[idx] = e.target.result;
    renderDetalle(idx);
    // Actualizar lista sin re-renderizar todo
    const row = document.querySelector(`.passenger-row[data-idx="${idx}"]`);
    if (row) {
      const avatarDiv = row.querySelector(".p-avatar");
      avatarDiv.innerHTML = `<img src="${avatarCache[idx]}" alt="" />`;
    }
  };
  reader.readAsDataURL(file);
  event.target.value = "";
}

// ── Helpers ────────────────────────────────────────────────
function getInitials(name) {
  return name.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
}

function formatDate(val) {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString("es-PY", { day: "2-digit", month: "long", year: "numeric" });
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value) {
    el.textContent = value;
    el.classList.remove("empty");
  } else {
    el.textContent = "No registrado";
    el.classList.add("empty");
  }
}

function show(id) { document.getElementById(id)?.classList.remove("hidden"); }
function hide(id) { document.getElementById(id)?.classList.add("hidden"); }
