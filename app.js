// ── Estado global ──────────────────────────────────────────
let allPassengers = [];
let avatarCache = {};
let currentView = "home";
let selectedIdx = null;
let appReady = false;
let _vendedoresCache = [];

// ── Visibilidad ────────────────────────────────────────────
function showEl(id)  { document.getElementById(id).style.display = ""; }
function hideEl(id)  { document.getElementById(id).style.display = "none"; }

function showLogin() {
  appReady = false;
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
 // 👇 OCULTAR USUARIOS SI NO ES ADMIN
const card = document.getElementById("card-usuarios");
if (card) card.style.display = data.role === "admin" ? "" : "none";
  const menuEmail = document.getElementById("menu-user-email");
  if (menuEmail) menuEmail.textContent = user.email;
  if (!appReady) {
    appReady = true;
    // Si hay un hash en la URL al cargar, intentar restaurar esa vista
    const { view: hashView, idx: hashIdx } = _parseHash(location.hash);
    const restorableViews = [
      "home","clientes","nuevo","usuarios","viajes","viaje-nuevo",
      "detalle","historial-viajes","viaje-detalle","viaje-pasajero-nuevo","historico"
    ];
    if (hashView && hashView !== "home" && restorableViews.includes(hashView)) {
      navigateTo(hashView, hashIdx);
    } else {
      navigateTo("home");
    }
  }
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

// ── Navegación por hash ────────────────────────────────────
// Vistas simples (sin idx o idx numérico): hash = #vista o #vista/idx
// Vistas con idx objeto: hash = #vista (el contexto vive en memoria)
const _hashSimpleViews = ["home","clientes","nuevo","usuarios","viajes","viaje-nuevo","historico"];
const _hashNumericViews = ["detalle","historial-viajes","viaje-detalle","viaje-pasajero-nuevo","viaje-editar"];

function _buildHash(view, idx) {
  if (_hashNumericViews.includes(view) && idx !== null && typeof idx === "number") {
    return `#${view}/${idx}`;
  }
  return `#${view}`;
}

function _setHash(view, idx) {
  const hash = _buildHash(view, idx);
  if (location.hash !== hash) {
    history.pushState(null, "", hash);
  }
}

function _parseHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  if (!raw) return { view: "home", idx: null };
  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) return { view: raw, idx: null };
  const view = raw.slice(0, slashIdx);
  const idxStr = raw.slice(slashIdx + 1);
  const idx = isNaN(idxStr) ? idxStr : parseInt(idxStr, 10);
  return { view, idx };
}

window.addEventListener("popstate", () => {
  if (!appReady) return;
  const { view, idx } = _parseHash(location.hash);
  // Vistas con idx objeto no se pueden restaurar desde hash → ir al padre
  const objectIdxViews = ["viaje-pasajero-pagos","egreso-detalle"];
  if (objectIdxViews.includes(view)) {
    navigateTo("viajes");
    return;
  }
  if (view === "pago-detalle") {
    if (pagosCtx?.viajePasajeroId) {
      navigateTo("viaje-pasajero-pagos", {
        viajePasajeroId : pagosCtx.viajePasajeroId,
        viajeId         : pagosCtx.viajeId,
        pasajeroId      : pagosCtx.pasajeroId,
        nombrePasajero  : pagosCtx.nombrePasajero,
      });
    } else {
      navigateTo("viajes");
    }
    return;
  }
  navigateTo(view, idx, true); // true = viniendo del hash, no volver a setear
});

// ── Navegación ─────────────────────────────────────────────
function navigateTo(view, idx = null, _fromHash = false) {

  currentView = view;
  selectedIdx = idx;

  // Actualizar hash (salvo que ya venga del popstate)
  if (!_fromHash) _setHash(view, idx);

  // Ocultar todas las vistas
  hideEl("view-home");
  hideEl("view-clientes");
  hideEl("view-detalle");
  hideEl("view-nuevo");
  hideEl("view-usuarios");
  hideEl("view-viajes");
  const _hvp = document.getElementById("view-historial-viajes");
  if (_hvp) _hvp.style.display = "none";
  const _vpn = document.getElementById("view-viaje-pasajero-nuevo");
  if (_vpn) _vpn.style.display = "none";
  const _vvn = document.getElementById("view-viaje-nuevo");
  if (_vvn) _vvn.style.display = "none";
  const _vvd = document.getElementById("view-viaje-detalle");
  if (_vvd) _vvd.style.display = "none";
  const _vhi = document.getElementById("view-historico");
  if (_vhi) _vhi.style.display = "none";
  const _vpp = document.getElementById("view-viaje-pasajero-pagos");
  if (_vpp) _vpp.style.display = "none";
  const _vpd = document.getElementById("view-pago-detalle");
  if (_vpd) _vpd.style.display = "none";
  const _ved = document.getElementById("view-egreso-detalle");
  if (_ved) _ved.style.display = "none";
  const _vve = document.getElementById("view-viaje-editar");
  if (_vve) _vve.style.display = "none";
  const _fotoWrap = document.getElementById("pd-foto-wrap");
  if (_fotoWrap) _fotoWrap.style.display = "none";

  const fab = document.getElementById("fab-nuevo");
  if (fab) {
    fab.style.display = (view === "clientes" && ["admin", "worker"].includes(currentUserRole)) ? "" : "none";
  }

  const fabViaje = document.getElementById("fab-viaje-nuevo");
  if (fabViaje) {
    fabViaje.style.display = (view === "viajes" && currentUserRole === "admin") ? "" : "none";
  }

  if (view === "home") {

    showEl("view-home");
    updateBreadcrumb([{ label: "Inicio" }]);

  }

  else if (view === "clientes") {

    showEl("view-clientes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes" }
    ]);
    if (allPassengers.length === 0) loadPassengers();
    else renderList(allPassengers);

  }

  else if (view === "nuevo") {

    showEl("view-nuevo");
    limpiarFormulario();
    cargarVendedores("f-vendedor");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: "Nuevo cliente" }
    ]);

  }

  else if (view === "detalle") {

    showEl("view-detalle");
    renderDetalle(idx);
    const p = allPassengers.find(x => x._idx === idx);
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: p?.Pasajero || "Detalle" }
    ]);

  }

  // ESTE ES EL BLOQUE CLAVE
  else if (view === "usuarios") {

    if (currentUserRole !== "admin") return;
    showEl("view-usuarios");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Usuarios" }
    ]);
    loadUsers();

  }

  else if (view === "viajes") {

    showEl("view-viajes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Viajes activos" }
    ]);
    loadViajes("activos");

  }

  else if (view === "historico") {

    showEl("view-historico");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Histórico de viajes" }
    ]);
    const _hs = document.getElementById("historico-search");
    if (_hs) _hs.value = "";
    loadViajes("historico");

  }

  else if (view === "historial-viajes") {

    showEl("view-historial-viajes");
    const p = allPassengers.find(x => x._idx === idx);
    const nombre = p?.Pasajero || "Pasajero";
    document.getElementById("historial-titulo").textContent = nombre;
    document.getElementById("historial-subtitulo").textContent = "Viajes asistidos como protagonista";
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: nombre, action: () => navigateTo("detalle", idx) },
      { label: "Historial de viajes" }
    ]);
    loadHistorialViajes(idx);

  }

  else if (view === "viaje-nuevo") {

    if (currentUserRole !== "admin") return;
    showEl("view-viaje-nuevo");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Nuevo viaje" }
    ]);

  }

  else if (view === "viaje-editar") {

    if (currentUserRole !== "admin") return;
    showEl("view-viaje-editar");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("home") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx) },
      { label: "Editar viaje" }
    ]);
    initFormEditarViaje(idx);

  }

  else if (view === "viaje-detalle") {

    showEl("view-viaje-detalle");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Detalle" }
    ]);
    loadViajeDetalle(idx);

  }

  else if (view === "viaje-pasajero-nuevo") {

    showEl("view-viaje-pasajero-nuevo");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("home") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx) },
      { label: "Agregar pasajero" }
    ]);
    initFormPasajero(idx);

  }

  else if (view === "viaje-pasajero-pagos") {

    const { viajePasajeroId, viajeId, pasajeroId, nombrePasajero } = idx || {};
    showEl("view-viaje-pasajero-pagos");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("home") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", viajeId) },
      { label: nombrePasajero || "Pagos" }
    ]);
    initPagosView({ viajePasajeroId, viajeId, pasajeroId, nombrePasajero });

  }

  else if (view === "pago-detalle") {

    showEl("view-pago-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("home") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx?.viajeId) },
      { label: idx?.nombrePasajero || "Pagos", action: () => navigateTo("viaje-pasajero-pagos", pagosCtx) },
      { label: "Detalle pago" }
    ]);
    initPagoDetalleView(idx);

  }

  else if (view === "egreso-detalle") {

    showEl("view-egreso-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("home") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx?.viajeId) },
      { label: "Egreso" }
    ]);
    initEgresoDetalleView(idx);

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
    .from("pasajeros")
    .select(`id, Pasajero, "Documento de Identidad", Vendedor, "Fecha de nacimiento", Sexo, "E-mail", avatar_path`)
    .order("Pasajero", { ascending: true });

  if (error) { console.error(error); setListState("error"); return; }
  allPassengers = data.map((p, i) => ({ ...p, _idx: i }));

  // Cargar URLs públicas de avatars que existan
  allPassengers.forEach(p => {
    if (p.avatar_path) {
      const { data: urlData } = supabaseClient.storage
        .from("avatars")
        .getPublicUrl(p.avatar_path);
      if (urlData?.publicUrl) avatarCache[p._idx] = urlData.publicUrl;
    }
  });

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
async function renderDetalle(idx) {
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

  // Mostrar botón editar solo para admin y worker
  const btnEditar = document.getElementById("btn-editar-detalle");
  if (btnEditar) {
    btnEditar.style.display = ["admin", "worker"].some(r =>
      Array.isArray(currentUserRole) ? currentUserRole.includes(r) : currentUserRole === r
    ) ? "" : "none";
  }

  // Asegurar modo lectura al renderizar
  cancelarEdicionDetalle(true);

  // ── Datos de viajes del pasajero ──────────────────
  document.getElementById("d-club-destino").textContent  = "…";
  document.getElementById("d-total-viajes").textContent  = "…";
  document.getElementById("d-ultimo-viaje").textContent  = "…";

  const { data: vps } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      asistencia,
      viajes ( nombre, fecha_salida )
    `)
    .eq("pasajero_id", p.id)
    .eq("asistencia", "Asiste");

  if (!vps || vps.length === 0) {
    document.getElementById("d-club-destino").innerHTML = `<span style="color:var(--text-muted)">No miembro</span>`;
    document.getElementById("d-total-viajes").textContent = "0";
    document.getElementById("d-ultimo-viaje").textContent = "Sin viajes";
    return;
  }

  const totalViajes = vps.length;
  const esmiembro   = totalViajes >= 3;

  // Último viaje por fecha_salida
  const conFecha = vps.filter(v => v.viajes?.fecha_salida);
  conFecha.sort((a, b) => b.viajes.fecha_salida.localeCompare(a.viajes.fecha_salida));
  const ultimoNombre = conFecha.length > 0
    ? conFecha[0].viajes.nombre
    : (vps[0].viajes?.nombre || "—");

  document.getElementById("d-club-destino").innerHTML = esmiembro
    ? `<span style="color:var(--accent);font-weight:600">⭐ Miembro</span>`
    : `<span style="color:var(--text-muted)">No miembro</span>`;
  document.getElementById("d-total-viajes").textContent = totalViajes;
  const cardViajes = document.getElementById("card-total-viajes");
  if (cardViajes) cardViajes.onclick = () => irAHistorialViajes(idx);
  document.getElementById("d-ultimo-viaje").textContent = ultimoNombre;
}

function activarEdicionDetalle() {
  const p = allPassengers.find(x => x._idx === selectedIdx);
  if (!p) return;

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  // Poblar inputs con valores actuales
  document.getElementById("e-nombre").value  = p.Pasajero || "";
  document.getElementById("e-ci").value      = p["Documento de Identidad"] || "";
  document.getElementById("e-sexo").value    = p.Sexo || "";
  document.getElementById("e-fecha").value   = p["Fecha de nacimiento"] || "";
  document.getElementById("e-email").value   = p["E-mail"] || "";

  // Cargar select vendedores y marcar el actual
  cargarVendedores("e-vendedor", p.Vendedor || "").then(() => {
    const selVend = document.getElementById("e-vendedor");
    if (selVend) {
      selVend.disabled = !esAdmin;
      selVend.style.opacity = esAdmin ? "" : "0.5";
      selVend.title = esAdmin ? "" : "Solo admin puede cambiar el vendedor";
    }
  });

  // Alternar vistas
  document.getElementById("detalle-fields-view").style.display  = "none";
  document.getElementById("detalle-fields-edit").style.display  = "";
  document.getElementById("detalle-empresa-view").style.display = "none";
  document.getElementById("detalle-empresa-edit").style.display = "";
  document.getElementById("detalle-edit-actions").style.display = "";
  document.getElementById("btn-editar-detalle").style.display   = "none";
  document.getElementById("detalle-edit-feedback").style.display = "none";
}

function cancelarEdicionDetalle(silencioso = false) {
  document.getElementById("detalle-fields-view").style.display  = "";
  document.getElementById("detalle-fields-edit").style.display  = "none";
  document.getElementById("detalle-empresa-view").style.display = "";
  document.getElementById("detalle-empresa-edit").style.display = "none";
  document.getElementById("detalle-edit-actions").style.display = "none";
  document.getElementById("detalle-edit-feedback").style.display = "none";
  const btnEditar = document.getElementById("btn-editar-detalle");
  if (btnEditar && !silencioso) btnEditar.style.display = "";
}

async function guardarEdicionDetalle() {
  const p = allPassengers.find(x => x._idx === selectedIdx);
  if (!p) return;

  const nombre = document.getElementById("e-nombre").value.trim();
  const ci     = document.getElementById("e-ci").value.trim();
  const sexo   = document.getElementById("e-sexo").value;

  if (!nombre || !ci || !sexo) {
    mostrarFeedbackDetalle("Completá los campos obligatorios.", false);
    return;
  }

  const btn = document.getElementById("btn-guardar-detalle");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const selVend = document.getElementById("e-vendedor");
  const vendedor = (selVend && !selVend.disabled)
    ? (selVend.value || null)
    : (p.Vendedor || null);

  const updates = {
    "Pasajero":               nombre,
    "Documento de Identidad": ci,
    "Sexo":                   sexo,
    "Fecha de nacimiento":    document.getElementById("e-fecha").value || null,
    "E-mail":                 document.getElementById("e-email").value.trim() || null,
    "Vendedor":               vendedor,
  };

  const { error } = await supabaseClient
    .from("pasajeros")
    .update(updates)
    .eq("id", p.id);

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cambios`;

  if (error) {
    mostrarFeedbackDetalle(
      error.code === "23505" ? "Ya existe un cliente con ese CI." : "Error al guardar. Intentá de nuevo.",
      false
    );
    return;
  }

  // Actualizar en memoria
  Object.assign(p, updates);
  cancelarEdicionDetalle();
  renderDetalle(selectedIdx);
  mostrarFeedbackDetalle("Cambios guardados correctamente.", true);
}

function mostrarFeedbackDetalle(msg, ok) {
  const el = document.getElementById("detalle-edit-feedback");
  el.textContent = msg;
  el.style.display = "";
  el.style.background = ok ? "#f0faf4" : "#fff0f0";
  el.style.color      = ok ? "#2d6a4f" : "#c0392b";
  el.style.border     = ok ? "1px solid rgba(45,106,79,.2)" : "1px solid rgba(192,57,43,.2)";
  if (ok) setTimeout(() => { el.style.display = "none"; }, 3000);
}

// ── Avatar ─────────────────────────────────────────────────
function triggerAvatarUpload() {
  document.getElementById("avatar-file-input").click();
}

async function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const idx = parseInt(document.getElementById("detalle-avatar").dataset.idx);
  const p   = allPassengers.find(x => x._idx === idx);
  if (!p) return;
  event.target.value = "";

  // Mostrar preview inmediato mientras sube
  const reader = new FileReader();
  reader.onload = e => {
    avatarCache[idx] = e.target.result;
    renderDetalle(idx);
    const row = document.querySelector(`.passenger-row[data-idx="${idx}"]`);
    if (row) row.querySelector(".p-avatar").innerHTML = `<img src="${avatarCache[idx]}" alt="" />`;
  };
  reader.readAsDataURL(file);

  // Subir a Supabase Storage
  const ext      = file.name.split(".").pop();
  const filePath = `${p.id}.${ext}`;

  const { error: upError } = await supabaseClient.storage
    .from("avatars")
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (upError) {
    console.error("Error subiendo avatar:", upError);
    mostrarFeedbackDetalle("Error al subir la foto. Intentá de nuevo.", false);
    return;
  }

  // Guardar la ruta en la tabla pasajeros
  const { error: dbError } = await supabaseClient
    .from("pasajeros")
    .update({ avatar_path: filePath })
    .eq("id", p.id);

  if (dbError) {
    console.error("Error guardando avatar_path:", dbError);
    mostrarFeedbackDetalle("Foto subida pero no se pudo registrar en la base de datos.", false);
    return;
  }

  p.avatar_path = filePath;
  mostrarFeedbackDetalle("Foto actualizada correctamente.", true);
}

// ── Helpers ────────────────────────────────────────────────
function getInitials(name) {
  return name.split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
}

function formatDate(val) {
  if (!val) return null;
  const [year, month, day] = val.split("-");
  if (!day) return val;
  return `${day}/${month}/${year}`;
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

// ── Vendedores ─────────────────────────────────────────────
async function cargarVendedores(selectId, valorActual = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;

  // Traer de Supabase solo si el caché está vacío
  if (_vendedoresCache.length === 0) {
    const { data, error } = await supabaseClient
      .from("vendedores")
      .select("Nombre_del_vendedor")
      .order("Nombre_del_vendedor", { ascending: true });
    if (!error && data) _vendedoresCache = data.map(v => v.Nombre_del_vendedor);
  }

  sel.innerHTML = `<option value="">— Sin vendedor —</option>` +
    _vendedoresCache.map(n =>
      `<option value="${n}" ${n === valorActual ? "selected" : ""}>${n}</option>`
    ).join("");
}

// ── Formulario nuevo cliente ───────────────────────────────
function limpiarFormulario() {
  ["f-nombre","f-ci","f-sexo","f-email","f-fecha"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = "";
    el.classList.remove("error");
  });
  // El select de vendedor se resetea por separado
  const selVend = document.getElementById("f-vendedor");
  if (selVend) { selVend.value = ""; selVend.classList.remove("error"); }
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
  };

  const btn = document.getElementById("btn-guardar");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { data, error } = await supabaseClient
    .from("pasajeros")
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

// ── Historial de viajes del pasajero ───────────────────────
function irAHistorialViajes(pasajeroIdx) {
  const idxToUse = (pasajeroIdx !== undefined) ? pasajeroIdx : selectedIdx;
  const p = allPassengers.find(x => x._idx === idxToUse);
  if (!p) return;
  const total = document.getElementById("d-total-viajes")?.textContent;
  if (total === "0" || total === "…" || total === "—") return;
  navigateTo("historial-viajes", idxToUse);
}

async function loadHistorialViajes(idx) {
  const listEl = document.getElementById("historial-list");
  listEl.innerHTML = `<div class="list-state"><div class="icon">⏳</div>Cargando viajes…</div>`;

  const p = allPassengers.find(x => x._idx === idx);
  if (!p) { listEl.innerHTML = `<div class="list-state"><div class="icon">⚠️</div>Pasajero no encontrado.</div>`; return; }

  const { data, error } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      viaje_id,
      viajes ( nombre, fecha_salida, puntos_destino )
    `)
    .eq("pasajero_id", p.id)
    .eq("asistencia", "Asiste");

  if (error || !data || data.length === 0) {
    listEl.innerHTML = `<div class="list-state"><div class="icon">🔍</div>Sin viajes registrados.</div>`;
    return;
  }

  // Ordenar por fecha descendente
  data.sort((a, b) => {
    const fa = a.viajes?.fecha_salida || "";
    const fb = b.viajes?.fecha_salida || "";
    return fb.localeCompare(fa);
  });

  listEl.innerHTML = data.map((vp, i) => {
    const nombre  = vp.viajes?.nombre || "Viaje sin nombre";
    const fecha   = formatDate(vp.viajes?.fecha_salida) || "Fecha no registrada";
    const puntos  = vp.viajes?.puntos_destino != null ? vp.viajes.puntos_destino : "—";
    return `
      <div class="historial-viaje-row">
        <div class="hvr-num">${i + 1}</div>
        <div class="hvr-body">
          <div class="hvr-nombre">${nombre}</div>
          <div class="hvr-meta">
            <span class="hvr-fecha">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              ${fecha}
            </span>
            <span class="hvr-puntos">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${puntos} pts
            </span>
          </div>
        </div>
      </div>`;
  }).join("");
}
