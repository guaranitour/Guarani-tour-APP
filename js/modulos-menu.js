// modulos-menu.js — bottom navbar: sheet de módulos y acceso directo.
// Extraído de app.js.

// ══════════════════════════════════════════════════════════
// BOTTOM NAVBAR — Inicio / Módulos / Más
// El sheet de "Módulos" es el inventario de accesos a los módulos
// de la app (mismos slugs, íconos y reglas de visibilidad por rol
// que antes tenía la vista de inicio, ya eliminada), con nombres
// cortos, sin descripción y en grid de 3.
// ══════════════════════════════════════════════════════════
const MODULOS_MENU = [
  { slug: "clientes",           label: "Clientes",   img: "cliente.png",   bg: "rgba(45,106,79,.12)", roles: ["admin", "worker"] },
  { slug: "viajes",             label: "Viajes",      img: "viajes.png",    bg: "rgba(45,106,79,.12)" },
  { slug: "recibos",            label: "Recibos",     img: "recibo.png",    bg: "rgba(201,168,76,.18)" },
  { slug: "movimientos",        label: "Movimientos", img: "bancario.png",  bg: "rgba(45,106,79,.16)", roles: ["admin", "worker", "finanzas"] },
  { slug: "byc",                label: "Estado ByC",  img: "byc.png",       bg: "rgba(70,130,180,.15)", roles: ["admin", "worker"] },
  { slug: "historico",          label: "Histórico",   img: "historial.png", bg: "rgba(120,120,140,.15)", roles: ["admin", "worker", "finanzas"] },
  { slug: "seleccion-asiento",  label: "Asientos",    img: "asiento.png",   bg: "rgba(45,106,79,.12)" },
  { slug: "usuarios",           label: "Usuarios",    img: "staff.png",     bg: "rgba(124,92,196,.15)", roles: ["admin"] },
  { slug: "legales",            label: "Legales",     img: "legales.png",   bg: "rgba(70,130,180,.15)", roles: ["admin", "worker"] },
  { slug: "facturas",           label: "Facturas",    img: "facturas.png",  bg: "rgba(201,168,76,.18)", roles: ["admin", "worker", "finanzas"] },
  { slug: "informes",           label: "Informes",    img: "informes.png",  bg: "rgba(45,106,79,.16)", roles: ["admin", "worker", "finanzas"], beta: true },
];

// Precarga en memoria del navegador (no solo en el cache del SW) de los
// íconos del sheet de módulos. El SW ya los responde rápido desde disco,
// pero el <img> del sheet solo se crea cuando el usuario lo abre, y ese
// primer fetch sigue siendo asíncrono. Creando un objeto Image() por
// adelantado, el navegador ya tiene el bitmap decodificado en su propia
// caché de memoria para cuando el sheet realmente se renderiza —
// eliminando el parpadeo/lag de la primera apertura.
// Se llama una sola vez, apenas se confirma el rol (ver enterApp()),
// para no precargar íconos de módulos a los que el usuario no tiene acceso.
let _modulosIconosPrecargados = false;
function _precargarIconosModulos() {
  if (_modulosIconosPrecargados) return;
  _modulosIconosPrecargados = true;
  MODULOS_MENU
    .filter(m => !m.roles || m.roles.includes(currentUserRole))
    .forEach(m => { new Image().src = `/img/${m.img}`; });
}

function _renderModulosSheet() {
  const grid = document.getElementById("modulos-sheet-grid");
  if (!grid) return;
  const visibles = MODULOS_MENU.filter(m => !m.roles || m.roles.includes(currentUserRole));
  grid.innerHTML = visibles.map(m => `
    <button type="button" class="modulo-item" style="--modulo-icon-bg:${m.bg}" onclick="navigateTo('${m.slug}'); closeModulosSheet();">
      ${m.beta ? `<span class="modulo-item-badge">Beta</span>` : ""}
      <span class="modulo-item-icon">
        <img src="/img/${m.img}" alt="" width="24" height="24">
      </span>
      <span class="modulo-item-label">${m.label}</span>
    </button>
  `).join("");
}

// Marca si hay una entrada de historial "de más" agregada al abrir el
// sheet, específicamente para que el botón/gesto atrás lo cierre en vez
// de navegar en el SPA. La consume el listener de popstate de arriba.
let _modulosSheetHistoryEntryOpen = false;

function _closeModulosSheetUI() {
  const sheet = document.getElementById("modulos-sheet");
  const overlay = document.getElementById("modulos-overlay");
  const btn = document.getElementById("bn-modulos");
  if (sheet) sheet.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-expanded", "false"); }
  document.body.style.overflow = "";
}

function toggleModulosSheet() {
  const sheet = document.getElementById("modulos-sheet");
  const overlay = document.getElementById("modulos-overlay");
  const btn = document.getElementById("bn-modulos");
  if (!sheet || !overlay) return;
  const abrir = !sheet.classList.contains("open");
  if (abrir) {
    _renderModulosSheet();
    // Entrada extra en el historial: así "atrás" cierra el sheet en vez
    // de navegar a la vista anterior del SPA (ver popstate más arriba).
    history.pushState({ modulosSheet: true }, "", location.hash);
    _modulosSheetHistoryEntryOpen = true;
  }
  sheet.classList.toggle("open", abrir);
  overlay.classList.toggle("open", abrir);
  if (btn) { btn.classList.toggle("active", abrir); btn.setAttribute("aria-expanded", String(abrir)); }
  document.body.style.overflow = abrir ? "hidden" : "";
}

function closeModulosSheet() {
  // Si el cierre viene de tocar la X, el overlay, o elegir un módulo (no
  // del botón atrás), todavía queda pendiente la entrada de historial
  // que agregamos al abrir. La colapsamos con replaceState (en vez de
  // history.back()) para no competir con una navegación que pueda
  // haber ocurrido en el mismo gesto (ej. elegir un módulo hace
  // navigateTo(slug) justo antes de este cierre, lo que ya empujó el
  // hash del destino): replaceState toma el hash actual tal cual esté
  // en ese momento y solo descarta la entrada extra, sin retroceder.
  if (_modulosSheetHistoryEntryOpen) {
    _modulosSheetHistoryEntryOpen = false;
    history.replaceState({ scrollY: window.scrollY }, "", location.hash);
  }
  _closeModulosSheetUI();
}

// Resalta "Inicio" cuando la vista activa es el dashboard (que ahora
// hace las veces de pantalla principal de la app), y "Calendario"
// (acceso directo fijo) cuando la vista activa es esa.
function _updateBottomNavActiveState(view) {
  const btnInicio = document.getElementById("bn-inicio");
  if (btnInicio) btnInicio.classList.toggle("active", view === "dashboard");

  const btnShortcut = document.getElementById("bn-shortcut");
  if (btnShortcut) btnShortcut.classList.toggle("active", view === "calendario");
}

// ══════════════════════════════════════════════════════════
// ACCESO DIRECTO (3er botón del navbar) — fijo a Calendario
// Antes era configurable (el usuario elegía el módulo); ahora apunta
// siempre a Calendario. Se deja como función (en vez de solo el
// onclick inline del HTML) por si en el futuro se quiere resaltar
// el botón según la vista activa, igual que antes.
// ══════════════════════════════════════════════════════════
function onShortcutTap() {
  navigateTo("calendario");
}

// ── Arrastrar el sheet hacia abajo para cerrarlo ───────────
// Se arrastra desde el asa/encabezado, o desde cualquier parte si la
// grilla está en su tope. El sheet sigue al dedo (sin transición) y al
// soltar se cierra si se bajó lo suficiente o con un gesto rápido; si no,
// vuelve a su lugar.
(function () {
  const UMBRAL_PX = 110;       // distancia que cierra
  const UMBRAL_VELOCIDAD = .6; // px/ms que cierra aunque la distancia sea corta

  let sheet = null, overlay = null;
  let inicioY = 0, inicioT = 0, dy = 0, arrastrando = false, candidato = false;

  function limpiar() {
    sheet.classList.remove("arrastrando");
    overlay.style.opacity = "";
  }

  function onStart(e) {
    if (!sheet.classList.contains("open") || e.touches.length !== 1) return;
    const enCabecera = !!e.target.closest(".modulos-sheet-handle, .modulos-sheet-header");
    candidato = enCabecera || sheet.scrollTop <= 0;
    inicioY = e.touches[0].clientY;
    inicioT = e.timeStamp;
    dy = 0;
    arrastrando = false;
  }

  function onMove(e) {
    if (!candidato) return;
    const delta = e.touches[0].clientY - inicioY;
    if (!arrastrando) {
      if (delta < 8) return;      // hacia arriba o movimiento mínimo: es scroll/toque
      arrastrando = true;
      sheet.classList.add("arrastrando");
    }
    dy = Math.max(0, delta);
    e.preventDefault();           // evita que el scroll compita con el arrastre
    sheet.style.transform = "translateY(" + dy + "px)";
    overlay.style.opacity = String(Math.max(0, 1 - dy / sheet.offsetHeight));
  }

  function onEnd(e) {
    if (!arrastrando) { candidato = false; return; }
    const velocidad = dy / Math.max(1, e.timeStamp - inicioT);
    arrastrando = false;
    candidato = false;

    // Se devuelve la transición CSS (con un reflow en el medio) para que el
    // cierre o el rebote partan de la posición actual del dedo.
    limpiar();
    void sheet.offsetWidth;
    sheet.style.transform = "";
    if (dy > UMBRAL_PX || velocidad > UMBRAL_VELOCIDAD) {
      closeModulosSheet();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    sheet = document.getElementById("modulos-sheet");
    overlay = document.getElementById("modulos-overlay");
    if (!sheet || !overlay) return;
    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd, { passive: true });
    sheet.addEventListener("touchcancel", onEnd, { passive: true });
  });
})();
