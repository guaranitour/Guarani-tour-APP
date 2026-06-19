/* ─────────────────────────────────────────────
   novedades.js — Inauguración Guaraní Tour App
   Slide narrativo: Antes → Transición → Hoy
───────────────────────────────────────────── */

const _NOV_VERSION = "inaug-v1";

// ── Slides de inauguración (visibles para todos los roles) ──
const _NOV_SLIDES_INAUG = [
  {
    tipo: "pasado",
    etiqueta: "Antes",
    titulo: "Así empezamos",
    texto: "Los viajes se controlaban en Excel. Los datos dependían de carga manual y de una sola persona.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="8" y1="13" x2="16" y2="13"/>
      <line x1="8" y1="17" x2="16" y2="17"/>
      <line x1="8" y1="9" x2="10" y2="9"/>
    </svg>`,
  },
  {
    tipo: "transicion",
    etiqueta: "El cambio",
    titulo: "Construimos algo propio",
    texto: "Empezamos a ordenar la información y a construir una herramienta pensada para el equipo, paso a paso.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Hoy",
    titulo: "Guaraní Tour App",
    texto: "Viajes, pasajeros y pagos en tiempo real. Más claro, más rápido y más confiable.\n\nY esto es solo el comienzo.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>`,
  },
];

// ── Estado interno ─────────────────────────────────────────
let _novSlideActual = 0;
let _novEmail       = "";

function _novKey(email) {
  return `guarani_novedad_${_NOV_VERSION}_${email}`;
}

// ── Punto de entrada ───────────────────────────────────────
function checkNovedades(email, role) {
  if (localStorage.getItem(_novKey(email)) === "1") return;
  _novEmail       = email;
  _novSlideActual = 0;
  _renderInaugModal();
}

// ── Renderizar modal ───────────────────────────────────────
function _renderInaugModal() {
  let overlay = document.getElementById("nov-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "nov-overlay";
    overlay.className = "nov-overlay";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="nov-sheet" role="dialog" aria-modal="true" aria-label="Inauguración">

      <div class="nov-header">
        <div class="nov-header-label">🎉 Inauguración</div>
        <button class="nov-close" onclick="_cerrarNovedades()" aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="nov-slides-wrap">
        <div class="nov-slides" id="nov-slides"></div>
      </div>

      <div class="nov-dots" id="nov-dots"></div>

      <div class="nov-actions">
        <button class="nov-btn-prev" id="nov-btn-prev" onclick="_novAnterior()">← Anterior</button>
        <button class="nov-btn-next" id="nov-btn-next" onclick="_novSiguiente()">Siguiente →</button>
      </div>

    </div>`;

  _novRenderSlides();
  _novActualizarEstado();

  requestAnimationFrame(() => overlay.classList.add("nov-visible"));
}

// ── Renderizar slides ──────────────────────────────────────
function _novRenderSlides() {
  const wrap = document.getElementById("nov-slides");
  if (!wrap) return;

  wrap.innerHTML = _NOV_SLIDES_INAUG.map((s, i) => `
    <div class="nov-slide nov-slide--${s.tipo} ${i === _novSlideActual ? "activa" : ""}" data-idx="${i}">
      <div class="nov-slide-visual">
        <div class="nov-slide-icon">${s.icono}</div>
      </div>
      <div class="nov-slide-badge nov-badge--${s.tipo}">${s.etiqueta}</div>
      <h2 class="nov-slide-nombre">${s.titulo}</h2>
      <p class="nov-slide-desc">${s.texto.replace(/\n/g, "<br>")}</p>
    </div>
  `).join("");
}

// ── Dots y estado ──────────────────────────────────────────
function _novActualizarEstado() {
  const total  = _NOV_SLIDES_INAUG.length;
  const actual = _novSlideActual;

  const dotsEl = document.getElementById("nov-dots");
  if (dotsEl) {
    dotsEl.innerHTML = _NOV_SLIDES_INAUG.map((_, i) =>
      `<span class="nov-dot ${i === actual ? "activo" : ""}" onclick="_novIrA(${i})"></span>`
    ).join("");
  }

  document.querySelectorAll(".nov-slide").forEach((el, i) => {
    el.classList.toggle("activa", i === actual);
  });

  // Actualizar fondo del sheet según slide activo
  const sheet = document.querySelector(".nov-sheet");
  if (sheet) {
    sheet.dataset.tipo = _NOV_SLIDES_INAUG[actual].tipo;
  }

  const btnPrev = document.getElementById("nov-btn-prev");
  const btnNext = document.getElementById("nov-btn-next");
  if (btnPrev) btnPrev.style.visibility = actual === 0 ? "hidden" : "visible";
  if (btnNext) {
    const esUltima = actual === total - 1;
    btnNext.textContent = esUltima ? "¡Empezar!" : "Siguiente →";
    btnNext.classList.toggle("nov-btn-empezar", esUltima);
  }
}

// ── Navegación ─────────────────────────────────────────────
function _novIrA(idx) {
  _novSlideActual = idx;
  _novActualizarEstado();
}

function _novAnterior() {
  if (_novSlideActual > 0) {
    _novSlideActual--;
    _novActualizarEstado();
  }
}

function _novSiguiente() {
  if (_novSlideActual < _NOV_SLIDES_INAUG.length - 1) {
    _novSlideActual++;
    _novActualizarEstado();
  } else {
    _cerrarNovedades();
  }
}

// ── Cerrar ─────────────────────────────────────────────────
function _cerrarNovedades() {
  localStorage.setItem(_novKey(_novEmail), "1");
  const overlay = document.getElementById("nov-overlay");
  if (!overlay) return;
  overlay.classList.remove("nov-visible");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}
