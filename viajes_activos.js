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
    <div class="user-card">
      <div class="user-avatar">
        ${v.nombre ? v.nombre.slice(0,2).toUpperCase() : "VJ"}
      </div>

      <div class="user-info">
        <div class="user-email">${v.nombre}</div>

        <div class="user-controls">
          <span class="p-pill">${v.estado}</span>
          <span class="p-pill">${formatFecha(v.fecha_salida)}</span>
        </div>
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
      imagen_url
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

function abrirSelectorImagen(event) {
  event.stopPropagation();
  document.getElementById("v-imagen").click();
}

/* ── FAB HANDLER ──────────────────────────── */
function handleFabViajes() {
  navigateTo("viaje-nuevo");
}
