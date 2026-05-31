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

let currentUserRole = null;

async function enterApp(user) {
  // Verificar si el usuario está en la tabla staff y habilitado
  const { data, error } = await supabaseClient
    .from("staff")
    .select("role, status")
    .eq("email", user.email)
    .single();

  if (error || !data || data.status !== "enabled") {
    // No está en staff o está deshabilitado
    await supabaseClient.auth.signOut();
    showLogin();
    showAccessDenied(error || data?.status === "disabled");
    return;
  }

  currentUserRole = data.role;

  hideEl("login-view");
  showEl("app-view");
  document.getElementById("user-email").textContent = user.email;
  // 👇 MOSTRAR TARJETA USUARIOS SI ES ADMIN
if (data.role === "admin") {
  setTimeout(() => {
    const card = document.getElementById("card-usuarios");
    if (card) card.style.display = "flex";
  }, 50);
}
  const menuEmail = document.getElementById("menu-user-email");
  if (menuEmail) menuEmail.textContent = user.email;
  navigateTo("home");
}

function showAccessDenied(isDisabled) {
  const card = document.querySelector(".login-card");
  const existing = document.getElementById("access-denied-msg");
  if (existing) existing.remove();

  const msg = document.createElement("div");
  msg.id = "access-denied-msg";
  msg.style.cssText = "margin-top:1rem; padding:.75rem 1rem; background:#fff0f0; border:1px solid rgba(192,57,43,.2); border-radius:10px; font-size:.85rem; color:#c0392b; text-align:center;";
  msg.textContent = isDisabled
    ? "Tu acceso está deshabilitado. Contactá al administrador."
    : "Tu cuenta no tiene acceso a este portal.";
  card.appendChild(msg);
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
  hideEl("view-nuevo");

  if (view === "home") {
    showEl("view-home");
    // 👇 MOSTRAR TARJETA USUARIOS SI ES ADMIN
if (currentUserRole === "admin") {
  const card = document.getElementById("card-usuarios");
  if (card) card.style.display = "flex";
}
    updateBreadcrumb([{ label: "Inicio" }]);

  } else if (view === "clientes") {
    showEl("view-clientes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes" }
    ]);
    if (allPassengers.length === 0) loadPassengers();
    else renderList(allPassengers);

  } else if (view === "nuevo") {
    showEl("view-nuevo");
    limpiarFormulario();
    updateBreadcrumb([
      { label: "Inicio",           action: () => navigateTo("home") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: "Nuevo cliente" }
    ]);
    setTimeout(() => document.getElementById("f-nombre")?.focus(), 100);

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

// ── Formulario nuevo cliente ───────────────────────────────
function limpiarFormulario() {
  ["f-nombre","f-ci","f-sexo","f-email","f-fecha","f-vendedor","f-byc","f-club"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = "";
    el.classList.remove("error");
  });
  const errEl = document.getElementById("form-error");
  if (errEl) errEl.textContent = "";
  const btn = document.getElementById("btn-guardar");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cliente`;
  }
}

async function guardarNuevoCliente() {
  ["f-nombre","f-ci","f-sexo"].forEach(id =>
    document.getElementById(id)?.classList.remove("error"));
  const errEl = document.getElementById("form-error");
  if (errEl) errEl.textContent = "";

  const nombre = document.getElementById("f-nombre").value.trim();
  const ci     = document.getElementById("f-ci").value.trim();
  const sexo   = document.getElementById("f-sexo").value;

  let valid = true;
  if (!nombre) { document.getElementById("f-nombre").classList.add("error"); valid = false; }
  if (!ci)     { document.getElementById("f-ci").classList.add("error");     valid = false; }
  if (!sexo)   { document.getElementById("f-sexo").classList.add("error");   valid = false; }

  if (!valid) {
    if (errEl) errEl.textContent = "Completá los campos obligatorios.";
    return;
  }

  const nuevo = {
    "Pasajero":               nombre,
    "Documento de Identidad": ci,
    "Sexo":                   sexo,
    "E-mail":                 document.getElementById("f-email").value.trim() || null,
    "Fecha de nacimiento":    document.getElementById("f-fecha").value || null,
    "Vendedor":               document.getElementById("f-vendedor").value.trim() || null,
    "ByC":                    document.getElementById("f-byc").value.trim() || null,
    "Club destino":           document.getElementById("f-club").value.trim() || null,
  };

  const btn = document.getElementById("btn-guardar");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { data, error } = await supabaseClient
    .from("Pasajeros")
    .insert([nuevo])
    .select();

  if (error) {
    if (errEl) errEl.textContent = error.code === "23505"
      ? "Ya existe un cliente con ese CI."
      : "Error al guardar. Intentá de nuevo.";
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cliente`;
    }
    return;
  }

  // Agregar a memoria y volver a la lista
  const newIdx = allPassengers.length;
  allPassengers.push({ ...data[0], _idx: newIdx });
  allPassengers.sort((a, b) => (a.Pasajero || "").localeCompare(b.Pasajero || ""));
  allPassengers.forEach((p, i) => p._idx = i);

  navigateTo("clientes");
}
