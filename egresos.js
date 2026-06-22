/* ─────────────────────────────────────────────
   egresos.js — Egresos por viaje + PDF historial
   Depende de: viajeActualId, currentUserRole,
   getMetodosPago(), navigateTo() (app.js)
───────────────────────────────────────────── */

async function uploadEgresoFile(file) {
  const fileName = `${viajeActualId}/${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("egresos")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("egresos")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

/* ── CREAR VIAJE ──────────────────────────── */

async function loadEgresos(viajeId) {
  const listEl = document.getElementById("egresos-list");
  const btnAdd = document.getElementById("btn-agregar-egreso");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);

  if (btnAdd) btnAdd.style.display = esWorkerOAdmin ? "" : "none";

  // Query principal de egresos
  const { data, error } = await supabaseClient
    .from("egresos")
    .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente")
    .eq("viaje_id", viajeId)
    .order("fecha", { ascending: false });

  if (error) {
    console.error("Error cargando egresos:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar egresos</div>`;
    return;
  }

  // Traer nombres de categorías (sin cache) y métodos desde cache global
  const [{ data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);
  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Sin egresos registrados
      </div>`;
    return;
  }

  const totalEgresos = data.reduce((s, e) => s + (e.monto || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row">
      <span class="egresos-total-label">Total egresos</span>
      <span class="egresos-total-valor">Gs. ${totalEgresos.toLocaleString("es-PY")}</span>
    </div>
    ${data.map(e => {
      const categoria = catMap[e.categoria_id] || "Sin categoría";
      const caja      = metMap[e.caja_saliente] || "—";
      const fecha     = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
      return `
  <div class="egreso-row" style="cursor:pointer"
       onclick="abrirEgresoDetalle('${e.id}', '${viajeId}')">
    <div class="egreso-info">
      <div class="egreso-concepto">${categoria}</div>
      <div class="egreso-fecha">${fecha}${e.ejecutor ? " · " + e.ejecutor : ""}</div>
    </div>
    <div style="display:flex;align-items:center;gap:.5rem">
      <div class="egreso-monto">Gs. ${(e.monto || 0).toLocaleString("es-PY")}</div>
      <span style="color:var(--text-muted);font-size:1.1rem">›</span>
    </div>
  </div>
`;    }).join("")}
  `;

  // Mover botón "Registrar egreso" justo después del total-row
  if (btnAdd) {
    const totalRow = listEl.querySelector(".egresos-total-row");
    if (totalRow) {
      btnAdd.style.marginTop = ".5rem";
      btnAdd.style.marginBottom = ".5rem";
      totalRow.after(btnAdd);
    }
  }
}

async function _cargarOpcionesFormEgreso() {
  // Categorías: solo las presupuestadas para este viaje + exclusivas del viaje
  // Siempre re-consultamos (el caché se invalida en mostrarFormEgreso)
  const [
    { data: presupuestadas },
    { data: exclusivas }
  ] = await Promise.all([
    // Categorías con presupuesto en este viaje (join con presupuesto_viaje)
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, categorias(id, nombre, scope)")
      .eq("viaje_id", parseInt(viajeActualId)),
    // Categorías exclusivas del viaje (scope = viajeActualId), aunque no estén presupuestadas
    supabaseClient
      .from("categorias")
      .select("id, nombre, scope")
      .eq("scope", parseInt(viajeActualId))
      .order("nombre", { ascending: true })
  ]);

  // Armar lista deduplicada
  const vistos = new Set();
  _egresosCategorias = [];

  (presupuestadas || []).forEach(row => {
    const c = row.categorias;
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });
  (exclusivas || []).forEach(c => {
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });

  // Ordenar alfabéticamente
  _egresosCategorias.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Métodos de pago (caja saliente) — desde caché global
  const metodosList = await getMetodosPago();
  _egresosMetodos = metodosList;

  const selCat = document.getElementById("egreso-categoria");
  const selCaja = document.getElementById("egreso-caja");

  if (selCat) {
    const opcionesCats = _egresosCategorias.length > 0
      ? _egresosCategorias.map(c => {
          const label = c.scope ? `${c.nombre} (exclusiva)` : c.nombre;
          return `<option value="${c.id}">${label}</option>`;
        }).join("")
      : "";

    selCat.innerHTML =
      `<option value="">— Seleccionar categoría —</option>` +
      opcionesCats +
      `<option value="__nuevo__">+ Otro tipo…</option>`;

    // Mostrar/ocultar input de nueva categoría al cambiar
    selCat.onchange = () => _toggleNuevaCategoriaInput(selCat.value === "__nuevo__");
  }

  if (selCaja) {
    selCaja.innerHTML = `<option value="">— Seleccionar caja —</option>` +
      _egresosMetodos.map(m => `<option value="${m.id}">${m.metodo_de_pago}</option>`).join("");
  }
}

function _toggleNuevaCategoriaInput(mostrar) {
  let wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (mostrar) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "egreso-nueva-cat-wrap";
      wrap.style.cssText = "margin-top:.5rem";
      wrap.innerHTML = `
        <input id="egreso-nueva-cat-nombre" class="form-input"
               type="text" placeholder="Nombre del nuevo tipo de egreso" />
      `;
      document.getElementById("egreso-categoria").after(wrap);
    }
    wrap.style.display = "";
    document.getElementById("egreso-nueva-cat-nombre")?.focus();
  } else if (wrap) {
    wrap.style.display = "none";
  }
}

async function mostrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (!form) return;

  // Fecha de hoy por defecto
  const fechaEl = document.getElementById("egreso-fecha");
  if (fechaEl && !fechaEl.value) {
    fechaEl.value = new Date().toISOString().split("T")[0];
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";

  // Invalidar caché si cambiamos de viaje
  _egresosCategorias = [];
  await _cargarOpcionesFormEgreso();
}

function cerrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (form) form.style.display = "none";
  if (btn) {
    const esWorkerOAdmin = Array.isArray(currentUserRole)
      ? currentUserRole.some(r => ["admin", "worker"].includes(r))
      : ["admin", "worker"].includes(currentUserRole);
    btn.style.display = esWorkerOAdmin ? "" : "none";
  }

  ["egreso-categoria", "egreso-monto", "egreso-fecha", "egreso-descripcion", "egreso-ejecutor", "egreso-caja", "egreso-archivo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Limpiar input de nueva categoría si quedó visible
  const wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (wrap) wrap.remove();
}

async function guardarEgreso() {
  let categoriaSelVal = document.getElementById("egreso-categoria")?.value;
  const monto        = parseInt(document.getElementById("egreso-monto")?.value);
  const fecha        = document.getElementById("egreso-fecha")?.value || null;
  const descripcion  = document.getElementById("egreso-descripcion")?.value.trim() || null;
  const ejecutor     = document.getElementById("egreso-ejecutor")?.value.trim();
  const cajaId       = document.getElementById("egreso-caja")?.value;
  const archivo      = document.getElementById("egreso-archivo")?.files[0];
  const nuevaCatNombre = document.getElementById("egreso-nueva-cat-nombre")?.value.trim();

  // Validaciones
  let valido = true;
  if (!categoriaSelVal) {
    document.getElementById("egreso-categoria")?.classList.add("error");
    valido = false;
  }
  if (categoriaSelVal === "__nuevo__" && !nuevaCatNombre) {
    document.getElementById("egreso-nueva-cat-nombre")?.classList.add("error");
    valido = false;
  }
  if (!monto || monto <= 0) {
    document.getElementById("egreso-monto")?.classList.add("error");
    valido = false;
  }
  if (!fecha) {
    document.getElementById("egreso-fecha")?.classList.add("error");
    valido = false;
  }
  if (!ejecutor) {
    document.getElementById("egreso-ejecutor")?.classList.add("error");
    valido = false;
  }
  if (!cajaId) {
    document.getElementById("egreso-caja")?.classList.add("error");
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById("btn-guardar-egreso");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  // Si eligió "+ Otro tipo…", crear la categoría exclusiva del viaje primero
  let categoriaId = categoriaSelVal;
  if (categoriaSelVal === "__nuevo__") {
    const { data: nuevaCat, error: errCat } = await supabaseClient
      .from("categorias")
      .insert([{ nombre: nuevaCatNombre, scope: parseInt(viajeActualId) }])
      .select("id")
      .single();

    if (errCat || !nuevaCat) {
      console.error("Error creando categoría:", errCat);
      alert("Error al crear el tipo de egreso. Intentá de nuevo.");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
    categoriaId = nuevaCat.id;
    // Invalidar caché de categorías para que la próxima apertura del form la muestre
    _egresosCategorias = [];
  }

  const { data: { user } } = await supabaseClient.auth.getUser();

  let comprobante_url = null;

  if (archivo) {
    try {
      comprobante_url = await uploadEgresoFile(archivo);
    } catch (e) {
      console.error(e);
      alert("Error subiendo comprobante");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("egresos")
    .insert([{
      viaje_id: viajeActualId,
      categoria_id: categoriaId,
      monto,
      descripcion,
      fecha,
      ejecutor,
      caja_saliente: cajaId,
      comprobante_nro: comprobante_url,
      creado_por: user?.email || null
    }]);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando egreso:", error);
    alert("Error al guardar el egreso. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormEgreso();
  loadEgresos(viajeActualId);
}

/* ── EGRESO DETALLE ────────────────────────── */

function abrirEgresoDetalle(egresoId, viajeId) {
  navigateTo("egreso-detalle", { egresoId, viajeId });
}

async function initEgresoDetalleView({ egresoId, viajeId }) {
  const cont = document.getElementById("egreso-detalle-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  // Query egreso + categorías + métodos en paralelo
  const [{ data: e, error }, { data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("egresos")
      .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente, comprobante_nro")
      .eq("id", egresoId)
      .single(),
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);

  if (error || !e) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar el egreso.</div>`;
    return;
  }

  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

  const categoria  = catMap[e.categoria_id] || "Sin categoría";
  const caja       = metMap[e.caja_saliente] || "—";
  const fecha      = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
  const monto      = (e.monto || 0).toLocaleString("es-PY");
  const descripcion = e.descripcion || "—";
  const ejecutor   = e.ejecutor || "—";
  const creadoPor  = e.creado_por || "—";

  const comprobanteHtml = e.comprobante_nro
    ? `<a href="${e.comprobante_nro}" target="_blank" class="egreso-det-comprobante">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Ver comprobante
      </a>`
    : `<span class="egreso-det-sin-comprobante">Sin comprobante adjunto</span>`;

  cont.innerHTML = `
    <div class="egreso-det-monto-hero">
      <span class="egreso-det-monto-label">Monto</span>
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
          <span class="egreso-det-label">Categoría</span>
          <span class="egreso-det-value">${categoria}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Fecha</span>
          <span class="egreso-det-value">${fecha}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Caja saliente</span>
          <span class="egreso-det-value">${caja}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Ejecutor</span>
          <span class="egreso-det-value">${ejecutor}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Descripción</span>
          <span class="egreso-det-value">${descripcion}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Registrado por</span>
          <span class="egreso-det-value">${creadoPor}</span>
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

// ── Generador de Historial de Pagos PDF ──────────────────────────────────────
const APPS_SCRIPT_PDF_URL = "https://script.google.com/macros/s/AKfycbzal5GP399HgePINzuV7ifuSl_N5wiLGfkurCQ2XbMtdX4BaCJFb9PetaS3Qn6VHGFn/exec";

async function generarHistorialPDF(event, vpId, nombrePasajero) {
  event.stopPropagation();

  const btn = event.currentTarget;
  btn.disabled = true;
  btn.classList.add("btn-pdf-loading");

  try {
    // 1. Datos del viaje_pasajero
    const { data: vp, error: vpErr } = await supabaseClient
      .from("viaje_pasajeros")
      .select("total_a_pagar")
      .eq("id", parseInt(vpId))
      .single();

    if (vpErr || !vp) throw new Error("No se pudo obtener datos del pasajero.");

    // 2. Pagos + bancos en paralelo
    const [{ data: pagos, error: pgErr }, { data: bancosData }] = await Promise.all([
      supabaseClient
        .from("pagos")
        .select("monto, tipo, fecha_pago, banco, comprobante_nro")
        .eq("viaje_pasajero_id", parseInt(vpId))
        .order("fecha_pago", { ascending: true }),
      supabaseClient
        .from("bancos")
        .select("id, banco_id"),
    ]);

    if (pgErr) throw new Error("No se pudo obtener el historial de pagos.");

    const bancosMap = Object.fromEntries(
      (bancosData || []).map(b => [String(b.id), b.banco_id])
    );

    const listaPagos     = pagos || [];
    const pagosReales    = listaPagos.filter(p => p.tipo === "Pago");
    const devoluciones   = listaPagos.filter(p => p.tipo === "Devolución");
    const transferencias = listaPagos.filter(p => p.tipo === "Transferencia");

    const sumaPagado  = pagosReales.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaDevuelto = devoluciones.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaTransf  = transferencias.reduce((s, p) => s + (p.monto || 0), 0);
    const neto        = sumaPagado - sumaDevuelto - sumaTransf;
    const total       = vp.total_a_pagar || 0;
    const saldo       = Math.max(0, total - neto);

    const formatFechaLocal = (fechaStr) => {
      if (!fechaStr) return "—";
      const d = new Date(fechaStr + "T00:00:00");
      return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    // 3. Armar payload para Apps Script
    const payload = {
      pasajero : nombrePasajero,
      viaje    : viajeActualData?.nombre || "—",
      total    : total,
      suma     : neto,
      saldo    : saldo,
      pagos    : listaPagos.map(p => ({
        fecha       : formatFechaLocal(p.fecha_pago),
        banco       : bancosMap[String(p.banco)] || "—",
        comprobante : p.comprobante_nro || "—",
        monto       : (p.tipo === "Devolución" || p.tipo === "Transferencia")
                        ? -Math.abs(p.monto || 0)
                        : (p.monto || 0)
      }))
    };

    // 4. Llamar al Apps Script
    const response = await fetch(APPS_SCRIPT_PDF_URL, {
      method : "POST",
      body   : JSON.stringify(payload)
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Error en Apps Script");

    // 5. Descargar el PDF
    const byteChars = atob(result.pdf);
    const byteArray = new Uint8Array([...byteChars].map(c => c.charCodeAt(0)));
    const blob      = new Blob([byteArray], { type: "application/pdf" });
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement("a");
    a.href          = url;
    a.download      = `Historial_${nombrePasajero.replace(/\s+/g, "_")}_${(viajeActualData?.nombre || "viaje").replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Error generando PDF:", err);
    alert("No se pudo generar el PDF: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-pdf-loading");
  }
}
