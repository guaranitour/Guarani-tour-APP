/* ═══════════════════════════════════════════════
   sheet.js — Capa única para modales y bottom sheets
   Sheet.abrir(el, opts) / Sheet.cerrar(el). Se encarga de mostrar/ocultar,
   bloquear el scroll del body, Esc, y de la entrada de historial para que
   "atrás" (botón o gesto) cierre el de arriba en vez de navegar.

   opts:
     modo      "display" (default: style.display) | "clase" (agrega .open)
     display   valor de style.display al abrir (default "flex"; "" = el del CSS)
     extra     otros elementos que acompañan al principal (ej. su overlay)
     alCerrar  callback al cerrar, sea cual sea la causa
   Los <dialog> nativos y el bottom sheet de custom-select.js quedan fuera.
═══════════════════════════════════════════════ */

const Sheet = (() => {
  const pila = [];        // abiertos, el último es el de arriba: { id, el, opts }
  let popsPropios = 0;    // history.back() que disparamos nosotros
  let seq = 0;

  const extras = def => (def.opts.extra || []).filter(Boolean);

  // Salida animada de los modales en modo display (los de modo "clase"
  // animan por transición CSS). Debe coincidir con .sheet-cerrando en native.css.
  const DURACION_SALIDA = 220;
  const timersSalida = new WeakMap();

  function _mostrar(def) {
    const { el, opts } = def;
    // Reabierto mientras se estaba cerrando: cancelar la salida pendiente
    clearTimeout(timersSalida.get(el));
    el.classList.remove("sheet-cerrando");
    if (opts.modo === "clase") {
      el.classList.add("open");
      extras(def).forEach(e => e.classList.add("open"));
    } else {
      el.style.display = opts.display ?? "flex";
    }
  }

  function _ocultar(def) {
    const { el, opts } = def;
    if (opts.modo === "clase") {
      el.classList.remove("open");
      extras(def).forEach(e => e.classList.remove("open"));
    } else if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.display = "none";
    } else {
      el.classList.add("sheet-cerrando");
      timersSalida.set(el, setTimeout(() => {
        el.classList.remove("sheet-cerrando");
        el.style.display = "none";
      }, DURACION_SALIDA));
    }
  }

  function _actualizarScroll() {
    document.body.style.overflow = pila.length ? "hidden" : "";
  }

  function abrir(el, opts = {}) {
    if (!el) return;
    if (pila.some(d => d.el === el)) return; // ya abierto
    const def = { id: "sheet-" + (++seq), el, opts };
    pila.push(def);
    _mostrar(def);
    _actualizarScroll();
    history.pushState({ sheetId: def.id }, "", location.hash);
  }

  // Cierre por código (X, backdrop, guardar…). Si su entrada de historial
  // sigue arriba se retrocede; si ya se navegó a otra vista no se toca el
  // historial (back() deshacería esa navegación).
  function cerrar(el) {
    const i = pila.findIndex(d => d.el === el);
    if (i === -1) return;
    const [def] = pila.splice(i, 1);
    _ocultar(def);
    _actualizarScroll();
    def.opts.alCerrar?.();
    if (history.state?.sheetId === def.id) {
      popsPropios++;
      history.back();
    }
  }

  // Cierre por "atrás": la entrada de historial ya se consumió.
  function _cerrarPorAtras() {
    const def = pila.pop();
    if (!def) return false;
    _ocultar(def);
    _actualizarScroll();
    def.opts.alCerrar?.();
    return true;
  }

  // Lo llama el listener global de popstate (app.js). true = ya se manejó.
  function popstate() {
    if (popsPropios > 0) { popsPropios--; return true; }
    return _cerrarPorAtras();
  }

  function hayAbierto() { return pila.length > 0; }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && pila.length) cerrar(pila[pila.length - 1].el);
  });

  return { abrir, cerrar, popstate, hayAbierto };
})();
