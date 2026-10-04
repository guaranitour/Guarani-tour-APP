// clientes.js — lista/buscador/detalle/edición de clientes, avatar, alta de
// cliente e historial de viajes del pasajero. Extraído de app.js.

// ── Carga ──────────────────────────────────────────────────
async function loadPassengers() {
  if (_loadPassengersPromise) return _loadPassengersPromise;
  _loadPassengersPromise = _loadPassengersImpl().finally(() => {
    _loadPassengersPromise = null;
  });
  return _loadPassengersPromise;
}

// Garantiza que allPassengers esté poblado antes de continuar. Necesario
// cuando se entra directo a una vista que depende de la lista (detalle,
// historial-viajes) sin haber pasado antes por "clientes" — típicamente
// al recargar la página con ese hash en la URL.
async function garantizarPassengersCargados() {
  if (allPassengers.length > 0) return;
  await loadPassengers();
}

async function _loadPassengersImpl() {
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

  row.onclick = () => {
    // El nombre puesto al *entrar* a la vista "clientes" no alcanza:
    // si hubo scroll, filtro, o un refresh de renderList de por medio,
    // esta fila es un nodo DOM distinto al de aquella vez. Lo asignamos
    // acá, en el click mismo, que es el momento real en que arranca
    // la transición hacia el detalle.
    const avatarEl = row.querySelector(".p-avatar");
    if (avatarEl) avatarEl.style.viewTransitionName = `avatar-${p._idx}`;
    // navigateTo recibe el id real (estable en la URL), no _idx (posición
    // en el array, que puede cambiar de sesión a sesión).
    navigateTo("detalle", p.id);
  };

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
let searchToken = 0; // evita que una respuesta vieja pise a una más nueva

// silencioso: refina con el servidor sin pasar por "Cargando…" (al volver
// con "atrás" la lista ya está pintada y no debe parpadear).
function filterPassengers(silencioso = false) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = document.getElementById("search-input").value.trim();

    // Caja vacía: se mantiene el comportamiento actual (lista completa local)
    if (!q) {
      renderList(allPassengers);
      return;
    }

    const myToken = ++searchToken;
    if (!silencioso) setListState("loading");

    const { data, error } = await supabaseClient
      .rpc("buscar_pasajeros", { busqueda: q });

    if (myToken !== searchToken) return; // llegó tarde, se descarta

    if (error) { console.error(error); setListState("error"); return; }

    // Se fusionan los resultados dentro de allPassengers para conservar
    // _idx estable (usado por navigateTo("detalle", ...) y avatarCache)
    const results = (data || []).map(p => {
      let existing = allPassengers.find(x =>
        x.id != null && x.id === p.id);
      if (existing) return Object.assign(existing, p);

      const withIdx = { ...p, _idx: allPassengers.length };
      allPassengers.push(withIdx);

      if (withIdx.avatar_path && avatarCache[withIdx._idx] === undefined) {
        const { data: urlData } = supabaseClient.storage
          .from("avatars")
          .getPublicUrl(withIdx.avatar_path);
        if (urlData?.publicUrl) avatarCache[withIdx._idx] = urlData.publicUrl;
      }
      return withIdx;
    });

    renderList(results);
  }, 160);
}

// Se muestra cuando renderDetalle no logra resolver el pasajero (id
// inexistente, o un enlace/hash inválido). Evita dejar la pantalla en
// blanco con los campos de la última vista renderizada.
function mostrarDetalleNoEncontrado() {
  const contenidoEl = document.getElementById("detalle-contenido");
  const noEncontradoEl = document.getElementById("detalle-no-encontrado");
  if (contenidoEl) contenidoEl.style.display = "none";
  if (noEncontradoEl) noEncontradoEl.style.display = "";
}

// ── Detalle ────────────────────────────────────────────────
// pasajeroId es el id real de la tabla "pasajeros" (estable en la URL).
// Internamente seguimos usando p._idx para todo lo que ya dependía de él
// (avatar cache, dataset del DOM, view-transition-name).
async function renderDetalle(pasajeroId) {
  await garantizarPassengersCargados();

  const p = allPassengers.find(x => x.id === pasajeroId);
  if (!p) {
    mostrarDetalleNoEncontrado();
    return;
  }

  // Encontrado: asegurar que el contenido normal esté visible (por si
  // quedó oculto de un intento previo con un id inválido).
  const contenidoEl = document.getElementById("detalle-contenido");
  const noEncontradoEl = document.getElementById("detalle-no-encontrado");
  if (contenidoEl) contenidoEl.style.display = "";
  if (noEncontradoEl) noEncontradoEl.style.display = "none";

  const idx = p._idx;
  const name = p.Pasajero || "Sin nombre";

  _ultimoDetalleIdx = idx;

  const avatarEl = document.getElementById("detalle-avatar");
  const wrapEl   = avatarEl.closest(".detalle-avatar-wrap") || avatarEl.parentElement;
  const imgEl    = avatarEl.querySelector("img");
  const initEl   = avatarEl.querySelector(".d-initials");

  // El avatar de origen (row en la lista) trae el nombre puesto por
  // navigateTo. Lo retiramos de ahí en el mismo instante en que lo
  // ponemos acá, para que nunca haya dos elementos con el mismo
  // view-transition-name vivos a la vez (eso aborta la transición).
  const rowOrigenEl = document.querySelector(`.passenger-row[data-idx="${idx}"] .p-avatar`);
  if (rowOrigenEl) rowOrigenEl.style.viewTransitionName = "";
  avatarEl.style.viewTransitionName = `avatar-${idx}`;
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
  if (currentView === "detalle" && selectedIdx === pasajeroId) {
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: name }
    ]);
  }
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

  // ── Contacto de emergencia (FAB SOS) ───────────────
  setFabSosVisible(true);
  cargarContactoEmergencia(p);

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
  if (cardViajes) cardViajes.onclick = () => irAHistorialViajes(p.id);
  document.getElementById("d-ultimo-viaje").textContent = ultimoNombre;
}

async function activarEdicionDetalle() {
  const p = allPassengers.find(x => x.id === selectedIdx);
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
  initCustomSelect("e-sexo");
  refreshCustomSelect("e-sexo");

  // Deshabilitar guardado mientras se carga el select de vendedor,
  // para evitar guardar con el campo vacío si se hace click antes de tiempo.
  const btnGuardar = document.getElementById("btn-guardar-detalle");
  if (btnGuardar) btnGuardar.disabled = true;

  // Cargar select vendedores y marcar el actual — esperar a que termine antes de continuar
  await cargarVendedores("e-vendedor", p.Vendedor || "");
  const selVend = document.getElementById("e-vendedor");
  if (selVend) {
    selVend.disabled = !esAdmin;
    selVend.style.opacity = esAdmin ? "" : "0.5";
    selVend.title = esAdmin ? "" : "Solo admin puede cambiar el vendedor";
  }

  if (btnGuardar) btnGuardar.disabled = false;

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
  const p = allPassengers.find(x => x.id === selectedIdx);
  if (!p) return;

  const nombre = document.getElementById("e-nombre").value.trim();
  const ci     = document.getElementById("e-ci").value.trim();
  const sexo   = document.getElementById("e-sexo").value;

  if (!nombre || !sexo) {
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
    "Documento de Identidad": ci || null,
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
    renderDetalle(p.id);
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

// ── Vendedores ─────────────────────────────────────────────
async function cargarVendedores(selectId, valorActual = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const lista = await getVendedores();
  const val = (valorActual || "").trim();
  sel.innerHTML = `<option value="">— Sin vendedor —</option>` +
    lista.map(n =>
      `<option value="${n.Nombre_del_vendedor}">${n.Nombre_del_vendedor}</option>`
    ).join("");
  // Asignar con sel.value es más robusto que confiar solo en el atributo "selected"
  // (evita fallos por display:none, encoding de acentos u orden del DOM)
  if (val) sel.value = val;
  // Sincronizar el trigger visual si este select ya fue inicializado como custom select
  refreshCustomSelect(selectId);
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

  showToast("Cliente creado", "success");
  navigateTo("clientes");
}

// ── Historial de viajes del pasajero ───────────────────────
// pasajeroId es el id real de la tabla "pasajeros" (mismo criterio que
// navigateTo("detalle", id)), para que el hash resultante sea estable.
function irAHistorialViajes(pasajeroId) {
  const idToUse = (pasajeroId !== undefined) ? pasajeroId : selectedIdx;
  const p = allPassengers.find(x => x.id === idToUse);
  if (!p) return;
  const total = document.getElementById("d-total-viajes")?.textContent;
  if (total === "0" || total === "…" || total === "—") return;
  navigateTo("historial-viajes", idToUse);
}

async function loadHistorialViajes(pasajeroId) {
  const listEl = document.getElementById("historial-list");
  listEl.innerHTML = `<div class="list-state"><div class="icon">⏳</div>Cargando viajes…</div>`;

  await garantizarPassengersCargados();
  const p = allPassengers.find(x => x.id === pasajeroId);
  if (!p) { listEl.innerHTML = `<div class="list-state"><div class="icon">⚠️</div>Pasajero no encontrado.</div>`; return; }

  const nombre = p.Pasajero || "Pasajero";
  document.getElementById("historial-titulo").textContent = nombre;
  if (currentView === "historial-viajes" && selectedIdx === pasajeroId) {
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: nombre, action: () => navigateTo("detalle", pasajeroId) },
      { label: "Historial de viajes" }
    ]);
  }

  const { data, error } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      viaje_id,
      puntos_destino,
      viajes ( nombre, fecha_salida )
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
    // Los puntos realmente ganados por ESTE pasajero en ESTE viaje viven en
    // viaje_pasajeros.puntos_destino (pueden ser 0 o distintos del base del
    // viaje por ajuste manual / no ser miembro Club Destino todavía). Usar
    // viajes.puntos_destino acá mostraba el puntaje base del viaje, no lo
    // que el pasajero efectivamente acumuló.
    const puntos  = vp.puntos_destino != null ? vp.puntos_destino : "—";
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
