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


list.innerHTML = data.map(v => `
  <div class="viaje-card" onclick="openViajeDetalle('${v.id}')">
    
    ${v.imagen_url ? `<img src="${v.imagen_url}" class="viaje-card-img" />` : ``}

    <div class="viaje-card-nombre">${v.nombre}</div>

    <div class="viaje-card-body">
      <div>${v.estado || "activo"}</div>
      <div>${v.puntos_destino || 0} pts</div>
      ${v.fecha_salida ? `<div>${formatFecha(v.fecha_salida)}</div>` : ""}
    </div>

  </div>
`).join("");
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
}

  navigateTo("viaje-pasajero-nuevo", viajeActualId);
}
function openViajeDetalle(viajeId) {
  navigateTo("viaje-detalle", viajeId);
}
async function loadViajeDetalle(viajeId) {
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

  nombreEl.textContent = viaje.nombre;
  infoEl.textContent = `${viaje.puntos_destino || 0} puntos base`;

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
    listEl.innerHTML = "Sin pasajeros";
    return;
  }

  listEl.innerHTML = pasajeros.map(p => `
    <div class="passenger-row">
      <div class="p-name">${p.pasajeros?.Pasajero || "Sin nombre"}</div>
      <span class="p-pill">Gs. ${p.total_a_pagar || 0}</span>
      <span class="p-pill">${p.asistencia === "No asiste" ? "❌" : "✅"}</span>
      <span class="p-pill">⭐ ${p.puntos_destino || 0}</span>
    </div>
  `).join("");
}
viajeActualId = viajeId;
viajeActualData = viaje;
