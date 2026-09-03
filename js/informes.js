// ============================================================
// INFORMES — Caja y Operación
// Vista de reportes por rango de fechas (mes actual / 3m / 6m /
// personalizado), con dos pestañas:
//   - Caja: fuente movimientos_bancarios (ingresos/egresos reales
//     de caja E.A.S., excluyendo Club Destino).
//   - Operación: fuente viajes + viaje_pasajeros + pagos + egresos
//     + presupuesto_viaje (rentabilidad y ejecución por viaje).
//
// Reutiliza clases visuales ya existentes en dashboard.css
// (.dash-comp-*, .dash-bar-*, .dash-state) para que el comparativo
// de ingresos/egresos por viaje se vea idéntico al del dashboard.
//
// Depende de: supabaseClient, currentUserRole (app.js/app_1.js),
// _dashIcons (dashboard.js), Chart.js (cargado por CDN en index.html).
// ============================================================

let _informesRango = { tipo: "mes", desde: null, hasta: null };
let _informesTabActiva = "caja";
let _informesChartCaja = null;
let _informesChartCategoria = null;
let _informesChartPresupuesto = null;
let _informesYaInicializado = false; // conserva rango/pestaña entre visitas dentro de la misma sesión

// ------------------------------------------------------------------
// Entrada de la vista
// ------------------------------------------------------------------
function loadInformes() {
  _bindTabsInformes();

  if (!_informesYaInicializado) {
    _aplicarRangoInformes("mes");
    _informesYaInicializado = true;
    return;
  }

  // Ya se visitó antes en esta sesión: restaura pestaña y vuelve a
  // consultar el mismo rango (los datos pueden haber cambiado).
  _cambiarTabInformes(_informesTabActiva);
  document.querySelectorAll("#view-informes .informes-range-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.range === _informesRango.tipo);
  });
  _cargarInformesCaja();
  _cargarInformesOperacion();
}

function _bindTabsInformes() {
  document.querySelectorAll("#view-informes .informes-tab-btn").forEach(btn => {
    btn.onclick = () => _cambiarTabInformes(btn.dataset.tab);
  });
  document.querySelectorAll("#view-informes .informes-range-chip").forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.range === "custom") {
        _abrirRangoPersonalizado();
      } else {
        _aplicarRangoInformes(btn.dataset.range);
      }
    };
  });
}

function _cambiarTabInformes(tab) {
  _informesTabActiva = tab;
  document.querySelectorAll("#view-informes .informes-tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.getElementById("informes-panel-caja").style.display = tab === "caja" ? "" : "none";
  document.getElementById("informes-panel-operacion").style.display = tab === "operacion" ? "" : "none";
}

// ------------------------------------------------------------------
// Selector de rango
// ------------------------------------------------------------------
function _rangoDeFechas(tipo) {
  const hoy = new Date();
  let desde, hasta;
  hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); // fin del mes actual

  if (tipo === "mes") {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else if (tipo === "3m") {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  } else if (tipo === "6m") {
    desde = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1);
  } else {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  }
  return {
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
  };
}

function _aplicarRangoInformes(tipo) {
  const { desde, hasta } = _rangoDeFechas(tipo);
  _informesRango = { tipo, desde, hasta };

  document.querySelectorAll("#view-informes .informes-range-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.range === tipo);
  });

  _cargarInformesCaja();
  _cargarInformesOperacion();
}

function _abrirRangoPersonalizado() {
  const modal = document.getElementById("modal-rango-informes");
  if (!modal) return;
  document.getElementById("informes-rango-desde").value = _informesRango.desde;
  document.getElementById("informes-rango-hasta").value = _informesRango.hasta;
  modal.showModal();
}

function confirmarRangoPersonalizadoInformes() {
  const desde = document.getElementById("informes-rango-desde").value;
  const hasta = document.getElementById("informes-rango-hasta").value;
  if (!desde || !hasta) { alert("Selecciona ambas fechas."); return; }
  if (desde > hasta) { alert("La fecha 'desde' no puede ser posterior a 'hasta'."); return; }

  _informesRango = { tipo: "custom", desde, hasta };
  document.querySelectorAll("#view-informes .informes-range-chip").forEach(b => {
    b.classList.toggle("active", b.dataset.range === "custom");
  });
  document.getElementById("modal-rango-informes").close();

  _cargarInformesCaja();
  _cargarInformesOperacion();
}

// Genera los labels de mes (para el eje X) entre desde/hasta, en orden.
function _mesesEnRango(desde, hasta) {
  const meses = [];
  const nombresCortos = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  let cursor = new Date(desde + "T00:00:00");
  const fin = new Date(hasta + "T00:00:00");
  while (cursor <= fin) {
    meses.push({
      key: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
      label: nombresCortos[cursor.getMonth()],
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return meses;
}

// ------------------------------------------------------------------
// PESTAÑA CAJA — fuente: movimientos_bancarios
// ------------------------------------------------------------------
async function _cargarInformesCaja() {
  const root = document.getElementById("informes-panel-caja");
  if (!root) return;

  const kpis = document.getElementById("informes-caja-kpis");
  kpis.innerHTML = `<div class="dash-state">Cargando…</div>`;

  const { desde, hasta } = _informesRango;

  const { data, error } = await supabaseClient
    .from("movimientos_bancarios")
    .select("fecha, tipo, categoria, monto")
    .gte("fecha", desde)
    .lte("fecha", hasta);

  if (error) {
    console.error("[informes] error cargando movimientos_bancarios:", error);
    kpis.innerHTML = `<div class="dash-state">⚠️ No se pudieron cargar los datos de caja.</div>`;
    return;
  }

  // Club Destino se excluye del balance operativo: es fondo de socios,
  // no ingresos/egresos de la empresa (ver conversación de diseño).
  const movs = (data || []).filter(m => m.categoria !== "Club Destino");

  let ingresos = 0, egresos = 0;
  const porCategoria = {};
  const porMes = {};

  movs.forEach(m => {
    const monto = m.monto || 0;
    if (m.tipo === "Ingreso") ingresos += monto;
    else if (m.tipo === "Egreso") egresos += monto;

    if (m.tipo === "Egreso") {
      porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + monto;
    }

    const mesKey = (m.fecha || "").slice(0, 7); // "YYYY-MM"
    if (!porMes[mesKey]) porMes[mesKey] = { ingresos: 0, egresos: 0 };
    if (m.tipo === "Ingreso") porMes[mesKey].ingresos += monto;
    else if (m.tipo === "Egreso") porMes[mesKey].egresos += monto;
  });

  const balance = ingresos - egresos;

  kpis.innerHTML = `
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Ingresos</div>
      <div class="informes-kpi-value">Gs. ${Math.round(ingresos).toLocaleString("es-PY")}</div>
    </div>
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Egresos</div>
      <div class="informes-kpi-value">Gs. ${Math.round(egresos).toLocaleString("es-PY")}</div>
    </div>
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Balance</div>
      <div class="informes-kpi-value ${balance >= 0 ? "positivo" : "negativo"}">${balance >= 0 ? "+" : ""}Gs. ${Math.round(balance).toLocaleString("es-PY")}</div>
    </div>
  `;

  _renderChartEvolucionCaja(porMes);
  _renderChartCategoriaCaja(porCategoria);
}

function _renderChartEvolucionCaja(porMes) {
  const meses = _mesesEnRango(_informesRango.desde, _informesRango.hasta);
  const dataIngresos = meses.map(m => Math.round((porMes[m.key]?.ingresos || 0)));
  const dataEgresos  = meses.map(m => Math.round((porMes[m.key]?.egresos  || 0)));

  if (_informesChartCaja) _informesChartCaja.destroy();

  const canvas = document.getElementById("informes-chart-caja");
  if (!canvas) return;

  _informesChartCaja = new Chart(canvas, {
    type: "line",
    data: {
      labels: meses.map(m => m.label),
      datasets: [
        { label: "Ingresos", data: dataIngresos, borderColor: "#2a78d6", backgroundColor: "rgba(42,120,214,0.1)", fill: true, tension: .3, pointRadius: 3 },
        { label: "Egresos", data: dataEgresos, borderColor: "#eb6834", backgroundColor: "rgba(235,104,52,0.1)", fill: true, tension: .3, pointRadius: 3, borderDash: [5, 3] },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => "Gs " + Number(v).toLocaleString("es-PY") }, grid: { color: "#e1e0d9" } },
        x: { grid: { display: false } },
      },
    },
  });
}

function _renderChartCategoriaCaja(porCategoria) {
  const entradas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

  if (_informesChartCategoria) _informesChartCategoria.destroy();
  const canvas = document.getElementById("informes-chart-categoria");
  if (!canvas) return;

  if (entradas.length === 0) {
    canvas.parentElement.innerHTML = `<div class="dash-state">Sin egresos de caja en el período.</div>`;
    return;
  }

  _informesChartCategoria = new Chart(canvas, {
    type: "bar",
    data: {
      labels: entradas.map(e => e[0]),
      datasets: [{ data: entradas.map(e => Math.round(e[1])), backgroundColor: "#eb6834", borderRadius: 4, maxBarThickness: 24 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: v => "Gs " + Number(v).toLocaleString("es-PY") }, grid: { color: "#e1e0d9" } },
        y: { grid: { display: false } },
      },
    },
  });
}

// ------------------------------------------------------------------
// PESTAÑA OPERACIÓN — fuente: viajes + viaje_pasajeros + pagos + egresos
// + presupuesto_viaje
// ------------------------------------------------------------------
async function _cargarInformesOperacion() {
  const kpis = document.getElementById("informes-operacion-kpis");
  const listaViajes = document.getElementById("informes-viajes-comparativo");
  if (!kpis) return;

  kpis.innerHTML = `<div class="dash-state">Cargando…</div>`;
  listaViajes.innerHTML = "";

  const { desde, hasta } = _informesRango;

  const { data: viajesData, error: errViajes } = await supabaseClient
    .from("viajes")
    .select("id, nombre, estado, fecha_salida")
    .gte("fecha_salida", desde)
    .lte("fecha_salida", hasta);

  if (errViajes) {
    console.error("[informes] error cargando viajes:", errViajes);
    kpis.innerHTML = `<div class="dash-state">⚠️ No se pudieron cargar los viajes del período.</div>`;
    return;
  }

  const viajes = (viajesData || []).filter(v => ["activo", "completado"].includes(v.estado || "activo"));
  const viajeIds = viajes.map(v => v.id);

  if (viajeIds.length === 0) {
    kpis.innerHTML = `<div class="dash-state">Sin viajes en el período seleccionado.</div>`;
    listaViajes.innerHTML = "";
    if (_informesChartPresupuesto) { _informesChartPresupuesto.destroy(); _informesChartPresupuesto = null; }
    return;
  }

  const [{ data: vpData, error: errVp }, { data: egresosData, error: errEgr }, { data: presData, error: errPres }] = await Promise.all([
    supabaseClient.from("viaje_pasajeros").select("id, viaje_id, asistencia").in("viaje_id", viajeIds),
    supabaseClient.from("egresos").select("viaje_id, monto, categoria_id").in("viaje_id", viajeIds),
    supabaseClient.from("presupuesto_viaje").select("viaje_id, categoria_id, monto_presupuestado").in("viaje_id", viajeIds),
  ]);

  if (errVp || errEgr || errPres) {
    console.error("[informes] error cargando datos de operación:", errVp || errEgr || errPres);
    kpis.innerHTML = `<div class="dash-state">⚠️ Error al cargar datos de operación.</div>`;
    return;
  }

  const vpIds = (vpData || []).map(vp => vp.id);
  const { data: pagosData, error: errPagos } = vpIds.length
    ? await supabaseClient.from("pagos").select("viaje_pasajero_id, monto, tipo").in("viaje_pasajero_id", vpIds)
    : { data: [], error: null };

  if (errPagos) {
    console.error("[informes] error cargando pagos:", errPagos);
    kpis.innerHTML = `<div class="dash-state">⚠️ Error al cargar pagos.</div>`;
    return;
  }

  // KPIs de operación
  const pasajerosAsistieron = (vpData || []).filter(vp => vp.asistencia === "Asiste").length;
  const pasajerosTotales = (vpData || []).length;
  const ocupacion = pasajerosTotales > 0 ? Math.round((pasajerosAsistieron / pasajerosTotales) * 100) : 0;

  const vpToViaje = {};
  (vpData || []).forEach(vp => { vpToViaje[vp.id] = vp.viaje_id; });
  const ingresosPorViaje = {};
  (pagosData || []).forEach(pg => {
    const viajeId = vpToViaje[pg.viaje_pasajero_id];
    if (viajeId == null) return;
    const monto = pg.monto || 0;
    if (pg.tipo === "Pago") ingresosPorViaje[viajeId] = (ingresosPorViaje[viajeId] || 0) + monto;
    else if (pg.tipo === "Devolución" || pg.tipo === "Transferencia") ingresosPorViaje[viajeId] = (ingresosPorViaje[viajeId] || 0) - monto;
  });
  const egresosPorViaje = {};
  (egresosData || []).forEach(e => { egresosPorViaje[e.viaje_id] = (egresosPorViaje[e.viaje_id] || 0) + (e.monto || 0); });

  const totalIngresos = Object.values(ingresosPorViaje).reduce((a, b) => a + b, 0);
  const totalEgresos = Object.values(egresosPorViaje).reduce((a, b) => a + b, 0);
  const rentabilidad = totalIngresos - totalEgresos;

  kpis.innerHTML = `
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Viajes en el período</div>
      <div class="informes-kpi-value">${viajes.length}</div>
    </div>
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Pasajeros transportados</div>
      <div class="informes-kpi-value">${pasajerosAsistieron}</div>
    </div>
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Ocupación (asistencia)</div>
      <div class="informes-kpi-value">${ocupacion}%</div>
    </div>
    <div class="informes-kpi-card">
      <div class="informes-kpi-label">Rentabilidad neta</div>
      <div class="informes-kpi-value ${rentabilidad >= 0 ? "positivo" : "negativo"}">${rentabilidad >= 0 ? "+" : ""}Gs. ${Math.round(rentabilidad).toLocaleString("es-PY")}</div>
    </div>
  `;

  // Reutiliza el mismo markup/clases visuales que dashboard.js
  // (.dash-comp-card, .dash-bar-*, .dash-comp-balance) para consistencia
  // visual exacta con el comparativo del dashboard.
  listaViajes.innerHTML = viajes.map(v => {
    const ingresos = ingresosPorViaje[v.id] || 0;
    const egresos = egresosPorViaje[v.id] || 0;
    const balance = ingresos - egresos;
    const max = Math.max(Math.abs(ingresos), Math.abs(egresos), 1);
    const pctIng = Math.round((Math.max(ingresos, 0) / max) * 100);
    const pctEgr = Math.round((Math.max(egresos, 0) / max) * 100);
    const estado = v.estado || "activo";

    return `
    <div class="dash-comp-card" onclick="openViajeDetalle('${v.id}')" style="cursor:pointer">
      <div class="dash-comp-header">
        <span class="dash-comp-nombre">${_escapeHtmlInformes(v.nombre || "Viaje sin nombre")}</span>
        <span class="dash-comp-estado ${estado}">${estado}</span>
      </div>
      <div class="dash-comp-rows">
        <div class="dash-comp-row ingreso">
          <span class="dash-comp-row-label">Ingresos</span>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctIng}%"></div></div>
          <span class="dash-comp-row-value">Gs. ${Math.round(ingresos).toLocaleString("es-PY")}</span>
        </div>
        <div class="dash-comp-row egreso">
          <span class="dash-comp-row-label">Egresos</span>
          <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctEgr}%"></div></div>
          <span class="dash-comp-row-value">Gs. ${Math.round(egresos).toLocaleString("es-PY")}</span>
        </div>
      </div>
      <div class="dash-comp-balance ${balance >= 0 ? "positivo" : "negativo"}">
        <span>Balance</span>
        <span>${balance >= 0 ? "+" : ""}Gs. ${Math.round(balance).toLocaleString("es-PY")}</span>
      </div>
    </div>`;
  }).join("");

  await _renderChartPresupuestoVsEjecutado(viajeIds, egresosData || [], presData || []);
}

// Presupuestado vs ejecutado, agregado por NOMBRE de categoría (no por
// categoria_id): las categorías de presupuesto pueden ser globales
// (scope null) o propias de un viaje (scope = viaje_id), así que
// distintos viajes pueden usar id's distintos para el mismo concepto.
// Se agrupa por texto tal cual está guardado — sin normalizar sinónimos.
async function _renderChartPresupuestoVsEjecutado(viajeIds, egresosData, presData) {
  const catIds = Array.from(new Set([
    ...egresosData.map(e => e.categoria_id),
    ...presData.map(p => p.categoria_id),
  ].filter(id => id != null)));

  let catMap = {};
  if (catIds.length) {
    const { data: cats, error } = await supabaseClient.from("categorias").select("id, nombre").in("id", catIds);
    if (error) {
      console.error("[informes] error cargando categorías:", error);
    } else {
      (cats || []).forEach(c => { catMap[c.id] = c.nombre; });
    }
  }

  const presupuestadoPorNombre = {};
  presData.forEach(p => {
    const nombre = catMap[p.categoria_id] || "Sin categoría";
    presupuestadoPorNombre[nombre] = (presupuestadoPorNombre[nombre] || 0) + (p.monto_presupuestado || 0);
  });

  const ejecutadoPorNombre = {};
  egresosData.forEach(e => {
    const nombre = catMap[e.categoria_id] || "Sin categoría";
    ejecutadoPorNombre[nombre] = (ejecutadoPorNombre[nombre] || 0) + (e.monto || 0);
  });

  const nombres = Array.from(new Set([...Object.keys(presupuestadoPorNombre), ...Object.keys(ejecutadoPorNombre)]));

  if (_informesChartPresupuesto) _informesChartPresupuesto.destroy();
  const canvas = document.getElementById("informes-chart-presupuesto");
  if (!canvas) return;

  if (nombres.length === 0) {
    canvas.parentElement.innerHTML = `<div class="dash-state">Sin presupuesto ni egresos categorizados en el período.</div>`;
    return;
  }

  _informesChartPresupuesto = new Chart(canvas, {
    type: "bar",
    data: {
      labels: nombres,
      datasets: [
        { label: "Presupuestado", data: nombres.map(n => Math.round(presupuestadoPorNombre[n] || 0)), backgroundColor: "#c3c2b7", borderRadius: 4, maxBarThickness: 20 },
        { label: "Ejecutado", data: nombres.map(n => Math.round(ejecutadoPorNombre[n] || 0)), backgroundColor: "#2a78d6", borderRadius: 4, maxBarThickness: 20 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { callback: v => "Gs " + Number(v).toLocaleString("es-PY") }, grid: { color: "#e1e0d9" } },
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45 } },
      },
    },
  });
}

function _escapeHtmlInformes(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}
