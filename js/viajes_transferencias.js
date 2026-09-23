// ══════════════════════════════════════════════════════════════════════
//  TRANSFERENCIAS INTERNAS (entre staff)
//  Mismo patrón que viajes_egresos.js: archivo separado, cargado junto
//  a viajes_activos.js en index.html.
//
//  Registra cuando un miembro del staff le pasa plata a otro dentro del
//  contexto de un viaje (ej. alguien cobra en efectivo y le transfiere
//  la parte a otro vendedor). No es un cobro a pasajero: no toca la
//  tabla "pagos" ni el resumen de recaudación del viaje.
//
//  Dependencias globales (definidas en otros scripts, cargados antes en
//  index.html): supabaseClient, currentUserRole, viajeActualId,
//  navigateTo().
// ══════════════════════════════════════════════════════════════════════

/* ── TRANSFERENCIAS INTERNAS ───────────────── */

// Caché para el select de staff del form
let _transfStaffList  = [];
let _transfLoadToken  = 0; // Descarta respuestas tardías de un viaje distinto al que se está viendo

async function loadTransferencias(viajeId) {
  const miToken = ++_transfLoadToken;
  const listEl = document.getElementById("transferencias-list");
  const btnAdd = document.getElementById("btn-agregar-transferencia");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);

  if (btnAdd) btnAdd.style.display = esWorkerOAdmin ? "" : "none";

  // Query principal de transferencias
  const { data, error } = await supabaseClient
    .from("transferencias_internas")
    .select("id, monto, nota, fecha, de_staff, a_staff, creado_por, comprobante_url")
    .eq("viaje_id", viajeId)
    .order("fecha", { ascending: false });

  // Si mientras esperábamos esta respuesta el usuario ya cambió de viaje
  // (o volvió a entrar a este mismo tab, dos veces seguidas), esta
  // respuesta quedó obsoleta: no pisar la vista con datos de otro viaje.
  if (miToken !== _transfLoadToken) return;
  if (viajeId !== viajeActualId) return;

  if (error) {
    console.error("Error cargando transferencias internas:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar transferencias</div>`;
    return;
  }

  // Nombres de staff (sin cache, igual que categorías en egresos)
  const { data: staffData } = await supabaseClient
    .from("staff")
    .select("id, nombre");

  if (miToken !== _transfLoadToken) return;
  if (viajeId !== viajeActualId) return;

  const staffMap = Object.fromEntries((staffData || []).map(s => [s.id, s.nombre]));

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
        Sin transferencias registradas
      </div>`;
    return;
  }

  const totalTransferencias = data.reduce((s, t) => s + (t.monto || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row">
      <span class="egresos-total-label">Total transferido</span>
      <span class="egresos-total-valor">Gs. ${totalTransferencias.toLocaleString("es-PY")}</span>
    </div>
    ${data.map(t => {
      const de     = staffMap[t.de_staff] || "—";
      const a      = staffMap[t.a_staff]  || "—";
      const fecha  = t.fecha ? t.fecha.split("T")[0].split("-").reverse().join("/") : "—";
      return `
  <div class="egreso-row" style="cursor:pointer"
       onclick="abrirTransferenciaDetalle('${t.id}', '${viajeId}')">
    <div class="egreso-info">
      <div class="egreso-concepto">${de} → ${a}</div>
      <div class="egreso-fecha">${fecha}</div>
    </div>
    <div style="display:flex;align-items:center;gap:.5rem">
      <div class="egreso-monto">Gs. ${(t.monto || 0).toLocaleString("es-PY")}</div>
      <span style="color:var(--text-muted);font-size:1.1rem">›</span>
    </div>
  </div>
`;    }).join("")}
  `;

  // Mover botón "Registrar transferencia" justo después del total-row
  if (btnAdd) {
    const totalRow = listEl.querySelector(".egresos-total-row");
    if (totalRow) {
      btnAdd.style.marginTop = ".5rem";
      btnAdd.style.marginBottom = ".5rem";
      totalRow.after(btnAdd);
    }
  }
}

async function _cargarOpcionesFormTransferencia() {
  // Staff habilitado, para los selects "De" y "A" — siempre re-consultado
  const { data: staffData } = await supabaseClient
    .from("staff")
    .select("id, nombre")
    .eq("status", "enabled")
    .order("nombre", { ascending: true });

  _transfStaffList = staffData || [];

  const selDe = document.getElementById("transferencia-de");
  const selA  = document.getElementById("transferencia-a");

  const opciones = _transfStaffList.map(s => `<option value="${s.id}">${s.nombre}</option>`).join("");

  if (selDe) {
    selDe.innerHTML = `<option value="">— Seleccionar —</option>` + opciones;
  }
  if (selA) {
    selA.innerHTML = `<option value="">— Seleccionar —</option>` + opciones;
  }

  // Inicializar custom selects (idempotente: se refresca si ya existe)
  initCustomSelect("transferencia-de");
  initCustomSelect("transferencia-a");
}

async function mostrarFormTransferencia() {
  const form = document.getElementById("form-nueva-transferencia");
  const btn  = document.getElementById("btn-agregar-transferencia");
  if (!form) return;

  // Fecha de hoy por defecto
  const fechaEl = document.getElementById("transferencia-fecha");
  if (fechaEl && !fechaEl.value) {
    fechaEl.value = new Date().toISOString().split("T")[0];
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";

  await _cargarOpcionesFormTransferencia();
}

function cerrarFormTransferencia() {
  const form = document.getElementById("form-nueva-transferencia");
  const btn  = document.getElementById("btn-agregar-transferencia");
  if (form) form.style.display = "none";
  if (btn) {
    const esWorkerOAdmin = Array.isArray(currentUserRole)
      ? currentUserRole.some(r => ["admin", "worker"].includes(r))
      : ["admin", "worker"].includes(currentUserRole);
    btn.style.display = esWorkerOAdmin ? "" : "none";
  }

  ["transferencia-de", "transferencia-a", "transferencia-monto", "transferencia-fecha", "transferencia-nota", "transferencia-archivo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
    el?.classList.remove("error");
  });
}

async function uploadTransferenciaFile(file) {
  const fileName = `${viajeActualId}/${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("transferencias")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("transferencias")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

async function guardarTransferencia() {
  const deStaff   = document.getElementById("transferencia-de")?.value;
  const aStaff    = document.getElementById("transferencia-a")?.value;
  const monto     = parseInt(document.getElementById("transferencia-monto")?.value);
  const fecha     = document.getElementById("transferencia-fecha")?.value || null;
  const nota      = document.getElementById("transferencia-nota")?.value.trim() || null;
  const archivo   = document.getElementById("transferencia-archivo")?.files[0];

  // Validaciones
  let valido = true;
  if (!deStaff) {
    document.getElementById("transferencia-de")?.classList.add("error");
    valido = false;
  }
  if (!aStaff) {
    document.getElementById("transferencia-a")?.classList.add("error");
    valido = false;
  }
  if (deStaff && aStaff && deStaff === aStaff) {
    document.getElementById("transferencia-a")?.classList.add("error");
    alert("El staff de origen y destino no pueden ser el mismo.");
    valido = false;
  }
  if (!monto || monto <= 0) {
    document.getElementById("transferencia-monto")?.classList.add("error");
    valido = false;
  }
  if (!fecha) {
    document.getElementById("transferencia-fecha")?.classList.add("error");
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById("btn-guardar-transferencia");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { data: { user } } = await supabaseClient.auth.getUser();

  let comprobante_url = null;

  if (archivo) {
    try {
      comprobante_url = await uploadTransferenciaFile(archivo);
    } catch (e) {
      console.error(e);
      alert("Error subiendo comprobante");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("transferencias_internas")
    .insert([{
      viaje_id: viajeActualId,
      de_staff: deStaff,
      a_staff: aStaff,
      monto,
      fecha,
      nota,
      comprobante_url,
      creado_por: user?.email || null
    }]);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando transferencia interna:", error);
    alert("Error al guardar la transferencia. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormTransferencia();
  loadTransferencias(viajeActualId);
}

/* ── TRANSFERENCIA DETALLE ─────────────────── */

function abrirTransferenciaDetalle(transferenciaId, viajeId) {
  navigateTo("transferencia-detalle", { transferenciaId, viajeId });
}

async function initTransferenciaDetalleView({ transferenciaId, viajeId }) {
  const cont = document.getElementById("transferencia-detalle-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const [{ data: t, error }, { data: staffData }] = await Promise.all([
    supabaseClient.from("transferencias_internas")
      .select("id, monto, nota, fecha, de_staff, a_staff, creado_por, comprobante_url")
      .eq("id", transferenciaId)
      .single(),
    supabaseClient.from("staff").select("id, nombre")
  ]);

  if (error || !t) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar la transferencia.</div>`;
    return;
  }

  const staffMap = Object.fromEntries((staffData || []).map(s => [s.id, s.nombre]));

  const de        = staffMap[t.de_staff] || "—";
  const a         = staffMap[t.a_staff]  || "—";
  const fecha     = t.fecha ? t.fecha.split("T")[0].split("-").reverse().join("/") : "—";
  const monto     = (t.monto || 0).toLocaleString("es-PY");
  const nota      = t.nota || "—";
  const creadoPor = t.creado_por || "—";

  const comprobanteHtml = t.comprobante_url
    ? `<a href="${t.comprobante_url}" target="_blank" class="egreso-det-comprobante">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Ver comprobante
      </a>`
    : `<span class="egreso-det-sin-comprobante">Sin comprobante adjunto</span>`;

  cont.innerHTML = `
    <div class="egreso-det-monto-hero">
      <span class="egreso-det-monto-label">Monto transferido</span>
      <span class="egreso-det-monto-valor">Gs. ${monto}</span>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Información
      </div>
      <div class="egreso-det-grid">
        <div class="egreso-det-field">
          <span class="egreso-det-label">De</span>
          <span class="egreso-det-value">${de}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">A</span>
          <span class="egreso-det-value">${a}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Fecha</span>
          <span class="egreso-det-value">${fecha}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Registrado por</span>
          <span class="egreso-det-value">${creadoPor}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Nota</span>
          <span class="egreso-det-value">${nota}</span>
        </div>
      </div>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Comprobante
      </div>
      ${comprobanteHtml}
    </div>
  `;
}
