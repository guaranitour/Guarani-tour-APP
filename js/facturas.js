/* ═══════════════════════════════════════════════════════════
   facturas.js — Vista "Facturas y tickets"

   admin/worker: cargan comprobantes (quedan en estado "pendiente").
   finanzas: solo puede marcarlos como "verificado" (no edita datos).
   Todos los roles habilitados (admin/worker/finanzas) pueden ver
   la lista agrupada por mes de fecha_emision.

   El archivo real (PDF/imagen) vive en Cloudflare R2, servido a
   través del Worker "facturas-storage". La tabla Supabase solo
   guarda la referencia (storage_key) + metadata + estado.
   ═══════════════════════════════════════════════════════════ */

// Reemplazar por la URL real del Worker una vez desplegado
// (ver DEPLOY.md del worker — dominio propio recomendado).
const FACTURAS_WORKER_URL = "https://storage.guaranitour.com";

let _facturasCache = [];          // última lista cargada desde Supabase
let _facturasFiltroEstado = "pendiente"; // tab inicial: "Sin verificar"
let _facturaFilePendiente = null; // File entre selección y confirmación del modal

function _rolesFacturas() {
  return Array.isArray(currentUserRole) ? currentUserRole : [currentUserRole];
}
function _puedeVerFacturas() {
  return _rolesFacturas().some(r => ["admin", "worker", "finanzas"].includes(r));
}
function _puedeCargarFacturas() {
  return _rolesFacturas().some(r => ["admin", "worker"].includes(r));
}
function _puedeVerificarFacturas() {
  return _rolesFacturas().includes("finanzas");
}

// ── Punto de entrada de la vista ────────────────────────────
async function loadFacturas() {
  if (!_puedeVerFacturas()) return; // guarda extra, RLS igual lo bloquearía

  const btnSubir = document.getElementById("btn-subir-factura");
  if (btnSubir) btnSubir.style.display = _puedeCargarFacturas() ? "" : "none";

  await _cargarFacturas();
}

async function _cargarFacturas() {
  const cont = document.getElementById("facturas-lista");
  if (!cont) return;

  cont.innerHTML = `<div class="fact-empty">Cargando…</div>`;

  const { data, error } = await supabaseClient
    .from("facturas_tickets")
    .select("id, storage_key, nombre_archivo, content_type, tamano_bytes, fecha_emision, monto, es_factura, estado, subido_por_email")
    .order("fecha_emision", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[facturas] error cargando comprobantes:", error);
    cont.innerHTML = `<div class="fact-empty">Error al cargar los comprobantes.</div>`;
    return;
  }

  _facturasCache = data || [];
  _renderFacturas();
}

function cambiarTabFacturas(estado) {
  _facturasFiltroEstado = estado;
  document.querySelectorAll("#view-facturas .informes-tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.estado === estado);
  });
  _renderFacturas();
}

// ── Render agrupado por mes de fecha_emision ────────────────
function _renderFacturas() {
  const cont = document.getElementById("facturas-lista");
  if (!cont) return;

  const items = _facturasCache.filter(f => f.estado === _facturasFiltroEstado);

  if (items.length === 0) {
    const mensaje = _facturasFiltroEstado === "verificado"
      ? "No hay comprobantes verificados."
      : "No hay comprobantes sin verificar.";
    cont.innerHTML = `<div class="fact-empty">${mensaje}</div>`;
    return;
  }

  const grupos = _agruparPorMes(items);
  cont.innerHTML = grupos.map(g => `
    <section class="fact-mes-grupo">
      <h2 class="fact-mes-titulo">
        <span>${g.etiqueta}</span>
        <span class="fact-mes-total">${_formatMontoFactura(g.total)}</span>
      </h2>
      <div class="fact-mes-items">
        ${g.items.map(_renderFacturaRow).join("")}
      </div>
    </section>
  `).join("");
}

// Agrupa por año-mes de fecha_emision y suma el monto de cada grupo.
// Ya viene ordenado desc (fecha_emision, created_at) desde la consulta,
// así que alcanza con particionar sin reordenar: dentro de cada mes
// queda la fecha más reciente arriba y la más antigua abajo.
function _agruparPorMes(items) {
  const grupos = [];
  const porClave = new Map();

  for (const item of items) {
    const clave = item.fecha_emision.slice(0, 7); // "YYYY-MM"
    if (!porClave.has(clave)) {
      const etiqueta = _formatMesAnio(item.fecha_emision);
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

function _formatMesAnio(fechaISO) {
  const f = new Date(fechaISO + "T00:00:00");
  const texto = f.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function _renderFacturaRow(item) {
  const esVerificado = item.estado === "verificado";
  const puedeVerificar = _puedeVerificarFacturas() && !esVerificado;
  // A finanzas no se le muestra el pill "Pendiente": el propio botón
  // "Verificar" ya le indica que la factura está sin verificar, y
  // mostrar ambos era redundante. El pill "Verificado" sí se mantiene
  // para todos los roles.
  const mostrarBadgeEstado = esVerificado || !_puedeVerificarFacturas();

  return `
  <div class="fact-row ${esVerificado ? "is-verificado" : "is-pendiente"}" role="button" tabindex="0" aria-label="Abrir comprobante" onclick="abrirFactura('${item.id}', this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); abrirFactura('${item.id}', this);}">
    <span class="fact-row-icon">${_iconoTipoArchivo(item.content_type)}</span>
    <div class="fact-row-info">
      <div class="fact-row-titulo">
        <span class="fact-tipo-badge ${item.es_factura ? "is-factura" : "is-ticket"}">${item.es_factura ? "Factura" : "Ticket"}</span>
        <span class="fact-row-monto">${_formatMontoFactura(item.monto)}</span>
      </div>
      <div class="fact-row-meta">
        ${_formatFechaEmisionCorta(item.fecha_emision)}
      </div>
    </div>
    ${mostrarBadgeEstado ? `
    <span class="fact-estado-badge ${esVerificado ? "is-verificado" : "is-pendiente"}">
      ${esVerificado ? "Verificado" : "Pendiente"}
    </span>` : ""}
    <div class="fact-row-actions">
      <button type="button" class="fact-btn-descargar" aria-label="Descargar comprobante" onclick="event.stopPropagation(); descargarFactura('${item.id}', this)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
      ${puedeVerificar ? `
      <button type="button" class="fact-btn-verificar" onclick="event.stopPropagation(); verificarFactura('${item.id}', this)">
        Verificar
      </button>` : ""}
    </div>
  </div>`;
}

function _iconoTipoArchivo(contentType) {
  if (contentType === "application/pdf") {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  }
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

function _formatMontoFactura(monto) {
  return new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(monto);
}

function _formatFechaEmisionCorta(fechaISO) {
  const f = new Date(fechaISO + "T00:00:00");
  return f.toLocaleDateString("es-PY", { day: "2-digit", month: "short" }).replace(".", "");
}

function _formatBytesFactura(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Abrir / descargar (vía Worker, no Supabase Storage) ─────
// Ambas acciones comparten el mismo fetch autenticado; solo cambia qué
// se hace con el blob resultante una vez que llega.
async function _obtenerBlobFactura(id) {
  const item = _facturasCache.find(f => String(f.id) === String(id));
  if (!item) return null;

  const jwt = await _facturasObtenerJwt();
  const res = await fetch(`${FACTURAS_WORKER_URL}/${encodeURIComponent(item.storage_key)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  return { blob: await res.blob(), item };
}

// Click en la fila: abre el comprobante en una pestaña nueva con el
// visor nativo del navegador (PDF o imagen), sin forzar descarga.
async function abrirFactura(id, rowEl) {
  if (rowEl) rowEl.setAttribute("aria-disabled", "true");

  try {
    const resultado = await _obtenerBlobFactura(id);
    if (!resultado) return;

    const url = URL.createObjectURL(resultado.blob);
    window.open(url, "_blank", "noopener");
    // Revocar después de un momento, dando tiempo a que la pestaña cargue el blob.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    console.error("[facturas] error abriendo comprobante:", err);
    _appToast("No se pudo abrir el comprobante", true);
  } finally {
    if (rowEl) rowEl.removeAttribute("aria-disabled");
  }
}

// Botón de descarga dentro de la fila (acción aditiva, no reemplaza
// el click de abrir): fuerza la descarga real vía un <a download>
// temporal — a diferencia de abrirFactura, esto nunca queda a criterio
// del visor del navegador.
async function descargarFactura(id, btnEl) {
  if (btnEl) btnEl.disabled = true;

  try {
    const resultado = await _obtenerBlobFactura(id);
    if (!resultado) return;

    const url = URL.createObjectURL(resultado.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = resultado.item.nombre_archivo || "comprobante";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (err) {
    console.error("[facturas] error descargando:", err);
    _appToast("No se pudo descargar el comprobante", true);
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
}

async function _facturasObtenerJwt() {
  const { data } = await supabaseClient.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Sesión no disponible");
  return token;
}

// ── Verificar (solo finanzas) ───────────────────────────────
async function verificarFactura(id, btnEl) {
  if (!_puedeVerificarFacturas()) return; // guarda extra, RLS/trigger igual lo bloquearía

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Verificando…"; }

  const { data: userData } = await supabaseClient.auth.getUser();

  const { error } = await supabaseClient
    .from("facturas_tickets")
    .update({
      estado: "verificado",
      verificado_por: userData?.user?.id || null,
      verificado_en: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[facturas] error verificando:", error);
    _appToast("No se pudo verificar el comprobante", true);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "Verificar"; }
    return;
  }

  _appToast("✅ Comprobante verificado");
  _cargarFacturas();
}

// ── Subir comprobante nuevo ──────────────────────────────────
// Flujo: elegir archivo → modal pidiendo fecha/monto/tipo → recién
// ahí se sube al Worker (R2) + se inserta la fila en Supabase.
function abrirModalFactura() {
  if (!_puedeCargarFacturas()) return;
  const input = document.getElementById("factura-file-input");
  if (input) input.click();
}

async function onArchivoFacturaSeleccionado(inputEl) {
  const file = inputEl.files?.[0];
  inputEl.value = ""; // permite volver a elegir el mismo archivo más adelante
  if (!file) return;

  if (!_puedeCargarFacturas()) return; // guarda extra, RLS igual lo bloquearía

  const TIPOS_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!TIPOS_PERMITIDOS.includes(file.type)) {
    _appToast("Solo se aceptan PDF o imágenes (JPG, PNG, WEBP)", true);
    return;
  }

  const MAX_BYTES = 15 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    _appToast("El archivo supera el tamaño máximo (15 MB)", true);
    return;
  }

  // Las imágenes (no el PDF, que no aplica) se convierten a WebP antes de
  // subir: mismo contenido visual, bastante menos peso en R2. Si algo falla
  // (navegador viejo, memoria, etc.) seguimos con el archivo original tal
  // cual — la carga nunca debe romperse por una optimización que no salió.
  const esImagenConvertible = file.type !== "application/pdf" && file.type !== "image/webp";
  const fileFinal = esImagenConvertible ? await _convertirImagenAWebp(file) : file;

  _facturaFilePendiente = fileFinal;
  _abrirModalDatosFactura(fileFinal);
}

// Convierte una imagen a WebP vía <canvas>. Devuelve un nuevo File con
// mismo nombre base pero extensión .webp, o el archivo original sin
// tocar si la conversión falla o no reduce el tamaño.
async function _convertirImagenAWebp(file) {
  try {
    const bitmap = await createImageBitmap(file);

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();

    const blob = await new Promise(resolve =>
      canvas.toBlob(resolve, "image/webp", 0.85)
    );
    if (!blob) return file; // navegador sin soporte de encoder webp en toBlob

    // Si por algún motivo el webp salió más pesado que el original
    // (raro, pero puede pasar con imágenes ya muy comprimidas), no
    // tiene sentido quedarse con la versión más grande.
    if (blob.size >= file.size) return file;

    const nombreBase = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${nombreBase}.webp`, { type: "image/webp" });
  } catch (err) {
    console.error("[facturas] no se pudo convertir a webp, se sube el original:", err);
    return file;
  }
}

function _abrirModalDatosFactura(file) {
  const modal = document.getElementById("factura-modal");
  const form = document.getElementById("factura-form");
  const nombreEl = document.getElementById("factura-modal-nombre-archivo");
  const fechaInput = document.getElementById("factura-fecha-input");
  if (!modal || !form) return;

  form.reset();
  if (nombreEl) nombreEl.textContent = file.name;
  // No tiene sentido registrar una emisión futura.
  if (fechaInput) fechaInput.max = new Date().toISOString().slice(0, 10);

  modal.showModal();
  fechaInput?.focus();
}

function cancelarCargaFactura() {
  const modal = document.getElementById("factura-modal");
  if (modal && modal.open) modal.close();
  _facturaFilePendiente = null;
}

async function confirmarCargaFactura(ev) {
  ev.preventDefault();

  const file = _facturaFilePendiente;
  const fechaEmision = document.getElementById("factura-fecha-input")?.value;
  const monto = document.getElementById("factura-monto-input")?.value;
  const tipoInput = document.querySelector('input[name="factura-tipo"]:checked');
  if (!file || !fechaEmision || !monto || !tipoInput) return; // required ya cubre el flujo normal

  const esFactura = tipoInput.value === "factura";

  const modal = document.getElementById("factura-modal");
  const btnConfirmar = document.getElementById("factura-modal-confirmar-btn");
  const btnSubir = document.getElementById("btn-subir-factura");

  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = "Subiendo…"; }
  if (btnSubir) btnSubir.disabled = true;

  try {
    // Path: año/mes/timestamp_nombre-saneado — coincide con la
    // agrupación por mes y evita colisiones de nombre.
    const [anio, mes] = fechaEmision.split("-");
    const nombreSaneado = file.name.replace(/[^\w.\-]+/g, "_");
    const storageKey = `${anio}/${mes}/${Date.now()}_${nombreSaneado}`;

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
      .from("facturas_tickets")
      .insert([{
        storage_key: storageKey,
        nombre_archivo: file.name,
        content_type: file.type,
        tamano_bytes: file.size,
        fecha_emision: fechaEmision,
        monto: Number(monto),
        es_factura: esFactura,
        subido_por: userData?.user?.id,
        subido_por_email: document.getElementById("user-email")?.textContent || userData?.user?.email || null,
      }]);

    if (insertError) {
      // El archivo ya quedó en R2 aunque falle el insert; se informa
      // igual para que el usuario no reintente y duplique el upload.
      console.error("[facturas] error registrando comprobante:", insertError);
      _appToast("El archivo se subió pero no se pudo registrar. Contactá a soporte.", true);
      return;
    }

    if (modal && modal.open) modal.close();
    _facturaFilePendiente = null;
    _appToast("✅ Comprobante cargado");
    _cargarFacturas();

  } catch (err) {
    console.error("[facturas] error subiendo comprobante:", err);
    _appToast("Error al subir el comprobante", true);
  } finally {
    if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = "Guardar comprobante"; }
    if (btnSubir) btnSubir.disabled = false;
  }
}

function _escapeHtmlFactura(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
