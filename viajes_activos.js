let viajeActualId = null;
let pasajeroSeleccionado = null;
let viajeActualData = null;
/* ─────────────────────────────────────────────
   viajes_activos.js — Gestión de viajes
───────────────────────────────────────────── */

let allViajes = [];

/* ── CARGAR VIAJES ─────────────────────────── */
async function loadViajes() {
  const list = document.getElementById("viajes-list");
  if (!list) return;

  list.innerHTML = "Cargando…";

  const { data, error } = await supabaseClient
    .from("viajes")
    .select("*")
    .order("fecha_salida", { ascending: false });

  if (error) {
    console.error(error);
    list.innerHTML = "Error al cargar viajes";
    return;
  }

  allViajes = data;

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin viajes registrados</div>`;
    return;
  }


list.innerHTML = data.map(v => {
  const estado = v.estado || "activo";
  const placeholder = `
    <div class="viaje-card-img-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
    </div>`;
  return `
  <div class="viaje-card" onclick="openViajeDetalle('${v.id}')">
    ${v.imagen_url ? `<img src="${v.imagen_url}" class="viaje-card-img" />` : placeholder}
    <div class="viaje-card-body">
      <div class="viaje-card-nombre">${v.nombre}</div>
      <div class="viaje-card-meta">
        <span class="viaje-pill ${estado}">${estado}</span>
        ${v.puntos_destino ? `<span class="viaje-puntos">⭐ ${v.puntos_destino} pts</span>` : ""}
        ${v.fecha_salida ? `
          <span class="viaje-card-fecha">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            ${formatFecha(v.fecha_salida)}
          </span>` : ""}
      </div>
    </div>
  </div>`
}).join("");
}

/* ── FORMATEAR FECHA ───────────────────────── */
function formatFecha(val) {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("es-PY");
}

/* ── SUBIR IMAGEN ─────────────────────────── */
async function uploadViajeImage(file) {
  const fileName = `${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("viajes")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("viajes")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

/* ── CREAR VIAJE ──────────────────────────── */
async function crearViaje() {
  const nombre   = document.getElementById("v-nombre").value.trim();
  const salida   = document.getElementById("v-salida").value;
  const regreso  = document.getElementById("v-regreso").value;
  const estado   = document.getElementById("v-estado").value;
  const puntos_destino = parseInt(document.getElementById("v-puntos").value) || 0;
  const file     = document.getElementById("v-imagen").files[0];

  if (!nombre) {
    alert("El nombre es obligatorio");
    return;
  }

  let imagen_url = null;

  if (file) {
    try {
      imagen_url = await uploadViajeImage(file);
    } catch (e) {
      console.error(e);
      alert("Error subiendo imagen");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("viajes")
    .insert([{
      nombre,
      fecha_salida: salida,
      fecha_regreso: regreso,
      estado,
      imagen_url,
      puntos_destino
    }]);

  if (error) {
    console.error(error);
    alert("Error al guardar viaje");
    return;
  }

  navigateTo("viajes");
}

/* ── PREVIEW IMAGEN FORMULARIO ─────────────── */
function previewViajeImg(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector(".viaje-imagen-preview");
  const overlay = document.getElementById("viaje-img-overlay");
  const reader = new FileReader();
  reader.onload = (e) => {
    const prev = preview.querySelector("img");
    if (prev) prev.remove();
    const img = document.createElement("img");
    img.src = e.target.result;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ── FAB HANDLER ──────────────────────────── */
function handleFabViajes() {
  navigateTo("viaje-nuevo");
}
function irAgregarPasajero() {
  if (!["admin", "worker"].includes(currentUserRole)) {
    alert("Solo lectura");
    return;
  }

  navigateTo("viaje-pasajero-nuevo", viajeActualId);
}

function initFormPasajero(viajeId) {
  viajeActualId = viajeId;
  pasajeroSeleccionado = null;

  document.getElementById("buscar-pasajero").value = "";
  document.getElementById("input-total").value = "";
  document.getElementById("resultados-pasajero").innerHTML = "";

  // 🔑 ESTA LÍNEA TE FALTABA
  if (allPassengers.length === 0) {
    loadPassengers();
  }
}

function openViajeDetalle(viajeId) {
  navigateTo("viaje-detalle", viajeId);
}
async function loadViajeDetalle(viajeId) {
  viajeActualId = viajeId;

  const nombreEl = document.getElementById("detalle-viaje-nombre");
  const infoEl = document.getElementById("detalle-viaje-info");
  const listEl = document.getElementById("viaje-pasajeros-list");

  listEl.innerHTML = "Cargando...";

  const { data: viaje } = await supabaseClient
    .from("viajes")
    .select("*")
    .eq("id", viajeId)
    .single();

  if (!viaje) return;

  // ✅ AHORA SÍ existe
  viajeActualData = viaje;

  nombreEl.textContent = viaje.nombre;
  const estado = viaje.estado || "activo";
  infoEl.innerHTML = `
    <span class="viaje-pill ${estado}" style="font-size:.75rem">${estado}</span>
    ${viaje.puntos_destino ? `<span class="viaje-puntos" style="margin-left:.4rem">⭐ ${viaje.puntos_destino} pts base</span>` : ""}
    ${viaje.fecha_salida ? `<span style="margin-left:.4rem;font-size:.8rem;color:var(--text-muted)">📅 ${formatFecha(viaje.fecha_salida)}${viaje.fecha_regreso ? " → " + formatFecha(viaje.fecha_regreso) : ""}</span>` : ""}
  `;
  const heroEl = document.getElementById("detalle-viaje-hero");
  if (heroEl) {
    heroEl.style.display = viaje.imagen_url ? "block" : "none";
    if (viaje.imagen_url) heroEl.src = viaje.imagen_url;
  }

  const { data: pasajeros } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      id,
      total_a_pagar,
      puntos_destino,
      asistencia,
      pasajeros (Pasajero, "Documento de Identidad")
    `)
    .eq("viaje_id", viajeId);

  if (!pasajeros || pasajeros.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        Sin pasajeros aún
      </div>`;
    return;
  }

  listEl.innerHTML = pasajeros.map(p => {
    const asiste = p.asistencia !== "No asiste";
    const nombre = p.pasajeros?.Pasajero || "Sin nombre";
    const ci = p.pasajeros?.["Documento de Identidad"] || "";
    const monto = (p.total_a_pagar || 0).toLocaleString("es-PY");
    return `
    <div class="viaje-pasajero-row">
      <div class="vp-avatar">${nombre.charAt(0).toUpperCase()}</div>
      <div class="vp-info">
        <div class="vp-nombre">${nombre}</div>
        ${ci ? `<div class="vp-ci">CI: ${ci}</div>` : ""}
      </div>
      <div class="vp-pills">
        <span class="vp-pill monto">Gs. ${monto}</span>
        <span class="vp-pill ${asiste ? "asiste" : "noasiste"}">${asiste ? "✅ Asiste" : "❌ No asiste"}</span>
        ${p.puntos_destino ? `<span class="vp-pill pts">⭐ ${p.puntos_destino}</span>` : ""}
      </div>
    </div>`;
  }).join("");
}
async function guardarPasajeroEnViaje() {
  try {
    if (!viajeActualId) {
      alert("Error: no hay viaje seleccionado");
      return;
    }

    if (!pasajeroSeleccionado) {
      alert("Seleccioná un pasajero");
      return;
    }

    const total = parseInt(document.getElementById("input-total").value);

    if (!total || total <= 0) {
      alert("Ingresá un monto válido");
      return;
    }

    console.log("Guardando...", {
      viaje_id: viajeActualId,
      pasajero_id: pasajeroSeleccionado.id,
      total
    });

// ✅ CORRECTO
const { data: { user } } = await supabaseClient.auth.getUser();

const { error } = await supabaseClient
  .from("viaje_pasajeros")
  .insert([{
    viaje_id: viajeActualId,
    pasajero_id: pasajeroSeleccionado.id,
    total_a_pagar: total,       // ← coma agregada
    creado_por: user.email
  }]);

    if (error) {
      console.error("ERROR SUPABASE:", error);
      alert("Error al guardar en base de datos");
      return;
    }

    alert("✅ Pasajero agregado correctamente");

    navigateTo("viaje-detalle", viajeActualId);
  } catch (e) {
    console.error("ERROR GENERAL:", e);
    alert("Error inesperado");
  }
}
function buscarPasajero() {
  const q = document.getElementById("buscar-pasajero").value.toLowerCase().trim();
  const cont = document.getElementById("resultados-pasajero");

  if (!q) {
    cont.innerHTML = "";
    pasajeroSeleccionado = null;
    return;
  }

  const resultados = allPassengers.filter(p =>
    (p.Pasajero || "").toLowerCase().includes(q) ||
    (p["Documento de Identidad"] || "").toLowerCase().includes(q)
  );

  if (resultados.length === 0) {
    cont.innerHTML = `<div class="users-empty">Sin resultados</div>`;
    return;
  }

  cont.innerHTML = resultados.map(p => `
    <div class="pasajero-item" onclick="seleccionarPasajero(${p._idx})">
      <div><strong>${p.Pasajero}</strong></div>
      <div class="ci">CI: ${p["Documento de Identidad"]}</div>
    </div>
  `).join("");
}
function seleccionarPasajero(idx) {
  const p = allPassengers.find(x => x._idx === idx);
  if (!p) return;

  pasajeroSeleccionado = p;

  document.getElementById("buscar-pasajero").value = p.Pasajero;

  document.getElementById("resultados-pasajero").innerHTML = `
    <div class="pasajero-seleccionado">
      ✅ ${p.Pasajero} (CI ${p["Documento de Identidad"]})
    </div>
  `;
}
