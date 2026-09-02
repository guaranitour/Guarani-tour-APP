/* ══════════════════════════════════════════════════════════════
   CALENDARIO
   Módulo del menú, accesible a todos los roles (admin/worker/
   viewer/finanzas). Fuentes de eventos:
     1) Viajes activos/históricos → rango fecha_salida → fecha_regreso
     2) Cumpleaños de pasajeros → "Fecha de nacimiento", recurrente
        cada año (mes/día fijos, año se recalcula al vuelo)
     3) Eventos propios → tabla eventos_calendario (CRUD simple)

   Requiere FullCalendar (cargado por CDN en index.html) y que
   currentUserRole / supabaseClient / formatFecha ya existan
   (definidos en app.js / supabaseClient.js, cargados antes).
   ══════════════════════════════════════════════════════════════ */

let _fcInstance = null;
let _calEventosCache = null; // eventos ya normalizados de la carga más reciente
let _calDiaSeleccionada = null; // Date del día activo en el panel inline

/* ── Entrada del módulo (llamada desde navigateTo) ───────────── */
async function initCalendario() {
  await _cargarLibFullCalendarSiHaceFalta();

  const el = document.getElementById("calendario-fc");
  if (!el) return;

  if (_fcInstance) {
    // Ya inicializado en esta sesión: solo refrescar datos y refetch.
    await _cargarEventosCalendario();
    _fcInstance.refetchEvents();
    _fcInstance.updateSize();
    return;
  }

  _fcInstance = new FullCalendar.Calendar(el, {
    initialView: "dayGridMonth",
    locale: "es",
    firstDay: 1,
    headerToolbar: false, // usamos el toolbar custom (más compacto en mobile)
    height: "auto",
    fixedWeekCount: false,
    dayMaxEvents: false,   // no listamos eventos dentro de la celda (ver dots)
    events: (info, success, failure) => {
      _cargarEventosCalendario()
        .then((eventos) => {
          success(eventos);
          // En la carga inicial, `datesSet` puede dispararse antes de que
          // este fetch resuelva (_calEventosCache todavía null), así que
          // _pintarBarrasDelMes() no pintaba nada y nadie la volvía a llamar.
          // Repintamos acá, una vez que el cache ya tiene datos. El rAF da
          // un tick para que FullCalendar termine de aplicar el DOM tras
          // el success() antes de que busquemos las celdas .fc-daygrid-day.
          requestAnimationFrame(() => {
            _pintarBarrasDelMes();
            _marcarDiaSeleccionado();
          });
        })
        .catch((err) => { console.error(err); failure(err); });
    },
    datesSet: (info) => {
      _actualizarTituloToolbar(info.view.currentStart);
      _pintarBarrasDelMes();
      _marcarDiaSeleccionado();
      // Primera carga: seleccionamos "hoy" para que el panel inline
      // nunca arranque vacío (igual que Samsung Calendar).
      if (!_calDiaSeleccionada) _seleccionarDia(new Date());
    },
    dayCellDidMount: (arg) => {
      // Accesibilidad: cada celda de día es enfocable/activable por
      // teclado, no solo clickeable.
      const numEl = arg.el.querySelector(".fc-daygrid-day-number");
      if (numEl) {
        numEl.setAttribute("role", "button");
        numEl.setAttribute("tabindex", "0");
        numEl.setAttribute(
          "aria-label",
          arg.date.toLocaleDateString("es-PY", { day: "numeric", month: "long", year: "numeric" })
        );
        numEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            _seleccionarDia(arg.date);
          }
        });
      }
    },
    dateClick: (info) => _seleccionarDia(info.date),
  });

  _fcInstance.render();
  _initSwipeCalendario();
}

/* ── Swipe horizontal para cambiar de mes ─────────────────────
   Mismo patrón que _initSwipeTabsViaje en viajes_activos.js: se
   distingue gesto horizontal de scroll vertical con un umbral chico
   antes de decidir, y solo se bloquea el scroll nativo (preventDefault)
   una vez confirmado que el gesto es horizontal. ──────────────── */
let _swipeCalendarioInit = false;
function _initSwipeCalendario() {
  if (_swipeCalendarioInit) return;
  _swipeCalendarioInit = true;

  const wrap = document.getElementById("calendario-fc");
  if (!wrap) return;

  let startX = 0, startY = 0, tracking = false, isHorizontal = false;
  const UMBRAL_DIRECCION = 10;
  const UMBRAL_CAMBIO    = 50;

  wrap.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
    isHorizontal = false;
  }, { passive: true });

  wrap.addEventListener("touchmove", (e) => {
    if (!tracking || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;

    if (!isHorizontal && (Math.abs(dx) > UMBRAL_DIRECCION || Math.abs(dy) > UMBRAL_DIRECCION)) {
      isHorizontal = Math.abs(dx) > Math.abs(dy);
    }
    if (isHorizontal) e.preventDefault();
  }, { passive: false });

  wrap.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    if (!isHorizontal) return;

    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < UMBRAL_CAMBIO) return;

    // Deslizar hacia la izquierda → mes siguiente. Hacia la derecha → mes anterior.
    if (dx < 0) calendarioIrMesSiguiente();
    else calendarioIrMesAnterior();
  }, { passive: true });
}

/* ── Carga de FullCalendar por CDN (una sola vez, cacheada) ──── */
let _fcLibPromise = null;
function _cargarLibFullCalendarSiHaceFalta() {
  if (window.FullCalendar) return Promise.resolve();
  if (_fcLibPromise) return _fcLibPromise;

  _fcLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo cargar FullCalendar"));
    document.head.appendChild(script);
  });
  return _fcLibPromise;
}

/* ── Toolbar custom ───────────────────────────────────────────── */
function _actualizarTituloToolbar(fecha) {
  const el = document.getElementById("calendario-toolbar-titulo");
  if (!el) return;
  el.textContent = fecha.toLocaleDateString("es-PY", { month: "long", year: "numeric" });
}

function calendarioIrMesAnterior() { _cambiarMesConCarrusel(-1); }
function calendarioIrMesSiguiente() { _cambiarMesConCarrusel(1); }
function calendarioIrHoy() { if (_fcInstance) _fcInstance.today(); }

/* ── Animación de carrusel al cambiar de mes ──────────────────
   FullCalendar no soporta dos meses visibles a la vez, así que se
   simula: se clona el grid actual como "foto" congelada, se deja
   que FullCalendar renderice el mes nuevo por debajo (invisible
   momentáneamente, tapado por el clon), y luego se animan ambos
   con translateX — el clon (mes viejo) saliendo, el grid real (mes
   nuevo) entrando desde el lado opuesto.

   direccion: 1 = mes siguiente (contenido entra desde la derecha),
             -1 = mes anterior (contenido entra desde la izquierda). */
let _calCarruselAnimando = false;
function _cambiarMesConCarrusel(direccion) {
  if (!_fcInstance || _calCarruselAnimando) return; // evita solapar swipes/clicks rápidos

  const wrap = document.querySelector(".calendario-wrap");
  const grid = document.getElementById("calendario-fc");
  if (!wrap || !grid) { _fcInstance[direccion === 1 ? "next" : "prev"](); return; }

  // Respeta prefers-reduced-motion: cambia de mes sin animación.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    _fcInstance[direccion === 1 ? "next" : "prev"]();
    return;
  }

  _calCarruselAnimando = true;

  const anchoWrap = wrap.getBoundingClientRect().width;

  // 1) Clon congelado del mes actual, superpuesto en la misma posición.
  const clon = grid.cloneNode(true);
  clon.id = "";
  clon.setAttribute("aria-hidden", "true");
  clon.style.cssText = `
    position:absolute; top:0; left:0; width:100%;
    margin:0; z-index:2; pointer-events:none;
    transition:transform .28s cubic-bezier(.22,.61,.36,1);
    transform:translateX(0);
  `;
  wrap.appendChild(clon);

  // 2) Dispara el cambio real: FullCalendar re-renderiza `grid` por
  // debajo del clon (queda tapado, no se ve el "salto").
  _fcInstance[direccion === 1 ? "next" : "prev"]();

  // 3) El grid real arranca la animación desplazado hacia el lado por
  // el que "entra", sin transición todavía (evita que el navegador
  // anime este posicionamiento inicial).
  grid.style.transition = "none";
  grid.style.transform = `translateX(${direccion * anchoWrap}px)`;
  grid.offsetHeight; // fuerza reflow: aplica el translate de arranque antes de animar

  requestAnimationFrame(() => {
    grid.style.transition = "transform .28s cubic-bezier(.22,.61,.36,1)";
    grid.style.transform = "translateX(0)";
    clon.style.transform = `translateX(${-direccion * anchoWrap}px)`;
  });

  const limpiar = () => {
    clon.remove();
    grid.style.transition = "";
    grid.style.transform = "";
    _calCarruselAnimando = false;
  };
  grid.addEventListener("transitionend", limpiar, { once: true });
  // Salvavidas: si transitionend no dispara (ej. el elemento se
  // desmonta o el navegador no emite el evento), no queremos dejar
  // el calendario bloqueado en animando=true para siempre.
  setTimeout(() => { if (_calCarruselAnimando) limpiar(); }, 400);
}

/* ── Carga y normalización de eventos ─────────────────────────
   Se combinan las 3 fuentes en un solo array de "eventos FullCalendar"
   con extendedProps.tipo para poder distinguirlos (viaje/cumple/evento)
   al pintar los dots y al armar el popover del día. ────────────── */
async function _cargarEventosCalendario() {
  const [viajesEv, cumplesEv, propiosEv] = await Promise.all([
    _cargarEventosViajes(),
    _cargarEventosCumpleanos(),
    _cargarEventosPropios(),
  ]);
  _calEventosCache = [...viajesEv, ...cumplesEv, ...propiosEv];
  return _calEventosCache;
}

async function _cargarEventosViajes() {
  const { data, error } = await supabaseClient
    .from("viajes")
    .select("id, nombre, fecha_salida, fecha_regreso, estado");
  if (error) { console.error(error); return []; }

  return (data || [])
    .filter((v) => v.fecha_salida)
    .map((v) => ({
      id: `viaje-${v.id}`,
      title: v.nombre || "Viaje",
      start: v.fecha_salida,
      // FullCalendar trata "end" como exclusivo en eventos de todo el
      // día: sumamos 1 día para que el rango incluya el día de regreso.
      end: v.fecha_regreso ? _sumarDias(v.fecha_regreso, 1) : undefined,
      allDay: true,
      display: "list-item", // no se pinta barra: solo alimenta el dataset para los dots
      extendedProps: {
        tipo: "viaje",
        subtitulo: v.fecha_regreso
          ? `${formatFecha(v.fecha_salida)} → ${formatFecha(v.fecha_regreso)}`
          : formatFecha(v.fecha_salida),
        viajeId: v.id,
      },
    }));
}

async function _cargarEventosCumpleanos() {
  const { data, error } = await supabaseClient
    .from("pasajeros")
    .select(`id, Pasajero, "Fecha de nacimiento"`)
    .not("Fecha de nacimiento", "is", null);
  if (error) { console.error(error); return []; }

  // Recurrencia anual: se generan ocurrencias para el año actual y el
  // siguiente (suficiente para que el calendario nunca muestre un mes
  // "vacío" de cumpleaños al navegar hacia adelante).
  const anios = [new Date().getFullYear(), new Date().getFullYear() + 1];
  const eventos = [];

  (data || []).forEach((p) => {
    // No usamos new Date(p["Fecha de nacimiento"]) directamente: un string
    // "YYYY-MM-DD" se interpreta como medianoche UTC, y .getMonth()/.getDate()
    // lo devuelven en la zona horaria LOCAL del navegador. En Paraguay
    // (detrás de UTC), eso corre el día hacia atrás — a veces incluso el
    // mes, si la fecha cae a principio de mes. Por eso un cumpleaños recién
    // cargado podía no reconocerse en el día correcto. Parseamos los
    // componentes a mano para evitar esa conversión de zona horaria.
    const fechaStr = String(p["Fecha de nacimiento"] || "");
    const partes = fechaStr.split("-");
    if (partes.length !== 3) return;
    const [anioNac, mesNac, diaNac] = partes.map((n) => parseInt(n, 10));
    if (isNaN(anioNac) || isNaN(mesNac) || isNaN(diaNac)) return;
    const mes = mesNac - 1; // Date usa mes 0-indexado
    const dia = diaNac;

    anios.forEach((anio) => {
      const fechaEvento = new Date(anio, mes, dia);
      eventos.push({
        id: `cumple-${p.id}-${anio}`,
        title: `🎂 ${p.Pasajero}`,
        start: _isoFecha(fechaEvento),
        allDay: true,
        display: "list-item",
        extendedProps: {
          tipo: "cumple",
          subtitulo: "Cumpleaños",
          pasajeroId: p.id,
        },
      });
    });
  });

  return eventos;
}

async function _cargarEventosPropios() {
  const { data, error } = await supabaseClient
    .from("eventos_calendario")
    .select("id, titulo, fecha, notas");
  if (error) {
    // Tabla puede no existir todavía en instalaciones que no corrieron
    // la migración: no rompemos el calendario por esto.
    console.error(error);
    return [];
  }

  return (data || []).map((e) => ({
    id: `propio-${e.id}`,
    title: e.titulo,
    start: e.fecha,
    allDay: true,
    display: "list-item",
    extendedProps: {
      tipo: "evento",
      subtitulo: e.notas || "",
      eventoId: e.id,
    },
  }));
}

/* ── Barras de color por día (estilo Samsung Calendar) ─────────
   Reemplazan los dots sueltos por barritas horizontales apiladas
   bajo el número del día: más legibles cuando coinciden varios
   tipos de evento el mismo día. Máximo 3 (uno por tipo). ──────── */
function _pintarBarrasDelMes() {
  document.querySelectorAll(".calendario-day-bars").forEach((el) => el.remove());
  document.querySelectorAll(".calendario-day-con-eventos").forEach((el) =>
    el.classList.remove("calendario-day-con-eventos")
  );

  if (!_calEventosCache) return;

  const porDia = _agruparPorDia(_calEventosCache);

  document.querySelectorAll("#calendario-fc .fc-daygrid-day").forEach((celda) => {
    const fechaStr = celda.getAttribute("data-date");
    const eventosDia = porDia[fechaStr];
    if (!eventosDia || eventosDia.length === 0) return;

    celda.classList.add("calendario-day-con-eventos");

    const tiposPresentes = new Set(eventosDia.map((e) => e.extendedProps.tipo));
    const barsWrap = document.createElement("div");
    barsWrap.className = "calendario-day-bars";
    ["viaje", "cumple", "evento"].forEach((tipo) => {
      if (tiposPresentes.has(tipo)) {
        const barra = document.createElement("span");
        barra.className = `calendario-day-bar calendario-day-bar--${tipo}`;
        barsWrap.appendChild(barra);
      }
    });

    const frame = celda.querySelector(".fc-daygrid-day-events") || celda.querySelector(".fc-daygrid-day-frame");
    if (frame) frame.appendChild(barsWrap);
  });
}

/* ── Resalta la celda del día activo con un recuadro redondeado
   (equivalente al outline que usa Samsung sobre el día elegido). */
function _marcarDiaSeleccionado() {
  document.querySelectorAll("#calendario-fc .calendario-day-seleccionado").forEach((el) =>
    el.classList.remove("calendario-day-seleccionado")
  );
  if (!_calDiaSeleccionada) return;
  const fechaStr = _isoFecha(_calDiaSeleccionada);
  const celda = document.querySelector(`#calendario-fc .fc-daygrid-day[data-date="${fechaStr}"]`);
  if (celda) celda.classList.add("calendario-day-seleccionado");
}

function _agruparPorDia(eventos) {
  const mapa = {};
  eventos.forEach((ev) => {
    // Para eventos con rango (viajes), marcamos el dot en cada día del rango.
    const inicio = new Date(ev.start + "T00:00:00");
    const fin = ev.end ? new Date(ev.end + "T00:00:00") : new Date(ev.start + "T00:00:00");
    for (let d = new Date(inicio); d < fin || _isoFecha(d) === ev.start; d.setDate(d.getDate() + 1)) {
      const key = _isoFecha(d);
      if (!mapa[key]) mapa[key] = [];
      mapa[key].push(ev);
      if (_isoFecha(d) === ev.start && !ev.end) break;
    }
  });
  return mapa;
}

/* ── Panel inline del día (reemplaza el popover) ────────────────
   Al tocar un día se actualiza este panel en el lugar, debajo del
   calendario — sin overlay ni modal, igual que Samsung Calendar.
   Se reutiliza en: dateClick, teclado (Enter/Espacio) y al cambiar
   de mes (ver datesSet). ──────────────────────────────────────── */
function _seleccionarDia(date) {
  _calDiaSeleccionada = date;
  _marcarDiaSeleccionado();

  const fechaStr = _isoFecha(date);
  const porDia = _agruparPorDia(_calEventosCache || []);
  const eventosDia = porDia[fechaStr] || [];

  const numEl = document.getElementById("calendario-dia-panel-num");
  const dowEl = document.getElementById("calendario-dia-panel-dow");
  const mesEl = document.getElementById("calendario-dia-panel-mes");
  const body = document.getElementById("calendario-dia-panel-body");
  if (!numEl || !dowEl || !mesEl || !body) return;

  numEl.textContent = date.getDate();
  // Jerarquía: día de semana como texto principal secundario (medio,
  // color base), mes como caption de contexto (chico, muted) — el
  // número grande sigue siendo el elemento dominante del header.
  dowEl.textContent = date.toLocaleDateString("es-PY", { weekday: "long" });
  mesEl.textContent = date.toLocaleDateString("es-PY", { month: "long", year: "numeric" });

  if (eventosDia.length === 0) {
    body.innerHTML = `
      <div class="calendario-evento-empty">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <rect x="3" y="4" width="18" height="17" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/>
        </svg>
        <p>Sin eventos este día.</p>
        <button type="button" class="calendario-evento-empty-btn" onclick="abrirCalendarioNuevoEvento()">
          + Agregar evento
        </button>
      </div>`;
  } else {
    body.innerHTML = eventosDia.map((ev) => {
      const tipo = ev.extendedProps.tipo;
      const onclick = tipo === "viaje"
        ? `onclick="_calAbrirViaje('${ev.extendedProps.viajeId}')"`
        : tipo === "cumple"
          ? `onclick="_calAbrirPasajero('${ev.extendedProps.pasajeroId}')"`
          : "";
      return `
        <button type="button" class="calendario-evento-row" ${onclick}>
          <span class="calendario-evento-dot calendario-day-dot--${tipo}"></span>
          <span class="calendario-evento-info">
            <span class="calendario-evento-nombre">${_escapeHtml(ev.title)}</span>
            ${ev.extendedProps.subtitulo ? `<span class="calendario-evento-sub">${_escapeHtml(ev.extendedProps.subtitulo)}</span>` : ""}
          </span>
        </button>
      `;
    }).join("") + `
      <button type="button" class="calendario-evento-agregar-btn" onclick="abrirCalendarioNuevoEvento()">
        + Agregar evento este día
      </button>`;
  }
}

function _calAbrirViaje(viajeId) {
  if (typeof openViajeDetalle === "function") openViajeDetalle(viajeId);
}

function _calAbrirPasajero(pasajeroId) {
  navigateTo("detalle", pasajeroId);
}

/* ── Nuevo evento propio ──────────────────────────────────────── */
function abrirCalendarioNuevoEvento() {
  const fechaPrellenada = _calDiaSeleccionada ? _isoFecha(_calDiaSeleccionada) : _isoFecha(new Date());

  const modal = document.getElementById("calendario-nuevo-modal");
  const form = document.getElementById("calendario-nuevo-form");
  if (!modal || !form) return;
  form.reset();
  document.getElementById("cne-fecha").value = fechaPrellenada;
  modal.showModal();
}

function cerrarCalendarioNuevoEvento() {
  const modal = document.getElementById("calendario-nuevo-modal");
  if (modal && modal.open) modal.close();
}

async function guardarCalendarioNuevoEvento(ev) {
  ev.preventDefault();
  const titulo = document.getElementById("cne-titulo").value.trim();
  const fecha = document.getElementById("cne-fecha").value;
  const notas = document.getElementById("cne-notas").value.trim();

  if (!titulo || !fecha) return;

  const btn = document.getElementById("cne-guardar-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("eventos_calendario")
    .insert({ titulo, fecha, notas: notas || null });

  if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }

  if (error) {
    console.error(error);
    _calendarioToast("No se pudo guardar el evento.", true);
    return;
  }

  cerrarCalendarioNuevoEvento();
  _calendarioToast("Evento creado.");
  // Recargamos el cache antes de refetch para poder repintar el panel
  // inline de inmediato (refetchEvents no devuelve promesa en FC6).
  await _cargarEventosCalendario();
  if (_fcInstance) _fcInstance.refetchEvents();
  if (_calDiaSeleccionada) _seleccionarDia(_calDiaSeleccionada);
}

/* ── Selector rápido de mes/año (bottom sheet) ────────────────
   No agrega entrada de historial (a diferencia de #modulos-sheet):
   se cierra por overlay/X, sin interferir con el manejo de popstate
   global de app.js. */
function abrirCalendarioSelectorFecha() {
  if (!_fcInstance) return;
  const actual = _fcInstance.getDate();
  _poblarSelectMesAnio(actual.getMonth(), actual.getFullYear());

  const sheet = document.getElementById("calendario-fecha-sheet");
  const overlay = document.getElementById("calendario-fecha-overlay");
  if (!sheet || !overlay) return;
  sheet.classList.add("open");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function cerrarCalendarioSelectorFecha() {
  const sheet = document.getElementById("calendario-fecha-sheet");
  const overlay = document.getElementById("calendario-fecha-overlay");
  if (sheet) sheet.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  document.body.style.overflow = "";
}

const _CAL_MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function _poblarSelectMesAnio(mesActual, anioActual) {
  const selMes = document.getElementById("cal-filtro-mes");
  const selAnio = document.getElementById("cal-filtro-anio");
  if (!selMes || !selAnio) return;

  selMes.innerHTML = _CAL_MESES.map((m, i) =>
    `<option value="${i}" ${i === mesActual ? "selected" : ""}>${m}</option>`
  ).join("");

  // Rango razonable: 3 años atrás a 3 años adelante del año actual real
  // (no del navegado), suficiente para viajes/eventos planificados con
  // anticipación sin volverse un selector infinito.
  const anioHoy = new Date().getFullYear();
  const anios = [];
  for (let a = anioHoy - 3; a <= anioHoy + 3; a++) anios.push(a);
  if (!anios.includes(anioActual)) anios.push(anioActual);
  anios.sort((a, b) => a - b);

  selAnio.innerHTML = anios.map((a) =>
    `<option value="${a}" ${a === anioActual ? "selected" : ""}>${a}</option>`
  ).join("");
}

function calendarioAplicarFiltroFecha() {
  const mes = parseInt(document.getElementById("cal-filtro-mes").value, 10);
  const anio = parseInt(document.getElementById("cal-filtro-anio").value, 10);
  if (isNaN(mes) || isNaN(anio) || !_fcInstance) return;

  _fcInstance.gotoDate(new Date(anio, mes, 1));
  cerrarCalendarioSelectorFecha();
}
function _isoFecha(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function _sumarDias(fechaStr, n) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return _isoFecha(d);
}
function _escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

/* Toast mínimo propio (no se asume un sistema global de toasts para
   no depender de un módulo no incluido en este cambio). */
function _calendarioToast(msg, esError = false) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.setAttribute("role", "status");
  el.style.cssText = `
    position:fixed; left:50%; bottom:calc(6rem + env(safe-area-inset-bottom,0px));
    transform:translateX(-50%); z-index:400;
    background:${esError ? "var(--danger)" : "var(--accent)"}; color:#fff;
    padding:.65rem 1.1rem; border-radius:10px; font-size:.85rem;
    box-shadow:var(--shadow-md); max-width:calc(100vw - 2rem); text-align:center;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
