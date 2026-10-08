// =====================================================================
// encuesta.js — Vista "Encuesta": respuestas de la encuesta Tally
// "Queremos escucharte". Tally envía cada respuesta por webhook a la edge
// function tally-webhook, que la guarda en encuesta_respuestas. Acá solo
// se lista (lectura para admin/worker/finanzas, ver RLS).
// =====================================================================

const ENCUESTA_URL = "https://tally.so/r/Ek4o8X";

// Columna -> título corto para mostrar en cada tarjeta
const ENCUESTA_CAMPOS = [
  ["sigue_viajando", "¿Sigue viajando?"],
  ["lo_que_valora", "Lo que más valora"],
  ["que_hace_bien", "Lo que hacemos bien"],
  ["motivo_viaja_menos", "Motivo por el que viaja menos"],
  ["factores_decision", "Factores de decisión"],
  ["experiencias_deseadas", "Experiencias deseadas"],
  ["probabilidad_volver", "Probabilidad de volver"],
  ["que_mejorar", "Qué mejorar"],
  ["que_tendria_que_darse", "Qué tendría que darse"],
];

function _escEnc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function _valorEnc(col, v) {
  if (col === "probabilidad_volver") return "★".repeat(v) + "☆".repeat(Math.max(0, 5 - v)) + ` (${v}/5)`;
  if (Array.isArray(v)) return v.map(x => `<span class="enc-chip">${_escEnc(x)}</span>`).join("");
  return _escEnc(v);
}

async function loadEncuesta() {
  const listEl = document.getElementById("encuesta-list");
  const totalEl = document.getElementById("encuesta-total");
  if (!listEl) return;
  listEl.innerHTML = `<p class="enc-empty">Cargando respuestas…</p>`;

  const { data, error } = await supabaseClient
    .from("encuesta_respuestas")
    .select("id, submitted_at, " + ENCUESTA_CAMPOS.map(c => c[0]).join(", "))
    .order("submitted_at", { ascending: false });

  if (error) {
    listEl.innerHTML = `<p class="enc-empty">Error al cargar: ${_escEnc(error.message)}</p>`;
    return;
  }
  if (totalEl) totalEl.textContent = `${data.length} respuesta${data.length === 1 ? "" : "s"}`;
  if (!data.length) {
    listEl.innerHTML = `<p class="enc-empty">Todavía no hay respuestas.</p>`;
    return;
  }

  listEl.innerHTML = data.map(r => {
    const fecha = new Date(r.submitted_at).toLocaleString("es-PY", { dateStyle: "medium", timeStyle: "short" });
    const filas = ENCUESTA_CAMPOS
      .filter(([col]) => r[col] != null && !(Array.isArray(r[col]) && !r[col].length) && r[col] !== "")
      .map(([col, label]) => `<div class="enc-row"><div class="enc-label">${label}</div><div class="enc-val">${_valorEnc(col, r[col])}</div></div>`)
      .join("");
    return `<details class="enc-card">
      <summary><span class="enc-fecha">${_escEnc(fecha)}</span><span class="enc-resumen">${_escEnc(r.sigue_viajando || "")}</span></summary>
      <div class="enc-body">${filas || `<p class="enc-empty">Sin respuestas en esta entrega.</p>`}</div>
    </details>`;
  }).join("");
}

async function copiarLinkEncuesta() {
  try {
    await navigator.clipboard.writeText(ENCUESTA_URL);
    showToast("Link de la encuesta copiado");
  } catch {
    showToast(ENCUESTA_URL);
  }
}
