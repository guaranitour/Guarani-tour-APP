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
let _calDiaModalDate = null;

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
        .then((eventos) => success(eventos))
        .catch((err) => { console.error(err); failure(err); });
    },
    datesSet: (info) => {
      _actualizarTituloToolbar(info.view.currentStart);
      _pintarDotsDelMes();
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
            _abrirDiaModal(arg.date);
          }
        });
      }
    },
    dateClick: (info) => _abrirDiaModal(info.date),
  });

  _fcInstance.render();
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

function calendarioIrMesAnterior() { if (_fcInstance) _fcInstance.prev(); }
function calendarioIrMesSiguiente() { if (_fcInstance) _fcInstance.next(); }
function calendarioIrHoy() { if (_fcInstance) _fcInstance.today(); }

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
    const fNac = new Date(p["Fecha de nacimiento"]);
    if (isNaN(fNac)) return;
    const mes = fNac.getMonth();
    const dia = fNac.getDate();

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

/* ── Dots por día (reemplazan las barras de evento nativas) ──── */
function _pintarDotsDelMes() {
  // Limpiar dots previos
  document.querySelectorAll(".calendario-day-dots").forEach((el) => el.remove());
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
    const dotsWrap = document.createElement("div");
    dotsWrap.className = "calendario-day-dots";
    ["viaje", "cumple", "evento"].forEach((tipo) => {
      if (tiposPresentes.has(tipo)) {
        const dot = document.createElement("span");
        dot.className = `calendario-day-dot calendario-day-dot--${tipo}`;
        dotsWrap.appendChild(dot);
      }
    });

    const frame = celda.querySelector(".fc-daygrid-day-events") || celda.querySelector(".fc-daygrid-day-frame");
    if (frame) frame.appendChild(dotsWrap);
  });
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

/* ── Popover / modal del día ──────────────────────────────────── */
function _abrirDiaModal(date) {
  _calDiaModalDate = date;
  const fechaStr = _isoFecha(date);
  const porDia = _agruparPorDia(_calEventosCache || []);
  const eventosDia = porDia[fechaStr] || [];

  const modal = document.getElementById("calendario-dia-modal");
  const titulo = document.getElementById("calendario-dia-titulo");
  const body = document.getElementById("calendario-dia-body");
  if (!modal || !titulo || !body) return;

  titulo.textContent = date.toLocaleDateString("es-PY", {
    weekday: "long", day: "numeric", month: "long",
  });

  if (eventosDia.length === 0) {
    body.innerHTML = `<div class="calendario-evento-empty">Sin eventos este día.</div>`;
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
    }).join("");
  }

  const btnNuevoAca = document.getElementById("calendario-dia-nuevo-btn");
  if (btnNuevoAca) btnNuevoAca.dataset.fecha = fechaStr;

  modal.showModal();
}

function cerrarCalendarioDiaModal() {
  const modal = document.getElementById("calendario-dia-modal");
  if (modal && modal.open) modal.close();
}

function _calAbrirViaje(viajeId) {
  cerrarCalendarioDiaModal();
  if (typeof openViajeDetalle === "function") openViajeDetalle(viajeId);
}

function _calAbrirPasajero(pasajeroId) {
  cerrarCalendarioDiaModal();
  navigateTo("detalle", pasajeroId);
}

/* ── Nuevo evento propio ──────────────────────────────────────── */
function abrirCalendarioNuevoEvento() {
  const fechaPrellenada = document.getElementById("calendario-dia-nuevo-btn")?.dataset.fecha
    || (_calDiaModalDate ? _isoFecha(_calDiaModalDate) : _isoFecha(new Date()));

  cerrarCalendarioDiaModal();

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
  if (_fcInstance) _fcInstance.refetchEvents();
}

/* ── Utilidades ──────────────────────────────────────────────── */
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
