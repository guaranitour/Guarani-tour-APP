/* ─────────────────────────────────────────────
   extras.js — Servicios extra por viaje
   CRUD sobre la tabla servicios_extra.
   Lectura: admin / worker / viewer (viewer no ve el tab, pero
   la función queda protegida igual por las dudas).
   Alta / edición / baja: admin y worker únicamente.
───────────────────────────────────────────── */

let _extrasLoadToken = 0; // Descarta respuestas tardías de un viaje distinto al que se está viendo
let _extrasData = [];     // Caché en memoria de los extras del viaje actualmente cargado
let _extraEditandoId = null; // null = alta nueva · id = edición en curso

function _esWorkerOAdminExtras() {
  return Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);
}

async function loadExtras(viajeId) {
  const miToken = ++_extrasLoadToken;
  const listEl = document.getElementById("extras-list");
  const btnAdd = document.getElementById("btn-agregar-extra");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const puedeEditar = _esWorkerOAdminExtras();
  if (btnAdd) btnAdd.style.display = puedeEditar ? "" : "none";

  const { data, error } = await supabaseClient
    .from("servicios_extra")
    .select("id, nombre, descripcion, precio_venta, costo_fijo, costo_por_persona, created_at")
    .eq("viaje_id", viajeId)
    .order("created_at", { ascending: false });

  // Respuesta obsoleta: el usuario ya cambió de viaje o de tab.
  if (miToken !== _extrasLoadToken) return;
  if (viajeId !== viajeActualId) return;

  if (error) {
    console.error("Error cargando servicios extra:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar servicios extra</div>`;
    return;
  }

  _extrasData = data || [];

  if (_extrasData.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/><path d="M2 7h20v5H2z"/>
          <path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
        </svg>
        Sin servicios extra registrados
      </div>`;
    return;
  }

  listEl.innerHTML = _extrasData.map(s => {
    const desc = s.descripcion
      ? `<div class="extra-desc">${_escapeHtml(s.descripcion)}</div>`
      : "";
    const costos = [];
    if (s.costo_fijo)        costos.push(`Fijo: Gs. ${s.costo_fijo.toLocaleString("es-PY")}`);
    if (s.costo_por_persona) costos.push(`x persona: Gs. ${s.costo_por_persona.toLocaleString("es-PY")}`);
    const costosHtml = costos.length
      ? `<div class="extra-costos">${costos.join(" · ")}</div>`
      : "";

    const acciones = puedeEditar ? `
      <div class="extra-row-actions">
        <button class="extra-btn-icon" title="Editar" onclick="event.stopPropagation(); editarExtra('${s.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="extra-btn-icon danger" title="Eliminar" onclick="event.stopPropagation(); eliminarExtra('${s.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>` : "";

    return `
  <div class="extra-row">
    <div class="extra-info">
      <div class="extra-nombre">${_escapeHtml(s.nombre)}</div>
      ${desc}
      ${costosHtml}
    </div>
    <div style="display:flex;align-items:center;gap:.5rem">
      <div class="extra-precio">Gs. ${(s.precio_venta || 0).toLocaleString("es-PY")}</div>
      ${acciones}
    </div>
  </div>`;
  }).join("");
}

function mostrarFormExtra() {
  const form = document.getElementById("form-extra");
  const btn  = document.getElementById("btn-agregar-extra");
  if (!form) return;

  _extraEditandoId = null;
  _limpiarFormExtra();

  const saveBtn = document.getElementById("btn-guardar-extra");
  if (saveBtn) {
    saveBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";
}

function editarExtra(id) {
  const servicio = _extrasData.find(s => String(s.id) === String(id));
  if (!servicio) return;

  const form = document.getElementById("form-extra");
  const btn  = document.getElementById("btn-agregar-extra");
  if (!form) return;

  _extraEditandoId = servicio.id;

  document.getElementById("extra-id").value             = servicio.id;
  document.getElementById("extra-nombre").value          = servicio.nombre || "";
  document.getElementById("extra-descripcion").value     = servicio.descripcion || "";
  document.getElementById("extra-precio-venta").value    = servicio.precio_venta || 0;
  document.getElementById("extra-costo-fijo").value      = servicio.costo_fijo || 0;
  document.getElementById("extra-costo-persona").value   = servicio.costo_por_persona || 0;

  const saveBtn = document.getElementById("btn-guardar-extra");
  if (saveBtn) {
    saveBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cambios`;
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";
  form.scrollIntoView({ behavior: "smooth", block: "center" });
}

function cerrarFormExtra() {
  const form = document.getElementById("form-extra");
  const btn  = document.getElementById("btn-agregar-extra");
  if (form) form.style.display = "none";
  if (btn) btn.style.display = _esWorkerOAdminExtras() ? "" : "none";

  _extraEditandoId = null;
  _limpiarFormExtra();
}

function _limpiarFormExtra() {
  ["extra-id", "extra-nombre", "extra-descripcion", "extra-precio-venta", "extra-costo-fijo", "extra-costo-persona"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ""; el.classList.remove("error"); }
    });
}

async function guardarExtra() {
  if (!_esWorkerOAdminExtras()) return; // guarda extra, RLS igual lo bloquearía

  const nombre        = document.getElementById("extra-nombre")?.value.trim();
  const descripcion    = document.getElementById("extra-descripcion")?.value.trim() || null;
  const precio_venta   = parseInt(document.getElementById("extra-precio-venta")?.value) || 0;
  const costo_fijo     = parseInt(document.getElementById("extra-costo-fijo")?.value) || 0;
  const costo_por_persona = parseInt(document.getElementById("extra-costo-persona")?.value) || 0;

  let valido = true;
  if (!nombre) {
    document.getElementById("extra-nombre")?.classList.add("error");
    valido = false;
  }
  if (!precio_venta || precio_venta <= 0) {
    document.getElementById("extra-precio-venta")?.classList.add("error");
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById("btn-guardar-extra");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const payload = {
    viaje_id: parseInt(viajeActualId),
    nombre,
    descripcion,
    precio_venta,
    costo_fijo,
    costo_por_persona
  };

  let error;
  if (_extraEditandoId) {
    ({ error } = await supabaseClient
      .from("servicios_extra")
      .update(payload)
      .eq("id", _extraEditandoId));
  } else {
    ({ error } = await supabaseClient
      .from("servicios_extra")
      .insert([payload]));
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando servicio extra:", error);
    if (typeof showToast === "function") {
      showToast("Error al guardar el servicio extra", "error");
    } else {
      alert("Error al guardar el servicio extra");
    }
    return;
  }

  if (typeof showToast === "function") {
    showToast(_extraEditandoId ? "✅ Servicio extra actualizado" : "✅ Servicio extra agregado", "success");
  }

  cerrarFormExtra();
  loadExtras(viajeActualId);
}

async function eliminarExtra(id) {
  if (!_esWorkerOAdminExtras()) return;

  const servicio = _extrasData.find(s => String(s.id) === String(id));
  const nombre = servicio ? servicio.nombre : "este servicio extra";

  if (!confirm(`¿Eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;

  const { error } = await supabaseClient
    .from("servicios_extra")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Error eliminando servicio extra:", error);
    if (typeof showToast === "function") {
      showToast("Error al eliminar el servicio extra", "error");
    } else {
      alert("Error al eliminar el servicio extra");
    }
    return;
  }

  if (typeof showToast === "function") {
    showToast("Servicio extra eliminado", "success");
  }

  loadExtras(viajeActualId);
}

/* Utilidad local de escape — evita inyección HTML desde nombre/descripción */
function _escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
