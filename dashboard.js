/* ─────────────────────────────────────────────
   dashboard.js — Panel de control (resumen general)
───────────────────────────────────────────── */

// ── Iconos inline reutilizables ─────────────────────────────
const _dashIcons = {
  pasajeros: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  viajes: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  puntos: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  balance: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
  ranking: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/></svg>`,
  calendario: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`,
  panel: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>`,
  cerrar: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  flecha: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
  byc:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
};

// ── Pill de aviso en el Home ────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (localStorage.getItem("dashPillDismissed") === "1") {
    const pill = document.getElementById("dashboard-announce-pill");
    if (pill) pill.style.display = "none";
  }
});

function dismissDashboardPill() {
  localStorage.setItem("dashPillDismissed", "1");
  const pill = document.getElementById("dashboard-announce-pill");
  if (pill) pill.style.display = "none";
}

// ── Carga principal del panel ───────────────────────────────
async function loadDashboard() {
  const root = document.getElementById("dashboard-content");
  if (!root) return;

  root.innerHTML = `<div class="dash-state">⏳ Cargando panel…</div>`;

  const esWorkerOAdmin = ["admin", "worker"].includes(currentUserRole);

  try {
    const [
      { data: pasajerosData, error: errPas },
      { data: viajesData,    error: errViajes },
      { data: vpData,        error: errVp },
      { data: bycData,       error: errByc },
    ] = await Promise.all([
      supabaseClient.from("pasajeros").select(`id, Sexo, "Documento de Identidad"`),
      supabaseClient.from("viajes")
        .select("id, nombre, fecha_salida, fecha_regreso, estado, puntos_destino")
        .order("fecha_salida", { ascending: false }),
      supabaseClient.from("viaje_pasajeros")
        .select("id, pasajero_id, viaje_id, asistencia, puntos_destino, pasajeros ( Pasajero, Vendedor )"),
      supabaseClient.from("basesycondiciones").select("id, ci, estado"),
    ]);

    if (errPas || errViajes || errVp) {
      console.error("Error cargando dashboard:", errPas || errViajes || errVp);
      root.innerHTML = `<div class="dash-state">⚠️ Error al cargar el panel.</div>`;
      return;
    }
    if (errByc) console.warn("No se pudo cargar BYC:", errByc);

    const viajesMap = {};
    (viajesData || []).forEach(v => { viajesMap[v.id] = v; });

    let html = "";
    html += renderKpisPasajeros(pasajerosData || [], vpData || []);
    html += renderKpisByc(bycData || [], pasajerosData || []);
    html += renderViajesActivos(viajesData || [], vpData || []);
    html += renderTopPuntos2026(vpData || [], viajesMap);

    if (esWorkerOAdmin) {
      // Últimos 3 viajes (activos o completados), ya vienen ordenados por fecha_salida desc
      const last3 = (viajesData || [])
        .filter(v => ["activo", "completado"].includes(v.estado || "activo"))
        .slice(0, 3);

      const last3Ids   = last3.map(v => v.id);
      const vpLast3    = (vpData || []).filter(vp => last3Ids.includes(vp.viaje_id));
      const vpLast3Ids = vpLast3.map(vp => vp.id);

      const [{ data: egresosData }, { data: pagosData }] = await Promise.all([
        last3Ids.length
          ? supabaseClient.from("egresos").select("viaje_id, monto").in("viaje_id", last3Ids)
          : Promise.resolve({ data: [] }),
        vpLast3Ids.length
          ? supabaseClient.from("pagos").select("viaje_pasajero_id, monto, tipo").in("viaje_pasajero_id", vpLast3Ids)
          : Promise.resolve({ data: [] }),
      ]);

      html += `<hr class="dash-section-divider" />`;
      html += renderComparativo(last3, vpLast3, egresosData || [], pagosData || []);
      html += renderRankingVendedores(last3, vpLast3);
    }

    root.innerHTML = html;

  } catch (e) {
    console.error("Error inesperado en dashboard:", e);
    root.innerHTML = `<div class="dash-state">⚠️ Error al cargar el panel.</div>`;
  }
}

// ── KPIs de pasajeros ────────────────────────────────────────
function renderKpisPasajeros(pasajerosData, vpData) {
  const total = pasajerosData.length;

  // Conteo por sexo
  const porSexo = {};
  pasajerosData.forEach(p => {
    const s = p.Sexo || "Sin dato";
    porSexo[s] = (porSexo[s] || 0) + 1;
  });
  const ordenSexo = ["Masculino", "Femenino", "Otro", "Sin dato"];
  const iconoSexo = { Masculino: "♂", Femenino: "♀", Otro: "⚧", "Sin dato": "•" };
  const chipsSexo = Object.keys(porSexo)
    .sort((a, b) => ordenSexo.indexOf(a) - ordenSexo.indexOf(b))
    .map(s => `<span class="dash-chip">${iconoSexo[s] || "•"} ${s}: <strong>${porSexo[s]}</strong></span>`)
    .join("");

  // Asistencias por pasajero → membresía Club Destino (>= 3 viajes asistidos)
  const asistenciasPorPasajero = {};
  vpData.forEach(vp => {
    if (vp.asistencia === "Asiste") {
      asistenciasPorPasajero[vp.pasajero_id] = (asistenciasPorPasajero[vp.pasajero_id] || 0) + 1;
    }
  });

  let miembros = 0;
  pasajerosData.forEach(p => {
    if ((asistenciasPorPasajero[p.id] || 0) >= 3) miembros++;
  });
  const noMiembros = total - miembros;
  const pctMiembros = total > 0 ? Math.round((miembros / total) * 100) : 0;

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.pasajeros}</span>
      Pasajeros
    </div>
    <div class="dash-kpi-grid">
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Total de pasajeros</div>
        <div class="dash-kpi-value">${total}</div>
        <div class="dash-kpi-breakdown">${chipsSexo}</div>
      </div>
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Club Destino</div>
        <div class="dash-kpi-value">${miembros}</div>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctMiembros}%"></div></div>
        <div class="dash-kpi-breakdown">
          <span class="dash-chip">⭐ Miembros: <strong>${miembros}</strong></span>
          <span class="dash-chip">No miembros: <strong>${noMiembros}</strong></span>
        </div>
      </div>
    </div>
  </div>`;
}

// ── KPIs de BYC ─────────────────────────────────────────────
function _normalizarCI(ci) {
  return (ci || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
}

function renderKpisByc(bycData, pasajerosData) {
  const totalByc = bycData.length;

  // Set de CIs normalizados en pasajeros (igual que cargarPendientes en byc.js)
  const cisPasajeros = new Set(
    pasajerosData.map(p => _normalizarCI(p["Documento de Identidad"]))
  );

  // Pendientes = están en ByC con CI pero NO tienen coincidencia en pasajeros
  const pendientes = bycData.filter(r => r.ci && !cisPasajeros.has(_normalizarCI(r.ci)));
  const faltantes  = pendientes.length;
  const vinculados = totalByc - faltantes;
  const pctVinc    = totalByc > 0 ? Math.round((vinculados / totalByc) * 100) : 0;

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.byc}</span>
      Bases y condiciones
    </div>
    <div class="dash-kpi-grid">
      <div class="dash-kpi-card">
        <div class="dash-kpi-label">Total en ByC</div>
        <div class="dash-kpi-value">${totalByc}</div>
        <div class="dash-kpi-breakdown">
          <span class="dash-chip">🔗 Vinculados: <strong>${vinculados}</strong></span>
          <span class="dash-chip dash-chip--warn">⚠️ Sin vincular: <strong>${faltantes}</strong></span>
        </div>
      </div>
      <div class="dash-kpi-card clickable" onclick="navigateTo('byc-vincular')" style="cursor:pointer">
        <div class="dash-kpi-label">Faltan vincular</div>
        <div class="dash-kpi-value" style="color:${faltantes > 0 ? '#c9a84c' : '#2d6a4f'}">${faltantes}</div>
        <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctVinc}%"></div></div>
        <div class="dash-kpi-breakdown">
          <span class="dash-chip">${pctVinc}% ya en base de clientes</span>
        </div>
        <div style="margin-top:.6rem; font-size:.75rem; color:#3949ab; font-weight:500; display:flex; align-items:center; gap:.3rem;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Ir a pendientes
        </div>
      </div>
    </div>
  </div>`;
}

// ── Viajes activos y total de pasajeros ──────────────────────
function renderViajesActivos(viajesData, vpData) {
  const activos = viajesData.filter(v => (v.estado || "activo") === "activo");

  const countsByViaje = {};
  vpData.forEach(vp => {
    countsByViaje[vp.viaje_id] = (countsByViaje[vp.viaje_id] || 0) + 1;
  });

  let body;
  if (activos.length === 0) {
    body = `<div class="dash-card"><div class="dash-state">Sin viajes activos por el momento.</div></div>`;
  } else {
    body = activos.map(v => {
      const totalP = countsByViaje[v.id] || 0;
      return `
      <div class="dash-viaje-card" onclick="openViajeDetalle('${v.id}')">
        <div class="dvc-icon">${_dashIcons.viajes}</div>
        <div class="dvc-body">
          <div class="dvc-nombre">${v.nombre || "Viaje sin nombre"}</div>
          <div class="dvc-meta">
            ${v.fecha_salida ? `<span>${_dashIcons.calendario} ${formatFecha(v.fecha_salida)}</span>` : ""}
            ${v.puntos_destino ? `<span>⭐ ${v.puntos_destino} pts base</span>` : ""}
          </div>
        </div>
        <span class="dvc-pasajeros">${totalP} pasajero${totalP !== 1 ? "s" : ""}</span>
      </div>`;
    }).join("");
  }

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.viajes}</span>
      Viajes activos
      <span class="dash-section-count">${activos.length}</span>
    </div>
    ${body}
  </div>`;
}

// ── Top de pasajeros con más puntos (2026) ───────────────────
// Guarda el ranking COMPLETO (no solo el top 10) para reutilizarlo
// en la vista de detalle "ranking-puntos" sin volver a pegarle a Supabase.
let _rankingPuntosCompleto = [];

function _calcularRankingPuntos2026(vpData, viajesMap) {
  const puntosPorPasajero  = {};
  const nombresPorPasajero = {};
  const viajesPorPasajero  = {}; // detalle de viajes asistidos en 2026, para compartir

  vpData.forEach(vp => {
    const viaje = viajesMap[vp.viaje_id];
    if (!viaje || !viaje.fecha_salida) return;
    if (!viaje.fecha_salida.startsWith("2026")) return;
    if (vp.asistencia !== "Asiste") return; // solo cuenta si asistió

    const pts = vp.puntos_destino || 0;

    puntosPorPasajero[vp.pasajero_id]  = (puntosPorPasajero[vp.pasajero_id] || 0) + pts;
    nombresPorPasajero[vp.pasajero_id] = vp.pasajeros?.Pasajero || "Sin nombre";

    if (!viajesPorPasajero[vp.pasajero_id]) viajesPorPasajero[vp.pasajero_id] = [];
    viajesPorPasajero[vp.pasajero_id].push({
      nombre: viaje.nombre || "Viaje sin nombre",
      fecha_salida: viaje.fecha_salida,
      puntos: pts,
    });
  });

  // Ordenamos cada detalle de viajes por fecha de salida ascendente
  Object.keys(viajesPorPasajero).forEach(pid => {
    viajesPorPasajero[pid].sort((a, b) => (a.fecha_salida || "").localeCompare(b.fecha_salida || ""));
  });

  return Object.keys(nombresPorPasajero)
    .map(pid => ({
      pasajeroId: parseInt(pid, 10),
      nombre: nombresPorPasajero[pid],
      puntos: puntosPorPasajero[pid] || 0,
      viajes: viajesPorPasajero[pid] || [],
    }))
    .filter(r => r.puntos > 0) // el ranking solo muestra a quienes tienen puntos
    .sort((a, b) => b.puntos - a.puntos);
}

function _renderRankRows(ranking) {
  if (ranking.length === 0) {
    return `<div class="dash-state">Sin puntos acumulados en viajes de 2026.</div>`;
  }
  return ranking.map((r, i) => {
    const pos = i + 1;
    const cls = pos === 1 ? "top1" : pos === 2 ? "top2" : pos === 3 ? "top3" : "";
    return `
    <div class="dash-rank-row">
      <div class="dash-rank-num ${cls}" onclick="irADashPasajero(${r.pasajeroId})">${pos}</div>
      <div class="dash-rank-avatar" onclick="irADashPasajero(${r.pasajeroId})">${getInitials(r.nombre)}</div>
      <div class="dash-rank-name" onclick="irADashPasajero(${r.pasajeroId})">${r.nombre}</div>
      <span class="dash-rank-pts" onclick="irADashPasajero(${r.pasajeroId})">⭐ ${r.puntos} pts</span>
      <button class="dash-rank-share-btn" title="Compartir" onclick="event.stopPropagation(); compartirPuntosPasajero(${r.pasajeroId})">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </button>
    </div>`;
  }).join("");
}

function renderTopPuntos2026(vpData, viajesMap) {
  _rankingPuntosCompleto = _calcularRankingPuntos2026(vpData, viajesMap);
  const top10 = _rankingPuntosCompleto.slice(0, 10);
  const body  = _renderRankRows(top10);

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.puntos}</span>
      Top pasajeros · puntos 2026
      ${_rankingPuntosCompleto.length > 10 ? `
      <button class="dash-ver-todos-btn" onclick="navigateTo('ranking-puntos')">
        Ver todos ${_dashIcons.flecha}
      </button>` : ""}
    </div>
    <div class="dash-card">${body}</div>
  </div>`;
}

// Navega al detalle de un pasajero desde el ranking del dashboard
async function irADashPasajero(pasajeroId) {
  if (!allPassengers || allPassengers.length === 0) {
    await loadPassengers();
  }
  const p = allPassengers.find(x => x.id === pasajeroId);
  if (p) navigateTo("detalle", p._idx);
}

// ── Vista de ranking completo de puntos (1ro al último) ──────
async function loadRankingPuntos() {
  const root = document.getElementById("ranking-puntos-list");
  if (!root) return;

  const searchEl = document.getElementById("ranking-puntos-search");
  if (searchEl) searchEl.value = "";

  // Si el dashboard ya se cargó en esta sesión, reutilizamos el cálculo.
  // Si no (ej. acceso directo por hash), lo recalculamos desde cero.
  if (_rankingPuntosCompleto.length === 0) {
    root.innerHTML = `<div class="dash-state">⏳ Cargando ranking…</div>`;
    try {
      const [
        { data: viajesData, error: errViajes },
        { data: vpData,     error: errVp },
      ] = await Promise.all([
        supabaseClient.from("viajes")
          .select("id, nombre, fecha_salida"),
        supabaseClient.from("viaje_pasajeros")
          .select("id, pasajero_id, viaje_id, asistencia, puntos_destino, pasajeros ( Pasajero )"),
      ]);

      if (errViajes || errVp) {
        console.error("Error cargando ranking de puntos:", errViajes || errVp);
        root.innerHTML = `<div class="dash-state">⚠️ Error al cargar el ranking.</div>`;
        return;
      }

      const viajesMap = {};
      (viajesData || []).forEach(v => { viajesMap[v.id] = v; });
      _rankingPuntosCompleto = _calcularRankingPuntos2026(vpData || [], viajesMap);

    } catch (e) {
      console.error("Error inesperado cargando ranking de puntos:", e);
      root.innerHTML = `<div class="dash-state">⚠️ Error al cargar el ranking.</div>`;
      return;
    }
  }

  root.innerHTML = _renderRankRows(_rankingPuntosCompleto);
}

// Filtro en vivo por nombre dentro del ranking completo
let _rankingPuntosSearchTimer = null;
function filtrarRankingPuntos() {
  clearTimeout(_rankingPuntosSearchTimer);
  _rankingPuntosSearchTimer = setTimeout(() => {
    const root = document.getElementById("ranking-puntos-list");
    const q = document.getElementById("ranking-puntos-search")?.value.toLowerCase().trim() || "";
    if (!root) return;

    if (!q) {
      root.innerHTML = _renderRankRows(_rankingPuntosCompleto);
      return;
    }

    const filtrado = _rankingPuntosCompleto.filter(r =>
      (r.nombre || "").toLowerCase().includes(q)
    );

    // En modo filtrado mantenemos la posición original del ranking general,
    // no una renumeración 1..N del subconjunto filtrado.
    if (filtrado.length === 0) {
      root.innerHTML = `<div class="dash-state">Sin resultados.</div>`;
      return;
    }
    root.innerHTML = filtrado.map(r => {
      const posOriginal = _rankingPuntosCompleto.indexOf(r) + 1;
      const cls = posOriginal === 1 ? "top1" : posOriginal === 2 ? "top2" : posOriginal === 3 ? "top3" : "";
      return `
      <div class="dash-rank-row">
        <div class="dash-rank-num ${cls}" onclick="irADashPasajero(${r.pasajeroId})">${posOriginal}</div>
        <div class="dash-rank-avatar" onclick="irADashPasajero(${r.pasajeroId})">${getInitials(r.nombre)}</div>
        <div class="dash-rank-name" onclick="irADashPasajero(${r.pasajeroId})">${r.nombre}</div>
        <span class="dash-rank-pts" onclick="irADashPasajero(${r.pasajeroId})">⭐ ${r.puntos} pts</span>
        <button class="dash-rank-share-btn" title="Compartir" onclick="event.stopPropagation(); compartirPuntosPasajero(${r.pasajeroId})">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
      </div>`;
    }).join("");
  }, 200);
}

// ── Compartir imagen de puntos por pasajero ───────────────────
// Genera una tarjeta-imagen con los viajes 2026 (asistidos) y los
// puntos acumulados en cada uno, con el total al pie, y la comparte
// vía Web Share API (o la descarga si el navegador no la soporta).
async function compartirPuntosPasajero(pasajeroId) {
  const btn = event?.currentTarget;
  if (btn) btn.disabled = true;

  try {
    let registro = _rankingPuntosCompleto.find(r => r.pasajeroId === pasajeroId);

    // Si el ranking aún no se calculó en esta sesión, lo armamos al vuelo
    if (!registro) {
      const [
        { data: viajesData, error: errViajes },
        { data: vpData,     error: errVp },
      ] = await Promise.all([
        supabaseClient.from("viajes").select("id, nombre, fecha_salida"),
        supabaseClient.from("viaje_pasajeros")
          .select("id, pasajero_id, viaje_id, asistencia, puntos_destino, pasajeros ( Pasajero )"),
      ]);
      if (errViajes || errVp) {
        alert("No se pudo generar la imagen. Intentá de nuevo.");
        return;
      }
      const viajesMap = {};
      (viajesData || []).forEach(v => { viajesMap[v.id] = v; });
      const ranking = _calcularRankingPuntos2026(vpData || [], viajesMap);
      registro = ranking.find(r => r.pasajeroId === pasajeroId);
    }

    if (!registro || registro.viajes.length === 0) {
      alert("Este pasajero todavía no tiene viajes asistidos en 2026.");
      return;
    }

    const blob = await _generarImagenPuntos(registro);
    const fileName = `puntos-${registro.nombre.replace(/\s+/g, "_").toLowerCase()}-2026.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    const textoCompartir = `Hola ${registro.nombre}, estos son los viajes que hiciste en 2026 y los puntos que acumulaste en cada uno. ¡Vas sumando para el Club Destino! 🌟`;

    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Puntos Club Destino 2026",
        text: textoCompartir,
      });
    } else {
      // Fallback: descargar la imagen
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    if (e?.name !== "AbortError") {
      console.error("Error al compartir puntos del pasajero:", e);
      alert("No se pudo generar la imagen para compartir.");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// URL pública del logo de la app (ya usado en index.html para favicon/login/topbar)
const _LOGO_URL = "https://guaranitour.github.io/Guarani-tour-APP/app_imagen_512px.png";
let _logoImgPromise = null;
function _cargarLogo() {
  if (_logoImgPromise) return _logoImgPromise;
  _logoImgPromise = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // si falla la carga, seguimos sin logo
    img.src = _LOGO_URL;
  });
  return _logoImgPromise;
}

// Dibuja la tarjeta de puntos en un canvas y devuelve un Blob PNG.
// Diseño inspirado en el boceto del usuario pero más estilizado: tarjeta
// blanca con sombra sobre fondo gris claro, franja superior decorativa,
// logo + título, saludo, intro, lista de viajes con pills de puntos,
// y un footer de total destacado con fondo propio.
async function _generarImagenPuntos(registro) {
  const FONT = "Roboto, -apple-system, sans-serif";
  try {
    await Promise.all([
      document.fonts.load("400 16px " + FONT),
      document.fonts.load("600 16px " + FONT),
      document.fonts.load("700 16px " + FONT),
    ]);
    await document.fonts.ready;
  } catch (e) { /* seguimos con fallback del navegador si falla */ }

  const logo = await _cargarLogo();

  const WIDTH         = 640;
  const OUTER_PAD     = 28;   // margen exterior (fondo gris hasta el borde de la tarjeta)
  const CARD_PAD      = 40;   // padding interno de la tarjeta
  const STRIPE_H      = 6;    // franja decorativa superior
  const HEADER_H      = 92;   // logo + título
  const GREET_H       = 40;
  const INTRO_H       = 50;
  const LIST_TOP_GAP  = 22;
  const ROW_H         = 66;
  const FOOTER_H      = 92;   // bloque de total, con fondo propio
  const BOTTOM_AIR    = 18;   // aire entre la última fila y el footer

  const cardWidth = WIDTH - OUTER_PAD * 2;
  const contentW  = cardWidth - CARD_PAD * 2;
  const listHeight = registro.viajes.length * ROW_H;
  const cardHeight = STRIPE_H + HEADER_H + GREET_H + INTRO_H + LIST_TOP_GAP
                    + listHeight + BOTTOM_AIR + FOOTER_H;
  const height = cardHeight + OUTER_PAD * 2;

  const canvas = document.createElement("canvas");
  const scale = 2.5; // resolución alta para que se vea nítida al compartir
  canvas.width  = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  // ── Fondo exterior gris suave ──
  ctx.fillStyle = "#eef1ef";
  ctx.fillRect(0, 0, WIDTH, height);

  const cardX = OUTER_PAD, cardY = OUTER_PAD;

  // ── Tarjeta blanca con sombra suave y esquinas redondeadas ──
  ctx.save();
  ctx.shadowColor = "rgba(27,67,50,.16)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = "#ffffff";
  _roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 22);
  ctx.fill();
  ctx.restore();

  // Clip al borde redondeado para todo lo que sigue
  ctx.save();
  _roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 22);
  ctx.clip();

  // ── Franja decorativa superior con degradé ──
  const stripeGrad = ctx.createLinearGradient(cardX, 0, cardX + cardWidth, 0);
  stripeGrad.addColorStop(0, "#2d6a4f");
  stripeGrad.addColorStop(0.55, "#c9a84c");
  stripeGrad.addColorStop(1, "#1b4332");
  ctx.fillStyle = stripeGrad;
  ctx.fillRect(cardX, cardY, cardWidth, STRIPE_H);

  // ── Marca de agua: limitada a la zona de la lista de viajes (entre el
  // intro y el footer), para que nunca invada el header ni el footer ni
  // se vea cortada de forma rara contra esos bloques de color sólido. ──
  const listZoneTop    = cardY + STRIPE_H + HEADER_H + GREET_H + INTRO_H - 8;
  const listZoneBottom = cardY + cardHeight - FOOTER_H;
  const listZoneH      = listZoneBottom - listZoneTop;
  if (logo && listZoneH > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(cardX, listZoneTop, cardWidth, listZoneH);
    ctx.clip();
    ctx.globalAlpha = 0.07;
    // El tamaño se adapta a la zona disponible (mitad del ancho de la
    // tarjeta como máximo) para que jamás sobresalga del recorte.
    const wmSize = Math.min(cardWidth * 0.5, listZoneH * 0.9);
    const wmX = cardX + (cardWidth - wmSize) / 2;
    const wmY = listZoneTop + (listZoneH - wmSize) / 2;
    ctx.drawImage(logo, wmX, wmY, wmSize, wmSize);
    ctx.restore();
  }

  // ── Header: logo circular + título ──
  const logoSize = 50;
  const logoX = cardX + CARD_PAD, logoY = cardY + STRIPE_H + 22;
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
    ctx.restore();
    // anillo dorado sutil alrededor del logo
    ctx.strokeStyle = "rgba(201,168,76,.6)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#2d6a4f";
    ctx.beginPath();
    ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#1a3a2a";
  ctx.font = "700 20px " + FONT;
  ctx.fillText("Club Destino", logoX + logoSize + 16, logoY + logoSize / 2 - 1);
  ctx.fillStyle = "#8a6d1a";
  ctx.font = "600 12.5px " + FONT;
  ctx.textLetterSpacing = "1px";
  ctx.fillText("TEMPORADA 2026", logoX + logoSize + 16, logoY + logoSize / 2 + 18);
  ctx.textLetterSpacing = "0px";

  // ── Saludo ──
  let cursorY = cardY + STRIPE_H + HEADER_H + 18;
  ctx.fillStyle = "#1a3a2a";
  ctx.font = "700 22px " + FONT;
  ctx.fillText(`¡Hola, ${registro.nombre}!`, cardX + CARD_PAD, cursorY);

  // ── Intro ──
  cursorY += 34;
  ctx.fillStyle = "#5c6e63";
  ctx.font = "400 14.5px " + FONT;
  const introLines = _wrapTextLines(
    ctx,
    "Estos son los viajes que hiciste en 2026 y los puntos que acumulaste con cada uno.",
    contentW
  );
  introLines.forEach(line => { ctx.fillText(line, cardX + CARD_PAD, cursorY); cursorY += 20; });

  // ── Lista de viajes ──
  cursorY += LIST_TOP_GAP - 12;
  const rowLeftX  = cardX + CARD_PAD;
  const rowRightX = cardX + cardWidth - CARD_PAD;

  registro.viajes.forEach((v, i) => {
    const rowTop = cursorY;
    const rowCenterY = rowTop + (ROW_H - 22) / 2; // centro visual de la fila (antes de la fecha)

    // separador sutil entre filas (no antes de la primera)
    if (i > 0) {
      ctx.strokeStyle = "#eef0ee";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(rowLeftX, rowTop - LIST_TOP_GAP / 2 + 4);
      ctx.lineTo(rowRightX, rowTop - LIST_TOP_GAP / 2 + 4);
      ctx.stroke();
    }

    // pill de puntos a la derecha
    const ptsLabel = v.puntos > 0 ? `+${v.puntos} pts` : "0 pts";
    ctx.font = "700 13.5px " + FONT;
    const ptsTextW = ctx.measureText(ptsLabel).width;
    const pillPadX = 12;
    const pillW = ptsTextW + pillPadX * 2;
    const pillH = 26;
    const pillX = rowRightX - pillW;
    const pillY = rowCenterY - pillH / 2 - 3;
    if (v.puntos > 0) {
      ctx.fillStyle = "rgba(201,168,76,.16)";
      _roundRect(ctx, pillX, pillY, pillW, pillH, 13);
      ctx.fill();
      ctx.fillStyle = "#8a6d1a";
    } else {
      ctx.fillStyle = "rgba(138,154,144,.12)";
      _roundRect(ctx, pillX, pillY, pillW, pillH, 13);
      ctx.fill();
      ctx.fillStyle = "#8a9a90";
    }
    ctx.fillText(ptsLabel, pillX + pillPadX, pillY + pillH / 2 + 5);

    // nombre del viaje
    ctx.fillStyle = "#1a3a2a";
    ctx.font = "600 15.5px " + FONT;
    const nombreMaxW = pillX - rowLeftX - 16;
    const nombreViaje = _truncateText(ctx, v.nombre, nombreMaxW);
    ctx.fillText(nombreViaje, rowLeftX, rowCenterY);

    // fecha debajo, en gris
    ctx.fillStyle = "#8a9a90";
    ctx.font = "400 12.5px " + FONT;
    ctx.fillText(_formatFechaCorta(v.fecha_salida), rowLeftX, rowCenterY + 19);

    cursorY += ROW_H;
  });

  // ── Footer: total acumulado, con fondo propio (verde suave, en línea
  // con la paleta del resto de la tarjeta en vez de un tono ajeno) ──
  const footerY = cardY + cardHeight - FOOTER_H;
  ctx.fillStyle = "#eef5f0";
  ctx.fillRect(cardX, footerY, cardWidth, FOOTER_H);
  ctx.strokeStyle = "#d8e8dd";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, footerY);
  ctx.lineTo(cardX + cardWidth, footerY);
  ctx.stroke();

  const footerCenterY = footerY + FOOTER_H / 2;
  ctx.fillStyle = "#5c6e63";
  ctx.font = "500 13.5px " + FONT;
  ctx.fillText("Total acumulado en 2026", cardX + CARD_PAD, footerCenterY - 2);
  ctx.fillStyle = "#8a6d1a";
  ctx.font = "600 11px " + FONT;
  ctx.textLetterSpacing = "1px";
  ctx.fillText("CLUB DESTINO", cardX + CARD_PAD, footerCenterY + 16);
  ctx.textLetterSpacing = "0px";

  const totalLabel = `${registro.puntos} pts`;
  ctx.font = "700 28px " + FONT;
  ctx.fillStyle = "#2d6a4f";
  const totalW = ctx.measureText(totalLabel).width;
  ctx.fillText(totalLabel, cardX + cardWidth - CARD_PAD - totalW, footerCenterY + 9);

  ctx.restore(); // fin del clip de la tarjeta

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

// Parte texto en líneas según un ancho máximo y devuelve el array de líneas
// (a diferencia de _wrapText, no dibuja: deja que el caller controle el interlineado)
function _wrapTextLines(ctx, text, maxWidth) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((word, i) => {
    const testLine = line + word + " ";
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = testLine;
    }
  });
  if (line.trim()) lines.push(line.trim());
  return lines;
}

// Helpers de dibujo en canvas

function _truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + "…").width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "…";
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function _formatFechaCorta(val) {
  if (!val) return "";
  if (typeof formatDate === "function") {
    const f = formatDate(val);
    if (f) return f;
  }
  const [year, month, day] = val.split("-");
  if (!day) return val;
  return `${day}/${month}/${year}`;
}

// ── Comparativo egresos vs ingresos (últimos 3 viajes) ───────
function renderComparativo(last3, vpLast3, egresosData, pagosData) {
  const vpToViaje = {};
  vpLast3.forEach(vp => { vpToViaje[vp.id] = vp.viaje_id; });

  const ingresosPorViaje = {};
  const egresosPorViaje  = {};

  pagosData.forEach(pg => {
    const viajeId = vpToViaje[pg.viaje_pasajero_id];
    if (viajeId == null) return;
    const monto = pg.monto || 0;
    if (pg.tipo === "Pago") {
      ingresosPorViaje[viajeId] = (ingresosPorViaje[viajeId] || 0) + monto;
    } else if (pg.tipo === "Devolución" || pg.tipo === "Transferencia") {
      ingresosPorViaje[viajeId] = (ingresosPorViaje[viajeId] || 0) - monto;
    }
  });

  egresosData.forEach(e => {
    egresosPorViaje[e.viaje_id] = (egresosPorViaje[e.viaje_id] || 0) + (e.monto || 0);
  });

  let body;
  if (last3.length === 0) {
    body = `<div class="dash-state">Sin viajes para comparar.</div>`;
  } else {
    body = last3.map(v => {
      const ingresos = ingresosPorViaje[v.id] || 0;
      const egresos  = egresosPorViaje[v.id]  || 0;
      const balance  = ingresos - egresos;
      const max      = Math.max(Math.abs(ingresos), Math.abs(egresos), 1);
      const pctIng   = Math.round((Math.max(ingresos, 0) / max) * 100);
      const pctEgr   = Math.round((Math.max(egresos, 0) / max) * 100);
      const estado   = v.estado || "activo";

      return `
      <div class="dash-comp-card">
        <div class="dash-comp-header">
          <span class="dash-comp-nombre">${v.nombre || "Viaje sin nombre"}</span>
          <span class="dash-comp-estado ${estado}">${estado}</span>
        </div>
        <div class="dash-comp-rows">
          <div class="dash-comp-row ingreso">
            <span class="dash-comp-row-label">Ingresos</span>
            <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctIng}%"></div></div>
            <span class="dash-comp-row-value">Gs. ${ingresos.toLocaleString("es-PY")}</span>
          </div>
          <div class="dash-comp-row egreso">
            <span class="dash-comp-row-label">Egresos</span>
            <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${pctEgr}%"></div></div>
            <span class="dash-comp-row-value">Gs. ${egresos.toLocaleString("es-PY")}</span>
          </div>
        </div>
        <div class="dash-comp-balance ${balance >= 0 ? "positivo" : "negativo"}">
          <span>Balance</span>
          <span>${balance >= 0 ? "+" : ""}Gs. ${balance.toLocaleString("es-PY")}</span>
        </div>
      </div>`;
    }).join("");
  }

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.balance}</span>
      Egresos vs ingresos · últimos 3 viajes
    </div>
    ${body}
  </div>`;
}

// ── Ranking de pasajeros vendidos por vendedor ───────────────
function renderRankingVendedores(last3, vpLast3) {
  const porVendedor = {};

  vpLast3.forEach(vp => {
    const vendedor = (vp.pasajeros?.Vendedor || "").trim().replace(/\s+/g, " ");
    if (!vendedor) return;
    if (!porVendedor[vendedor]) porVendedor[vendedor] = { total: 0, asiste: 0 };
    porVendedor[vendedor].total++;
    if (vp.asistencia === "Asiste") porVendedor[vendedor].asiste++;
  });

  const ranking = Object.keys(porVendedor)
    .map(vendedor => {
      const d = porVendedor[vendedor];
      return {
        vendedor,
        total: d.total,
        asiste: d.asiste,
        efectividad: d.total > 0 ? Math.round((d.asiste / d.total) * 100) : 0,
      };
    })
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total);

  let body;
  if (ranking.length === 0) {
    body = `<div class="dash-state">Sin ventas registradas en los últimos viajes.</div>`;
  } else {
    body = ranking.map((r, i) => {
      const effClass = r.efectividad >= 70 ? "alta" : r.efectividad >= 40 ? "media" : "baja";
      const cls = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
      return `
      <div class="dash-vendor-row">
        <div class="dash-rank-num ${cls}">${i + 1}</div>
        <div class="dash-vendor-body">
          <div class="dash-vendor-name">${r.vendedor}</div>
          <div class="dash-vendor-meta">${r.total} pasajero${r.total !== 1 ? "s" : ""} vendido${r.total !== 1 ? "s" : ""} · ${r.asiste} ${r.asiste === 1 ? "asistió" : "asistieron"}</div>
        </div>
        <div class="dash-vendor-eff">
          <div class="dash-vendor-eff-value ${effClass}">${r.efectividad}%</div>
          <div class="dash-vendor-eff-label">Efectividad</div>
        </div>
      </div>`;
    }).join("");
  }

  const nombresViajes = last3.map(v => v.nombre).filter(Boolean).join(" · ");

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.ranking}</span>
      Ranking de vendedores
    </div>
    ${nombresViajes ? `<p class="dash-section-sub">${nombresViajes}</p>` : ""}
    <div class="dash-card">${body}</div>
  </div>`;
}
