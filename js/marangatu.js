/* ═══════════════════════════════════════════════════════════
   marangatu.js — Vista "Facturas Marangatu"

   Facturación electrónica registrada en la SET. A diferencia de
   facturas.js (comprobantes internos), acá NO hay flujo de estado
   pendiente/verificado: solo carga y listado.

   admin/finanzas: cargan las facturas (PDF).
   admin/worker/finanzas: pueden ver la lista agrupada por mes.
   worker NO carga acá (al revés que en facturas internas).

   El archivo real (PDF) vive en el mismo Cloudflare R2 que las
   facturas internas, servido por el mismo Worker "facturas-storage"
   (ver FACTURAS_WORKER_URL en facturas.js). Se separa únicamente por
   prefijo de path ("marangatu/…") para no mezclarlas visualmente en
   el bucket.
   ═══════════════════════════════════════════════════════════ */

let _marangatuCache = [];          // última lista cargada desde Supabase
let _marangatuFilePendiente = null; // File entre selección y confirmación del modal
let _marangatuFiltroPeriodo = "actual"; // tab inicial: "Actual" (mes en curso)

function _rolesMarangatu() {
  return Array.isArray(currentUserRole) ? currentUserRole : [currentUserRole];
}
function _puedeVerMarangatu() {
  return _rolesMarangatu().some(r => ["admin", "worker", "finanzas"].includes(r));
}
function _puedeCargarMarangatu() {
  return _rolesMarangatu().some(r => ["admin", "finanzas"].includes(r));
}

// ── Punto de entrada de la vista ────────────────────────────
async function loadMarangatu() {
  if (!_puedeVerMarangatu()) return; // guarda extra, RLS igual lo bloquearía

  const btnSubir = document.getElementById("btn-subir-marangatu");
  if (btnSubir) btnSubir.style.display = _puedeCargarMarangatu() ? "" : "none";

  await _cargarMarangatu();
}

async function _cargarMarangatu() {
  const cont = document.getElementById("marangatu-lista");
  if (!cont) return;

  cont.innerHTML = `<div class="fact-empty">Cargando…</div>`;

  const { data, error } = await supabaseClient
    .from("facturas_marangatu")
    .select("id, storage_key, nombre_archivo, content_type, tamano_bytes, fecha_emision, monto, numero_factura, subido_por_email")
    .order("fecha_emision", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[marangatu] error cargando facturas:", error);
    cont.innerHTML = `<div class="fact-empty">Error al cargar las facturas.</div>`;
    return;
  }

  _marangatuCache = data || [];
  _renderMarangatu();
}

function cambiarTabMarangatu(periodo) {
  _marangatuFiltroPeriodo = periodo;
  document.querySelectorAll("#view-facturas-marangatu .informes-tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.periodo === periodo);
  });
  _renderMarangatu();
}

// "Actual" = mes en curso según fecha_emision; "Histórico" = todo lo
// anterior. Se compara como string "YYYY-MM" para evitar líos de
// huso horario con new Date().
function _mesActualMarangatu() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
}

// ── Render agrupado por mes de fecha_emision ────────────────
// Idéntico criterio de agrupación que facturas.js (mismo formato
// visual, mismas clases .fact-mes-*), pero sin badge de estado ni
// botón "Verificar" en cada fila.
function _renderMarangatu() {
  const cont = document.getElementById("marangatu-lista");
  if (!cont) return;

  const mesActual = _mesActualMarangatu();
  const items = _marangatuCache.filter(f => {
    const esMesActual = f.fecha_emision.slice(0, 7) === mesActual;
    return _marangatuFiltroPeriodo === "actual" ? esMesActual : !esMesActual;
  });

  if (items.length === 0) {
    const mensaje = _marangatuFiltroPeriodo === "actual"
      ? "No hay facturas cargadas este mes."
      : "No hay facturas históricas.";
    cont.innerHTML = `<div class="fact-empty">${mensaje}</div>`;
    return;
  }

  const grupos = _agruparPorMesMarangatu(items);
  cont.innerHTML = grupos.map(g => `
    <section class="fact-mes-grupo">
      <h2 class="fact-mes-titulo">
        <span>${g.etiqueta}</span>
        <span class="fact-mes-total">${_formatMontoMarangatu(g.total)}</span>
      </h2>
      <div class="fact-mes-items">
        ${g.items.map(_renderMarangatuRow).join("")}
      </div>
    </section>
  `).join("");
}

function _agruparPorMesMarangatu(items) {
  const grupos = [];
  const porClave = new Map();

  for (const item of items) {
    const clave = item.fecha_emision.slice(0, 7); // "YYYY-MM"
    if (!porClave.has(clave)) {
      const etiqueta = _formatMesAnioMarangatu(item.fecha_emision);
      const grupo = { clave, etiqueta, items: [], total: 0 };
      porClave.set(clave, grupo);
      grupos.push(grupo);
    }
    const grupo = porClave.get(clave);
    grupo.items.push(item);
    grupo.total += Number(item.monto) || 0;
  }

  return grupos;
}

function _formatMesAnioMarangatu(fechaISO) {
  const f = new Date(fechaISO + "T00:00:00");
  const texto = f.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function _renderMarangatuRow(item) {
  return `
  <div class="fact-row" role="button" tabindex="0" aria-label="Abrir factura" onclick="abrirMarangatu('${item.id}', this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); abrirMarangatu('${item.id}', this);}">
    <span class="fact-row-icon">${_iconoMarangatu()}</span>
    <div class="fact-row-info">
      <div class="fact-row-titulo">
        <span class="fact-row-monto">${_formatMontoMarangatu(item.monto)}</span>
      </div>
      <div class="fact-row-meta">
        ${_formatFechaEmisionCortaMarangatu(item.fecha_emision)}${item.numero_factura ? ` · ${_escapeHtmlMarangatu(item.numero_factura)}` : ""}
      </div>
    </div>
    <div class="fact-row-actions">
      <button type="button" class="fact-btn-descargar" aria-label="Descargar factura" onclick="event.stopPropagation(); descargarMarangatu('${item.id}', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>
  </div>`;
}

function _iconoMarangatu() {
  // Marangatu siempre es PDF (confirmado): sin rama de ícono de imagen.
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
}

function _formatMontoMarangatu(monto) {
  return new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(monto);
}

function _formatFechaEmisionCortaMarangatu(fechaISO) {
  const f = new Date(fechaISO + "T00:00:00");
  return f.toLocaleDateString("es-PY", { day: "2-digit", month: "short" }).replace(".", "");
}

// ── Abrir / descargar (vía el mismo Worker que facturas internas) ──
async function _obtenerBlobMarangatu(id) {
  const item = _marangatuCache.find(f => String(f.id) === String(id));
  if (!item) return null;

  const jwt = await _facturasObtenerJwt(); // reutiliza el helper de facturas.js
  const res = await fetch(`${FACTURAS_WORKER_URL}/${encodeURIComponent(item.storage_key)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return { blob: await res.blob(), item };
}

async function abrirMarangatu(id, rowEl) {
  if (rowEl) rowEl.setAttribute("aria-disabled", "true");

  try {
    const resultado = await _obtenerBlobMarangatu(id);
    if (!resultado) return;

    const url = URL.createObjectURL(resultado.blob);
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    console.error("[marangatu] error abriendo factura:", err);
    _appToast("No se pudo abrir la factura", true);
  } finally {
    if (rowEl) rowEl.removeAttribute("aria-disabled");
  }
}

async function descargarMarangatu(id, btnEl) {
  if (btnEl) btnEl.disabled = true;

  try {
    const resultado = await _obtenerBlobMarangatu(id);
    if (!resultado) return;

    const url = URL.createObjectURL(resultado.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resultado.item.nombre_archivo || "factura";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    console.error("[marangatu] error descargando:", err);
    _appToast("No se pudo descargar la factura", true);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

// ── Subir factura nueva ──────────────────────────────────────
// Flujo idéntico al de facturas internas: elegir archivo → modal
// pidiendo fecha/monto/nro (opcional) → recién ahí se sube al Worker
// (R2) + se inserta la fila en Supabase. Sin conversión a WebP acá:
// Marangatu solo acepta PDF.
function abrirModalMarangatu() {
  if (!_puedeCargarMarangatu()) return;
  const input = document.getElementById("marangatu-file-input");
  if (input) input.click();
}

async function onArchivoMarangatuSeleccionado(inputEl) {
  const file = inputEl.files?.[0];
  inputEl.value = ""; // permite volver a elegir el mismo archivo más adelante
  if (!file) return;

  if (!_puedeCargarMarangatu()) return; // guarda extra, RLS igual lo bloquearía

  if (file.type !== "application/pdf") {
    _appToast("Solo se aceptan archivos PDF", true);
    return;
  }

  const MAX_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    _appToast("El archivo supera el tamaño máximo (15 MB)", true);
    return;
  }

  _marangatuFilePendiente = file;
  _abrirModalDatosMarangatu(file);
}

function _abrirModalDatosMarangatu(file) {
  const modal = document.getElementById("marangatu-modal");
  const form = document.getElementById("marangatu-form");
  const nombreEl = document.getElementById("marangatu-modal-nombre-archivo");
  const fechaInput = document.getElementById("marangatu-fecha-input");
  if (!modal || !form) return;

  form.reset();
  if (nombreEl) nombreEl.textContent = file.name;
  // No tiene sentido registrar una emisión futura.
  if (fechaInput) fechaInput.max = new Date().toISOString().slice(0, 10);

  modal.showModal();
  fechaInput?.focus();
}

function cancelarCargaMarangatu() {
  const modal = document.getElementById("marangatu-modal");
  if (modal && modal.open) modal.close();
  _marangatuFilePendiente = null;
}

async function confirmarCargaMarangatu(ev) {
  ev.preventDefault();

  const file = _marangatuFilePendiente;
  const fechaEmision = document.getElementById("marangatu-fecha-input")?.value;
  const monto = document.getElementById("marangatu-monto-input")?.value;
  const numeroFactura = document.getElementById("marangatu-numero-input")?.value?.trim() || null;
  if (!file || !fechaEmision || !monto) return; // required ya cubre el flujo normal

  const modal = document.getElementById("marangatu-modal");
  const btnConfirmar = document.getElementById("marangatu-modal-confirmar-btn");
  const btnSubir = document.getElementById("btn-subir-marangatu");

  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = "Subiendo…"; }
  if (btnSubir) btnSubir.disabled = true;

  try {
    // Prefijo "marangatu/" para separarlas de las internas dentro del
    // mismo bucket R2, sin necesidad de otro Worker.
    const [anio, mes] = fechaEmision.split("-");
    const nombreSaneado = file.name.replace(/[^\w.\-]+/g, "_");
    const storageKey = `marangatu/${anio}/${mes}/${Date.now()}_${nombreSaneado}`;

    const jwt = await _facturasObtenerJwt();
    const uploadRes = await fetch(`${FACTURAS_WORKER_URL}/${encodeURIComponent(storageKey)}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": file.type,
      },
      body: file,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${uploadRes.status}`);
    }

    const { data: userData } = await supabaseClient.auth.getUser();

    const { error: insertError } = await supabaseClient
      .from("facturas_marangatu")
      .insert([{
        storage_key: storageKey,
        nombre_archivo: file.name,
        content_type: file.type,
        tamano_bytes: file.size,
        fecha_emision: fechaEmision,
        monto: Number(monto),
        numero_factura: numeroFactura,
        subido_por: userData?.user?.id,
        subido_por_email: document.getElementById("user-email")?.textContent || userData?.user?.email || null,
      }]);

    if (insertError) {
      // El archivo ya quedó en R2 aunque falle el insert; se informa
      // igual para que el usuario no reintente y duplique el upload.
      console.error("[marangatu] error registrando factura:", insertError);
      _appToast("El archivo se subió pero no se pudo registrar. Contactá a soporte.", true);
      return;
    }

    if (modal && modal.open) modal.close();
    _marangatuFilePendiente = null;
    _appToast("✅ Factura cargada");
    _cargarMarangatu();

  } catch (err) {
    console.error("[marangatu] error subiendo factura:", err);
    _appToast("Error al subir la factura", true);
  } finally {
    if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = "Guardar factura"; }
    if (btnSubir) btnSubir.disabled = false;
  }
}

function _escapeHtmlMarangatu(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
