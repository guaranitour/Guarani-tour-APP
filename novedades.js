/* ─────────────────────────────────────────────
   novedades.js — Novedades Guaraní Tour App
   Slide narrativo con los últimos cambios de la app
───────────────────────────────────────────── */

const _NOV_VERSION = "navbar-v1";

// ── Slides de novedades (visibles para todos los roles) ──
const _NOV_SLIDES_INAUG = [
  {
    tipo: "hoy",
    etiqueta: "Novedad",
    titulo: "Guaraní Tour App sigue evolucionando",
    texto: "Seguimos mejorando la app todo el tiempo. Estos son los últimos cambios que ya podés usar.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Nuevo inicio",
    titulo: "El Dashboard es ahora tu inicio",
    texto: "Al entrar a la app ya vas directo al Panel de control, con los KPIs y el resumen de la operación a la vista.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Barra de navegación",
    titulo: "Menú y acceso directo configurable",
    texto: "Abajo tenés todo más a mano: el botón Menú te muestra todos los módulos en un solo toque, y el botón de la derecha lo configurás vos con el módulo que más usás.\n\nY esto es solo el comienzo: seguirán llegando grandes cambios.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
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
    <div class="nov-sheet" role="dialog" aria-modal="true" aria-label="Novedades">

      <div class="nov-header">
        <div class="nov-header-label">🎉 Novedades</div>
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
