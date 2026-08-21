/* ─────────────────────────────────────────────
   novedades.js — Novedades Guaraní Tour App
   Slide narrativo con los últimos cambios de la app
───────────────────────────────────────────── */

// Subir esta versión cada vez que se cargan slides nuevos: cambia la key
// de localStorage, así que todos vuelven a ver el modal aunque ya hayan
// cerrado una tanda anterior.
const _NOV_VERSION = "resumen-viajes-v1";

// ── Slides de novedades ──────────────────────────────────────────────────
// "roles": opcional. Si no está presente, el slide es visible para todos
// los roles. Si está, solo se muestra a quien tenga uno de esos roles
// (comparación exacta contra el "role" pasado a checkNovedades()).
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
    etiqueta: "Rendimiento",
    titulo: "Sesiones y pantallas más estables",
    texto: "Mejoramos la estabilidad de las sesiones y la velocidad de carga de las pantallas en toda la app.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M13 2 3 14h7l-1 8 10-12h-7z"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Viajes",
    titulo: "Resumen de viajes activos, rediseñado",
    texto: "Rediseñamos el Resumen de viajes activos para que sea mucho más fácil entender de un vistazo cómo va cada viaje.",
    roles: ["admin", "worker", "finanzas"],
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Presupuesto",
    titulo: "Proyección de ganancias en el presupuesto",
    texto: "El presupuesto de cada viaje ahora incluye una proyección básica de ganancias, para tener una idea del resultado esperado sin salir de la app.",
    roles: ["admin", "worker", "finanzas"],
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Presupuesto",
    titulo: "Corregir un concepto ya es más simple",
    texto: "¿Te equivocaste al registrar un concepto en el presupuesto? Ahora podés ingresar el valor 0 directamente en ese mismo concepto, sin necesidad de eliminarlo.",
    roles: ["admin"],
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Pagos y recibos",
    titulo: "Más métodos de pago y recibos renovados",
    texto: "Sumamos Eko, Wally, Eclub y Mango como métodos de pago, para registrar con más precisión cómo paga cada pasajero.\n\nLa lista de Recibos tiene una apariencia renovada, y ahora incluye el concepto Solidaridad para pagos que no están relacionados a un viaje.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
    </svg>`,
  },
  {
    tipo: "hoy",
    etiqueta: "Calendario",
    titulo: "Llegó el Calendario",
    texto: "Ya podés ver tus viajes, cumpleaños y eventos propios en un calendario dentro de la app. Seguirá mejorando en las próximas actualizaciones.",
    icono: `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4"/>
    </svg>`,
  },
];

// ── Estado interno ─────────────────────────────────────────
let _novSlideActual = 0;
let _novEmail       = "";
let _novSlidesVisibles = []; // subconjunto de _NOV_SLIDES_INAUG ya filtrado por rol

function _novKey(email) {
  return `guarani_novedad_${_NOV_VERSION}_${email}`;
}

/** Un slide sin "roles" es visible para todos. Con "roles", solo para
 *  quien tenga uno de esos roles exactos. */
function _novSlideVisibleParaRol(slide, role) {
  if (!slide.roles) return true;
  return slide.roles.includes(role);
}

// ── Punto de entrada ───────────────────────────────────────
function checkNovedades(email, role) {
  if (localStorage.getItem(_novKey(email)) === "1") return;

  _novSlidesVisibles = _NOV_SLIDES_INAUG.filter(s => _novSlideVisibleParaRol(s, role));
  if (_novSlidesVisibles.length === 0) {
    // Nada relevante para este rol: no hay modal que mostrar, pero igual
    // marcamos como visto para no re-evaluar en cada carga.
    localStorage.setItem(_novKey(email), "1");
    return;
  }

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

// Umbral para decidir si un slide usa el layout compacto (ícono grande,
// centrado) o el layout --largo (ícono chico, alineado a la izquierda).
// Se activa por longitud de texto O por tener más de un párrafo (\n\n),
// lo que ocurra primero — un slide con dos párrafos cortos igual se
// beneficia del layout largo, aunque no llegue al umbral de caracteres.
const _NOV_LARGO_MIN_CHARS = 140;

function _novEsSlideLargo(slide) {
  return slide.texto.length > _NOV_LARGO_MIN_CHARS || slide.texto.includes("\n\n");
}

// ── Renderizar slides ──────────────────────────────────────
function _novRenderSlides() {
  const wrap = document.getElementById("nov-slides");
  if (!wrap) return;

  wrap.innerHTML = _novSlidesVisibles.map((s, i) => {
    const esLargo = _novEsSlideLargo(s);
    return `
    <div class="nov-slide nov-slide--${s.tipo} ${esLargo ? "nov-slide--largo" : ""} ${i === _novSlideActual ? "activa" : ""}" data-idx="${i}">
      <div class="nov-slide-visual">
        <div class="nov-slide-icon">${s.icono}</div>
        ${esLargo ? `<div class="nov-slide-badge nov-badge--${s.tipo}">${s.etiqueta}</div>` : ""}
      </div>
      ${esLargo ? "" : `<div class="nov-slide-badge nov-badge--${s.tipo}">${s.etiqueta}</div>`}
      <h2 class="nov-slide-nombre">${s.titulo}</h2>
      <p class="nov-slide-desc">${s.texto.replace(/\n/g, "<br>")}</p>
    </div>
  `;
  }).join("");
}

// ── Dots y estado ──────────────────────────────────────────
function _novActualizarEstado() {
  const total  = _novSlidesVisibles.length;
  const actual = _novSlideActual;

  const dotsEl = document.getElementById("nov-dots");
  if (dotsEl) {
    dotsEl.innerHTML = _novSlidesVisibles.map((_, i) =>
      `<span class="nov-dot ${i === actual ? "activo" : ""}" onclick="_novIrA(${i})"></span>`
    ).join("");
  }

  document.querySelectorAll(".nov-slide").forEach((el, i) => {
    el.classList.toggle("activa", i === actual);
  });

  // Actualizar fondo del sheet según slide activo
  const sheet = document.querySelector(".nov-sheet");
  if (sheet) {
    sheet.dataset.tipo = _novSlidesVisibles[actual].tipo;
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
  if (_novSlideActual < _novSlidesVisibles.length - 1) {
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
