/* ─────────────────────────────────────────────
   novedades.js — Modal de bienvenida para módulos nuevos
───────────────────────────────────────────── */

// ── Versión: cambiar cada vez que haya nuevos módulos ──────
const _NOV_VERSION = "v1";

// ── Definición de módulos nuevos ───────────────────────────
// roles: null = todos, o array con los roles que lo ven
const _NOVEDADES = [
  {
    roles: null,
    icono: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="3" y="3" width="7" height="9" rx="1.5"/>
      <rect x="14" y="3" width="7" height="5" rx="1.5"/>
      <rect x="14" y="12" width="7" height="9" rx="1.5"/>
      <rect x="3" y="16" width="7" height="5" rx="1.5"/>
    </svg>`,
    color: "linear-gradient(135deg, #2d6a4f, #1b4332)",
    nombre: "Dashboard",
    descripcion: "Tu panel de control central. Vas a encontrar el total de pasajeros, viajes activos, el ranking de puntos Club Destino y —si sos admin o worker— el comparativo de ingresos vs egresos de los últimos viajes.",
  },
  {
    roles: ["admin", "worker"],
    icono: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>`,
    color: "linear-gradient(135deg, #2d6a4f, #c9a84c)",
    nombre: "Recibos",
    descripcion: "Creá, consultá y descargá recibos de pago en PDF. Podés buscar por cliente, CI o vendedor, y generar el comprobante directamente desde el sistema.",
  },
  {
    roles: null,
    icono: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
    </svg>`,
    color: "linear-gradient(135deg, #c9a84c, #8a6d1a)",
    nombre: "Estado ByC",
    descripcion: "Visualizá quién aceptó las bases y condiciones y si ya está cargado en la base de clientes. Desde acá también podés vincular registros pendientes con su pasajero correspondiente.",
  },
];

// ── Estado interno ─────────────────────────────────────────
let _novSlideActual = 0;
let _novSlides = [];

// ── Clave de localStorage por usuario ─────────────────────
function _novKey(email) {
  return `guarani_novedad_${_NOV_VERSION}_${email}`;
}

// ── Punto de entrada: llamar desde enterApp() ──────────────
function checkNovedades(email, role) {
  if (localStorage.getItem(_novKey(email)) === "1") return;

  // Filtrar slides según el rol del usuario
  const esArray = Array.isArray(role);
  _novSlides = _NOVEDADES.filter(n => {
    if (!n.roles) return true;
    return esArray
      ? n.roles.some(r => role.includes(r))
      : n.roles.includes(role);
  });

  if (_novSlides.length === 0) {
    localStorage.setItem(_novKey(email), "1");
    return;
  }

  _novSlideActual = 0;
  _renderNovedadesModal(email);
}

// ── Renderizar modal ───────────────────────────────────────
function _renderNovedadesModal(email) {
  // Crear overlay si no existe
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
        <div class="nov-header-label">✨ Novedades</div>
        <button class="nov-close" onclick="_cerrarNovedades('${email}')" aria-label="Cerrar">
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
        <button class="nov-btn-next" id="nov-btn-next" onclick="_novSiguiente('${email}')">Siguiente →</button>
      </div>

    </div>`;

  _novRenderSlides();
  _novActualizarEstado();

  // Entrada con animación
  requestAnimationFrame(() => overlay.classList.add("nov-visible"));
}

// ── Renderizar slides ──────────────────────────────────────
function _novRenderSlides() {
  const wrap = document.getElementById("nov-slides");
  if (!wrap) return;

  wrap.innerHTML = _novSlides.map((n, i) => `
    <div class="nov-slide ${i === _novSlideActual ? "activa" : ""}" data-idx="${i}">
      <div class="nov-slide-icon" style="background:${n.color}">
        ${n.icono}
      </div>
      <div class="nov-slide-badge">Módulo nuevo</div>
      <h2 class="nov-slide-nombre">${n.nombre}</h2>
      <p class="nov-slide-desc">${n.descripcion}</p>
    </div>
  `).join("");
}

// ── Dots de posición ───────────────────────────────────────
function _novActualizarEstado() {
  const total = _novSlides.length;
  const actual = _novSlideActual;

  // Dots
  const dotsEl = document.getElementById("nov-dots");
  if (dotsEl) {
    dotsEl.innerHTML = _novSlides.map((_, i) =>
      `<span class="nov-dot ${i === actual ? "activo" : ""}" onclick="_novIrA(${i})"></span>`
    ).join("");
  }

  // Slides: mostrar solo la activa
  document.querySelectorAll(".nov-slide").forEach((el, i) => {
    el.classList.toggle("activa", i === actual);
  });

  // Botones
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

function _novSiguiente(email) {
  if (_novSlideActual < _novSlides.length - 1) {
    _novSlideActual++;
    _novActualizarEstado();
  } else {
    _cerrarNovedades(email);
  }
}

// ── Cerrar y marcar como visto ─────────────────────────────
function _cerrarNovedades(email) {
  localStorage.setItem(_novKey(email), "1");
  const overlay = document.getElementById("nov-overlay");
  if (!overlay) return;
  overlay.classList.remove("nov-visible");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}
