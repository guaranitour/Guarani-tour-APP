// native-ux.js — detalles de "app nativa": vibración corta en acciones clave.
// (La animación de vistas vive en app.js/navigateTo y css/native.css; el
// arrastre del sheet de módulos, en modulos-menu.js.)

(function () {
  const reducido = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // Vibración corta (Android). Silenciosa si el dispositivo no la soporta o
  // si el usuario pidió reducir el movimiento.
  window.haptic = function (ms = 8) {
    try {
      if (!reducido.matches && navigator.vibrate) navigator.vibrate(ms);
    } catch (_) { /* sin soporte: no pasa nada */ }
  };

  // Controles que merecen respuesta física al tocarlos. Es delegado: no
  // hace falta tocar el HTML ni los módulos.
  const SELECTOR_HAPTIC = [
    ".btn-save", ".fab", ".fab-sos", ".bn-item", ".modulo-item", ".btn-ver-mas",
    ".btn-agregar-pasajero", ".usuarios-tab", ".informes-tab-btn",
    ".informes-range-chip", ".legal-fecha-modal-confirmar", ".btn-icon-danger",
  ].join(",");

  document.addEventListener("click", (e) => {
    const el = e.target.closest(SELECTOR_HAPTIC);
    if (el && !el.disabled) window.haptic(8);
  }, { passive: true });
})();
