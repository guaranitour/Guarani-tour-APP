// native-ux.js — detalles de "app nativa" (Android/Chrome):
//   · vibración corta en acciones clave
//   · indicador deslizante en las tabs (Usuarios, Informes, Facturas)
//   · números que cuentan hacia su valor (KPIs de Informes y Dashboard)
//   · estado "guardando" (spinner) en los botones .btn-save
//   · pull-to-refresh en las listas principales
//   · skeletons de filas para vistas que cargaban con texto plano
// La animación entre vistas vive en app.js/navigateTo + css/native.css, y el
// arrastre del sheet de módulos en modulos-menu.js.

(function () {
  const reducido = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // ── Vibración ──────────────────────────────────────────────
  window.haptic = function (ms = 8) {
    try {
      if (!reducido.matches && navigator.vibrate) navigator.vibrate(ms);
    } catch (_) { /* sin soporte: no pasa nada */ }
  };

  const SELECTOR_HAPTIC = [
    ".btn-save", ".fab", ".fab-sos", ".bn-item", ".modulo-item", ".btn-ver-mas",
    ".btn-agregar-pasajero", ".usuarios-tab", ".informes-tab-btn",
    ".informes-range-chip", ".legal-fecha-modal-confirmar", ".btn-icon-danger",
  ].join(",");

  document.addEventListener("click", (e) => {
    const el = e.target.closest(SELECTOR_HAPTIC);
    if (el && !el.disabled) window.haptic(8);
  }, { passive: true });

  // ── Skeleton de filas (reemplaza textos "Cargando…") ───────
  // Usa el shimmer de .viajes-skel (viajes_activos.css).
  window.skeletonFilas = function (n = 6) {
    const fila = `
      <div class="skel-fila" aria-hidden="true">
        <div class="viajes-skel skel-circulo"></div>
        <div class="skel-lineas">
          <div class="viajes-skel skel-linea" style="width:62%"></div>
          <div class="viajes-skel skel-linea" style="width:38%"></div>
        </div>
      </div>`;
    return `<div class="skel-lista" role="status" aria-label="Cargando">${fila.repeat(n)}</div>`;
  };

  // ── Indicador deslizante en tabs ───────────────────────────
  // Un único <span> absoluto se desplaza hasta la tab activa. Se recoloca
  // sin animación cuando cambia el tamaño (ej. la vista pasa de oculta a
  // visible) y con animación cuando cambia la tab activa.
  function initTabsDeslizantes() {
    const hosts = document.querySelectorAll(".usuarios-tabs, .informes-tabs");
    hosts.forEach((host) => {
      const ind = document.createElement("span");
      ind.className = "tab-indicator";
      ind.setAttribute("aria-hidden", "true");
      host.classList.add("tab-slider-host");
      host.prepend(ind);

      const colocar = (animar) => {
        const activa = host.querySelector(".usuarios-tab.active, .informes-tab-btn.active");
        if (!activa || activa.offsetWidth === 0) return;
        ind.style.transition = animar && !reducido.matches ? "" : "none";
        ind.style.width = activa.offsetWidth + "px";
        ind.style.translate = activa.offsetLeft + "px 0";
        ind.classList.add("listo");
        if (!animar) { void ind.offsetWidth; ind.style.transition = ""; }
      };

      new ResizeObserver(() => colocar(false)).observe(host);
      new MutationObserver(() => colocar(true)).observe(host, {
        attributes: true, attributeFilter: ["class"], subtree: true,
      });
      colocar(false);
    });
  }

  // ── Números que cuentan ────────────────────────────────────
  // Anima desde el último valor mostrado para esa etiqueta (0 la primera
  // vez), así un repintado con el mismo número no vuelve a contar.
  const _ultimoValor = new Map();

  function animarNumero(el) {
    if (el.dataset.contado === el.textContent) return;
    const original = el.textContent.trim();
    const m = original.match(/^([^\d-]*)(-?\d{1,3}(?:\.\d{3})+|-?\d+)(\D*)$/);
    if (!m) { el.dataset.contado = el.textContent; return; }

    const hasta = parseInt(m[2].replace(/\./g, ""), 10);
    const clave = (el.previousElementSibling?.textContent || "") + "|" + (el.closest("[id]")?.id || "");
    const desde = _ultimoValor.has(clave) ? _ultimoValor.get(clave) : 0;
    _ultimoValor.set(clave, hasta);
    el.dataset.contado = original;
    if (reducido.matches || desde === hasta || !isFinite(hasta)) return;

    const dur = 650, t0 = performance.now();
    const paso = (t) => {
      if (!el.isConnected) return;
      const p = Math.min(1, (t - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = p < 1
        ? m[1] + Math.round(desde + (hasta - desde) * ease).toLocaleString("es-PY") + m[3]
        : original;
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  function initNumerosQueCuentan() {
    const ids = ["dashboard-content", "informes-caja-kpis", "informes-operacion-kpis"];
    const procesar = (root) => {
      root.querySelectorAll?.(".dash-kpi-value, .informes-kpi-value").forEach(animarNumero);
    };
    ids.forEach((id) => {
      const cont = document.getElementById(id);
      if (!cont) return;
      new MutationObserver((muts) => {
        for (const mu of muts) mu.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.(".dash-kpi-value, .informes-kpi-value")) animarNumero(n);
          else procesar(n);
        });
      }).observe(cont, { childList: true, subtree: true });
    });
  }

  // ── Botón .btn-save: spinner mientras está deshabilitado por guardar ──
  // Los módulos ya deshabilitan el botón y cambian su texto a "Guardando…".
  // Solo se marca como "cargando" si el clic mismo lo deshabilitó (así no
  // se muestra spinner en botones que están inactivos por validación).
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-save");
    if (!btn || btn.disabled) return;
    setTimeout(() => {
      if (!btn.disabled) return;
      btn.classList.add("btn-cargando");
      const mo = new MutationObserver(() => {
        if (!btn.disabled || !btn.isConnected) {
          btn.classList.remove("btn-cargando");
          mo.disconnect();
        }
      });
      mo.observe(btn, { attributes: true, attributeFilter: ["disabled"] });
    }, 0);
  }, true);

  // ── Pull-to-refresh ────────────────────────────────────────
  // Qué recarga cada vista (usa las mismas funciones con las que se carga).
  const REFRESCAR = {
    "dashboard":          () => loadDashboard(),
    "clientes":           async () => {
      await loadPassengers();
      if (document.getElementById("search-input")?.value.trim()) filterPassengers();
    },
    "viajes":             () => loadViajes("activos"),
    "historico":          () => loadViajes("historico"),
    "recibos":            () => cargarRecibos(),
    "movimientos":        () => cargarMovimientos(),
    "activity-log":       () => loadActivityLog({ reset: true }),
    "usuarios":           () => (_usuariosTabActual === "app" ? loadUsers() : loadUsersReservas()),
    "facturas-internas":  () => loadFacturas(),
    "facturas-marangatu": () => loadMarangatu(),
    "informes":           () => loadInformes(),
    "byc":                () => initBycView(),
    "legales":            () => loadLegales(),
  };

  const UMBRAL = 64;   // px (ya con resistencia) para disparar la recarga
  const MAXIMO = 96;

  function initPullToRefresh() {
    const ptr = document.createElement("div");
    ptr.className = "ptr";
    ptr.setAttribute("aria-hidden", "true");
    ptr.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>`;
    document.body.appendChild(ptr);

    let y0 = 0, dist = 0, tirando = false, activo = false, refrescando = false, avisado = false;

    const hayCapaAbierta = () =>
      !!document.querySelector("dialog[open], .modulos-sheet.open") || window._csSheetOpen;

    function mover(d) {
      ptr.style.translate = "0 " + (d - 44) + "px";
      ptr.style.opacity = String(Math.min(1, d / UMBRAL));
      ptr.style.setProperty("--ptr-rot", (d / UMBRAL) * 270 + "deg");
    }

    function ocultar() {
      ptr.classList.remove("arrastrando", "cargando");
      ptr.style.translate = "";
      ptr.style.opacity = "";
    }

    document.addEventListener("touchstart", (e) => {
      activo = false;
      if (refrescando || e.touches.length !== 1) return;
      if (!REFRESCAR[currentView] || window.scrollY > 0 || hayCapaAbierta()) return;
      if (e.target.closest("input, textarea, select, canvas, [contenteditable='true'], .modulos-sheet")) return;
      y0 = e.touches[0].clientY;
      dist = 0; tirando = false; avisado = false;
      activo = true;
    }, { passive: true });

    document.addEventListener("touchmove", (e) => {
      if (!activo) return;
      if (window.scrollY > 0) { activo = false; if (tirando) { tirando = false; ocultar(); } return; }
      const delta = e.touches[0].clientY - y0;
      if (delta <= 6) { if (tirando) { tirando = false; ocultar(); } return; }
      if (!tirando) { tirando = true; ptr.classList.add("arrastrando"); }
      e.preventDefault();
      dist = Math.min(MAXIMO, delta * 0.5);   // resistencia, como el scroll nativo
      mover(dist);
      if (dist >= UMBRAL && !avisado) { avisado = true; window.haptic(10); }
      if (dist < UMBRAL) avisado = false;
    }, { passive: false });

    async function terminar() {
      if (!activo || !tirando) { activo = false; return; }
      activo = false; tirando = false;
      ptr.classList.remove("arrastrando");

      if (dist < UMBRAL) { ocultar(); return; }

      refrescando = true;
      ptr.classList.add("cargando");
      mover(UMBRAL);
      const t0 = Date.now();
      try {
        await REFRESCAR[currentView]?.();
      } catch (err) {
        console.error("[ptr] error al refrescar:", err);
      }
      // Mínimo visible para que no parpadee si la recarga es instantánea
      const resto = 700 - (Date.now() - t0);
      if (resto > 0) await new Promise((r) => setTimeout(r, resto));
      ocultar();
      refrescando = false;
    }

    document.addEventListener("touchend", terminar, { passive: true });
    document.addEventListener("touchcancel", terminar, { passive: true });
  }

  document.addEventListener("DOMContentLoaded", () => {
    initTabsDeslizantes();
    initNumerosQueCuentan();
    initPullToRefresh();
  });
})();
