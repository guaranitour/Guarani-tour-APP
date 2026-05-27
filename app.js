// ── Estado global ──────────────────────────────────────────
let allPassengers = [];
let avatarCache = {};
let currentView = "home";
let selectedIdx = null;

// ── Visibilidad ────────────────────────────────────────────
function showEl(id)  { document.getElementById(id).style.display = ""; }
function hideEl(id)  { document.getElementById(id).style.display = "none"; }

function showLogin() {
  showEl("login-view");
  hideEl("app-view");
}

async function enterApp(user) {
  hideEl("login-view");
  showEl("app-view");
  document.getElementById("user-email").textContent = user.email;
  const menuEmail = document.getElementById("menu-user-email");
  if (menuEmail) menuEmail.textContent = user.email;
  navigateTo("home");
}

// ── Auth ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  hideEl("login-view");
  hideEl("app-view");

  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session?.user) enterApp(session.user);
    else showLogin();
  });

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (session?.user) enterApp(session.user);
    else showLogin();
  });
});

// ── Navegación ─────────────────────────────────────────────
function navigateTo(view, idx = null) {
  currentView = view;
  selectedIdx = idx;

  hideEl("view-home");
  hideEl("view-clientes");
  hideEl("view-detalle");

  if (view === "home") {
    showEl("view-home");
    updateBreadcrumb([{ label: "Inicio" }]);

  } else if (view === "clientes") {
    showEl("view-clientes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes" }
    ]);
    if (allPassengers.length === 0) loadPassengers();
    else renderList(allPassengers);

  } else if (view === "detalle") {
    showEl("view-detalle");
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
  document.getElementById("breadcrumb").innerHTML = items.map((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) return `<span class="bc-current">${item.label}</span>`;
    return `<span class="bc-link" onclick="(${item.action})()">${item.label}</span><span class="bc-sep">›</span>`;
  }).join("");
}

// ── Carga ──────────────────────────────────────────────────
async function loadPassengers() {
  setListState("loading");
  const { data, error } = await supabaseClient
    .from("Pasajeros")
    .select(`Pasajero, "Documento de Identidad", Vendedor, "Fecha de nacimiento", Sexo, "E-mail", ByC, "Club destino"`)
    .order("Pasajero", { ascending: true });

  if (error) { console.error(error); setListState("error"); return; }
  allPassengers = data.map((p, i) => ({ ...p, _idx: i }));
  renderList(allPassengers);
}

// ── Render lista ───────────────────────────────────────────
function renderList(passengers) {
  const listEl  = document.getElementById("passenger-list");
  const countEl = document.getElementById("passenger-count");
  countEl.textContent = `${passengers.length} pasajero${passengers.length !== 1 ? "s" : ""}`;

  if (passengers.length === 0) { setListState("empty"); return; }

  const existing = {};
  listEl.querySelectorAll(".passenger-row[data-idx]").forEach(el => {
    existing[el.dataset.idx] = el;
  });

  const fragment = document.createDocumentFragment();
  passengers.forEach((p, i) => {
    let row = existing[p._idx];
    if (!row) row = createRow(p, i);
    fragment.appendChild(row);
  });

  const stateEl = listEl.querySelector(".list-state");
  if (stateEl) stateEl.remove();
  listEl.replaceChildren(fragment);
}

function createRow(p, i) {
  const name = p.Pasajero || "Sin nombre";
  const ci   = p["Documento de Identidad"] || "—";
  const row  = document.createElement("div");
  row.className = "passenger-row";
  row.dataset.idx = p._idx;
  row.style.animationDelay = `${i * 0.025}s`;
  row.onclick = () => navigateTo("detalle", p._idx);

  const avatarInner = avatarCache[p._idx]
    ? `<img src="${avatarCache[p._idx]}" alt="${name}" />`
    : `<span>${getInitials(name)}</span>`;

  row.innerHTML = `
    <div class="p-avatar">${avatarInner}</div>
    <div class="p-name">${name}</div>
    <span class="p-pill">CI ${ci}</span>
    <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>`;
  return row;
}

function setListState(type) {
  const states = {
    loading: `<div class="list-state"><div class="icon">⏳</div>Cargando pasajeros…</div>`,
    error:   `<div class="list-state"><div class="icon">⚠️</div>Error al cargar los datos.</div>`,
    empty:   `<div class="list-state"><div class="icon">🔍</div>Sin resultados.</div>`,
  };
  document.getElementById("passenger-list").innerHTML = states[type] || "";
}

// ── Buscador ───────────────────────────────────────────────
let searchTimer = null;
function filterPassengers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = document.getElementById("search-input").value.toLowerCase().trim();
    renderList(q
      ? allPassengers.filter(p =>
          (p.Pasajero || "").toLowerCase().includes(q) ||
          (p["Documento de Identidad"] || "").toLowerCase().includes(q) ||
          (p["E-mail"] || "").toLowerCase().includes(q))
      : allPassengers);
  }, 160);
}

// ── Detalle ────────────────────────────────────────────────
function renderDetalle(idx) {
  const p = allPassengers.find(x => x._idx === idx);
  if (!p) return;
  const name = p.Pasajero || "Sin nombre";

  const avatarEl = document.getElementById("detalle-avatar");
  const wrapEl   = avatarEl.closest(".detalle-avatar-wrap") || avatarEl.parentElement;
  const imgEl    = avatarEl.querySelector("img");
  const initEl   = avatarEl.querySelector(".d-initials");
  wrapEl.dataset.idx   = idx;
  avatarEl.dataset.idx = idx;

  if (avatarCache[idx]) {
    imgEl.src = avatarCache[idx];
    imgEl.style.display = "block";
    initEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    initEl.style.display = "block";
    initEl.textContent = getInitials(name);
  }

  document.getElementById("detalle-name").textContent = name;
  setField("d-nombre-full", p.Pasajero);
  setField("d-ci",          p["Documento de Identidad"]);
  setField("d-fecha",       formatDate(p["Fecha de nacimiento"]));
  setField("d-sexo",        p.Sexo);
  setField("d-email",       p["E-mail"]);
  setField("d-vendedor",    p.Vendedor);
  setField("d-byc",         p.ByC);
  setField("d-club",        p["Club destino"]);
}

// ── Avatar ─────────────────────────────────────────────────
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
    const row = document.querySelector(`.passenger-row[data-idx="${idx}"]`);
    if (row) row.querySelector(".p-avatar").innerHTML = `<img src="${avatarCache[idx]}" alt="" />`;
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
  if (value) { el.textContent = value; el.classList.remove("empty"); }
  else       { el.textContent = "No registrado"; el.classList.add("empty"); }
}

// ── Menú hamburguesa ───────────────────────────────────────
function toggleMenu() {
  document.getElementById("hamburger-menu").classList.toggle("open");
}

function closeMenu() {
  document.getElementById("hamburger-menu").classList.remove("open");
}

// Cerrar al hacer click fuera
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("hamburger-wrap") || e.target.closest(".hamburger-wrap");
  if (!e.target.closest(".hamburger-wrap")) closeMenu();
});
