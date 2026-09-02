/* ═══════════════════════════════════════════════════════════
   legales.js — Vista "Legales"
   Solo admin/worker (ver + insertar/actualizar).

   Dos fuentes de datos independientes:
   1) Contenido institucional (Misión/Visión/Valores/etc.) — viene de
      un Google Doc vía Apps Script, en un único string HTML con
      <h1>Título</h1><p>...</p><p>...</p><h1>Otro título</h1>...
      Se parsea acá mismo para armar N secciones colapsables dinámicas
      (el número y orden de secciones lo decide el doc, no el código).
   2) Documentos de asamblea — tabla legales_documentos + Supabase
      Storage (bucket privado "legales-docs", URL firmada on-demand).
   ═══════════════════════════════════════════════════════════ */

// Reemplazar por la URL real de despliegue del Apps Script si cambia.
const LEGALES_DOC_URL = "https://script.google.com/macros/s/AKfycbzgCHWURv76QZnerCoDpijkpTjmlcrs3ici3Spkw73rWTPp5y3RGa7Nn2MP5bV-3Fj4/exec";

const LEGALES_STORAGE_BUCKET = "legales-docs";

let _legalesContenidoCargado = false; // evita re-fetch al Apps Script en cada visita a la vista
let _legalesDocs = [];                // caché en memoria de la última lista de documentos cargada

function _esWorkerOAdminLegales() {
  return Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);
}

// ── Punto de entrada de la vista ────────────────────────────
async function loadLegales() {
  if (!_esWorkerOAdminLegales()) return; // guarda extra, RLS igual lo bloquearía

  const btnSubir = document.getElementById("btn-subir-doc-legal");
  if (btnSubir) btnSubir.style.display = _esWorkerOAdminLegales() ? "" : "none";

  // El contenido institucional cambia poco: se trae una sola vez por
  // sesión de la SPA, no en cada visita a la vista.
  if (!_legalesContenidoCargado) {
    _legalesContenidoCargado = true;
    _cargarContenidoInstitucional();
  }

  _cargarDocumentosLegales();
}

// ── Contenido institucional (Misión/Visión/Valores/…) ───────
async function _cargarContenidoInstitucional() {
  const cont = document.getElementById("legales-secciones");
  if (!cont) return;

  try {
    const res = await fetch(LEGALES_DOC_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success || typeof data.html !== "string") {
      throw new Error("Respuesta sin success/html");
    }

    const secciones = _parsearSeccionesLegales(data.html);
    if (secciones.length === 0) {
      cont.innerHTML = `<p class="legales-secciones-error">El documento no tiene contenido para mostrar.</p>`;
      return;
    }

    cont.innerHTML = secciones.map((s, i) => _renderSeccionLegal(s, i)).join("");
  } catch (err) {
    console.error("[legales] error cargando contenido institucional:", err);
    cont.innerHTML = `<p class="legales-secciones-error">No se pudo cargar el contenido institucional. Reintentá más tarde.</p>`;
  }
}

// Corta el string plano "<h1>A</h1><p>..</p><p>..</p><h1>B</h1>..."
// en secciones { titulo, bodyHtml }. Formato siempre h1 seguido de sus
// p hasta el próximo h1 (confirmado, no hace falta tolerar nesting raro).
function _parsearSeccionesLegales(html) {
  const cont = document.createElement("div");
  cont.innerHTML = html;

  const secciones = [];
  let actual = null;

  for (const node of Array.from(cont.children)) {
    if (node.tagName === "H1") {
      actual = { titulo: node.textContent.trim(), parrafos: [] };
      secciones.push(actual);
    } else if (actual) {
      actual.parrafos.push(node.outerHTML);
    }
  }

  return secciones;
}

// Ícono genérico único para todas las secciones (el contenido es
// dinámico — no hay forma confiable de mapear título → ícono específico).
const _LEGALES_ICONO_GENERICO = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;

function _renderSeccionLegal(seccion, idx) {
  return `
  <div class="legal-section">
    <button type="button" class="legal-section-toggle" aria-expanded="false" onclick="toggleLegalSection(this)">
      <span class="legal-section-icon">${_LEGALES_ICONO_GENERICO}</span>
      <span class="legal-section-title">${_escapeHtmlLegal(seccion.titulo)}</span>
      <svg class="legal-section-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="9 6 15 12 9 18"/></svg>
    </button>
    <div class="legal-section-body">
      <div class="legal-section-body-inner">
        <div class="legal-section-content">${seccion.parrafos.join("")}</div>
      </div>
    </div>
  </div>`;
}

function toggleLegalSection(btn) {
  const expanded = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", String(!expanded));
}

// ── Documentos de asamblea ──────────────────────────────────
async function _cargarDocumentosLegales() {
  const listEl = document.getElementById("legales-docs-list");
  if (!listEl) return;

  listEl.innerHTML = `<div class="legal-docs-empty">Cargando…</div>`;

  const { data, error } = await supabaseClient
    .from("legales_documentos")
    .select("id, nombre, storage_path, tamano_bytes, fecha_asamblea, created_at")
    .order("fecha_asamblea", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[legales] error cargando documentos:", error);
    listEl.innerHTML = `<div class="legal-docs-empty">Error al cargar los documentos.</div>`;
    return;
  }

  _legalesDocs = data || [];

  if (_legalesDocs.length === 0) {
    listEl.innerHTML = `<div class="legal-docs-empty">Todavía no se subió ningún documento de asamblea.</div>`;
    return;
  }

  listEl.innerHTML = _legalesDocs.map(d => `
    <div class="legal-doc-row">
      <span class="legal-doc-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </span>
      <div class="legal-doc-info">
        <div class="legal-doc-name">${_escapeHtmlLegal(d.nombre)}</div>
        <div class="legal-doc-meta">${_formatMetaDocLegal(d)}</div>
      </div>
      <button type="button" class="legal-doc-download" aria-label="Descargar documento" onclick="descargarDocLegal('${d.id}', this)">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>
    </div>`).join("");
}

function _formatMetaDocLegal(d) {
  const partes = [];
  if (d.fecha_asamblea) {
    const f = new Date(d.fecha_asamblea + "T00:00:00");
    partes.push(`Asamblea ${f.toLocaleDateString("es-PY", { day: "2-digit", month: "short", year: "numeric" }).replace(".", "")}`);
  }
  if (d.tamano_bytes) partes.push(_formatBytesLegal(d.tamano_bytes));
  return partes.join(" · ") || "—";
}

function _formatBytesLegal(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Genera una URL firmada temporal (el bucket es privado) y abre la
// descarga. Se pide on-demand cada vez — nunca se guarda el link fijo,
// así no hace falta actualizar nada a mano si el archivo se reemplaza.
async function descargarDocLegal(id, btnEl) {
  const doc = _legalesDocs.find(d => String(d.id) === String(id));
  if (!doc) return;

  if (btnEl) btnEl.disabled = true;

  const { data, error } = await supabaseClient
    .storage
    .from(LEGALES_STORAGE_BUCKET)
    .createSignedUrl(doc.storage_path, 60); // 60s alcanza para iniciar la descarga

  if (btnEl) btnEl.disabled = false;

  if (error || !data?.signedUrl) {
    console.error("[legales] error generando URL firmada:", error);
    _appToast("No se pudo generar el link de descarga", true);
    return;
  }

  window.open(data.signedUrl, "_blank", "noopener");
}

// ── Subir documento nuevo ───────────────────────────────────
// Flujo: elegir archivo → abrir modal pidiendo fecha de asamblea
// (obligatoria) → recién ahí se sube a Storage + se inserta la fila.
// _legalDocPendiente guarda el File entre el paso de selección y el
// de confirmación del modal.
let _legalDocPendiente = null;

function abrirSelectorDocLegal() {
  if (!_esWorkerOAdminLegales()) return;
  const input = document.getElementById("legal-doc-file-input");
  if (input) input.click();
}

function onArchivoLegalSeleccionado(inputEl) {
  const file = inputEl.files?.[0];
  inputEl.value = ""; // permite volver a elegir el mismo archivo más adelante
  if (!file) return;

  if (!_esWorkerOAdminLegales()) return; // guarda extra, RLS igual lo bloquearía

  if (file.type !== "application/pdf") {
    _appToast("Solo se aceptan archivos PDF", true);
    return;
  }

  _legalDocPendiente = file;
  _abrirModalFechaAsamblea(file);
}

function _abrirModalFechaAsamblea(file) {
  const modal = document.getElementById("legal-fecha-asamblea-modal");
  const form = document.getElementById("legal-fecha-asamblea-form");
  const nombreEl = document.getElementById("legal-fecha-modal-nombre-archivo");
  const fechaInput = document.getElementById("legal-fecha-asamblea-input");
  if (!modal || !form) return;

  form.reset();
  if (nombreEl) nombreEl.textContent = file.name;
  // Fecha de asamblea es obligatoria: no se precarga con "hoy" para no
  // inducir a confirmar sin pensarla, pero tampoco se deja completamente
  // vacía de tope máximo — no tiene sentido registrar una asamblea futura.
  if (fechaInput) fechaInput.max = new Date().toISOString().slice(0, 10);

  modal.showModal();
  fechaInput?.focus();
}

function cancelarSubidaDocLegal() {
  const modal = document.getElementById("legal-fecha-asamblea-modal");
  if (modal && modal.open) modal.close();
  _legalDocPendiente = null;
}

async function confirmarSubidaDocLegal(ev) {
  ev.preventDefault();

  const file = _legalDocPendiente;
  const fechaAsamblea = document.getElementById("legal-fecha-asamblea-input")?.value;
  if (!file || !fechaAsamblea) return; // required en el input ya cubre esto en el flujo normal

  const modal = document.getElementById("legal-fecha-asamblea-modal");
  const btnConfirmar = document.getElementById("legal-fecha-modal-confirmar-btn");
  const btnSubir = document.getElementById("btn-subir-doc-legal");

  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = "Subiendo…"; }
  if (btnSubir) { btnSubir.disabled = true; btnSubir.textContent = "Subiendo…"; }

  // Path único: timestamp + nombre saneado, evita colisiones sin
  // depender de que el usuario no repita nombre de archivo.
  const nombreSaneado = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${Date.now()}_${nombreSaneado}`;

  const { error: uploadError } = await supabaseClient
    .storage
    .from(LEGALES_STORAGE_BUCKET)
    .upload(storagePath, file, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("[legales] error subiendo archivo:", uploadError);
    if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = "Subir documento"; }
    if (btnSubir) { btnSubir.disabled = false; btnSubir.innerHTML = _legalesBtnSubirHtml(); }
    _appToast("Error al subir el documento", true);
    return;
  }

  const { error: insertError } = await supabaseClient
    .from("legales_documentos")
    .insert([{
      nombre: file.name,
      storage_path: storagePath,
      tamano_bytes: file.size,
      fecha_asamblea: fechaAsamblea,
      subido_por_email: document.getElementById("user-email")?.textContent || null,
    }]);

  if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = "Subir documento"; }
  if (btnSubir) { btnSubir.disabled = false; btnSubir.innerHTML = _legalesBtnSubirHtml(); }

  if (insertError) {
    console.error("[legales] error registrando documento:", insertError);
    // El archivo ya se subió a Storage aunque falle el insert; se
    // informa igual para que el usuario no reintente y duplique.
    _appToast("El archivo se subió pero no se pudo registrar. Contactá a soporte.", true);
    return;
  }

  if (modal && modal.open) modal.close();
  _legalDocPendiente = null;

  _appToast("✅ Documento subido");
  _cargarDocumentosLegales();
}

function _legalesBtnSubirHtml() {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Subir documento`;
}

function _escapeHtmlLegal(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
