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

// Dibuja la tarjeta de puntos en un canvas y devuelve un Blob PNG
function _generarImagenPuntos(registro) {
  return new Promise((resolve) => {
    const PADDING   = 48;
    const WIDTH     = 720;
    const ROW_H     = 64;
    const HEADER_H  = 210;
    const FOOTER_H  = 130;
    const height = HEADER_H + (registro.viajes.length * ROW_H) + FOOTER_H;

    const canvas = document.createElement("canvas");
    const scale = 2; // exportar a mayor resolución
    canvas.width  = WIDTH * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);

    // Fondo
    const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, height);
    bgGrad.addColorStop(0, "#f4f7f5");
    bgGrad.addColorStop(1, "#e8efe9");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, WIDTH, height);

    // Header con gradiente accent
    const headerGrad = ctx.createLinearGradient(0, 0, WIDTH, HEADER_H);
    headerGrad.addColorStop(0, "#2d6a4f");
    headerGrad.addColorStop(1, "#1b4332");
    ctx.fillStyle = headerGrad;
    ctx.fillRect(0, 0, WIDTH, HEADER_H);

    // Sello "Club Destino"
    ctx.fillStyle = "rgba(255,255,255,.16)";
    ctx.font = "600 13px Roboto, sans-serif";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("CLUB DESTINO · 2026", PADDING, 38);

    // Saludo
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 26px Roboto, sans-serif";
    _wrapText(ctx, `Hola ${registro.nombre},`, PADDING, 82, WIDTH - PADDING * 2, 32);
    ctx.font = "400 16px Roboto, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,.92)";
    _wrapText(
      ctx,
      "estos son los viajes que hiciste en 2026 y los puntos que acumulaste en cada uno.",
      PADDING, 118, WIDTH - PADDING * 2, 22
    );

    // Filas de viajes
    let y = HEADER_H;
    registro.viajes.forEach((v, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(45,106,79,.05)";
        ctx.fillRect(0, y, WIDTH, ROW_H);
      }
      // separador
      ctx.strokeStyle = "rgba(0,0,0,.06)";
      ctx.beginPath();
      ctx.moveTo(PADDING, y + ROW_H);
      ctx.lineTo(WIDTH - PADDING, y + ROW_H);
      ctx.stroke();

      // nombre del viaje
      ctx.fillStyle = "#1a3a2a";
      ctx.font = "600 16px Roboto, sans-serif";
      const nombreViaje = _truncateText(ctx, v.nombre, WIDTH - PADDING * 2 - 180);
      ctx.fillText(nombreViaje, PADDING, y + 28);

      // fecha
      ctx.fillStyle = "#6b7d73";
      ctx.font = "400 13px Roboto, sans-serif";
      ctx.fillText(_formatFechaCorta(v.fecha_salida), PADDING, y + 48);

      // puntos (pill, alineado a la derecha)
      const ptsLabel = `⭐ ${v.puntos} pts`;
      ctx.font = "700 14px Roboto, sans-serif";
      const ptsWidth = ctx.measureText(ptsLabel).width + 28;
      const pillX = WIDTH - PADDING - ptsWidth;
      const pillY = y + ROW_H / 2 - 14;
      _roundRect(ctx, pillX, pillY, ptsWidth, 28, 14);
      ctx.fillStyle = "rgba(201,168,76,.18)";
      ctx.fill();
      ctx.fillStyle = "#8a6d1a";
      ctx.fillText(ptsLabel, pillX + 14, pillY + 19);

      y += ROW_H;
    });

    // Footer con total
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, y, WIDTH, FOOTER_H);
    ctx.strokeStyle = "rgba(0,0,0,.08)";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();

    ctx.fillStyle = "#1a3a2a";
    ctx.font = "500 16px Roboto, sans-serif";
    ctx.fillText("Total acumulado en 2026", PADDING, y + 52);

    ctx.fillStyle = "#2d6a4f";
    ctx.font = "700 36px Roboto, sans-serif";
    ctx.fillText(`⭐ ${registro.puntos} pts`, PADDING, y + 92);

    canvas.toBlob((blob) => resolve(blob), "image/png", 1);
  });
}

// Helpers de dibujo en canvas
function _wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let curY = y;
  words.forEach((word, i) => {
    const testLine = line + word + " ";
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      ctx.fillText(line.trim(), x, curY);
      line = word + " ";
      curY += lineHeight;
    } else {
      line = testLine;
    }
  });
  ctx.fillText(line.trim(), x, curY);
}

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
