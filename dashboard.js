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
function renderTopPuntos2026(vpData, viajesMap) {
  const puntosPorPasajero  = {};
  const nombresPorPasajero = {};

  vpData.forEach(vp => {
    const viaje = viajesMap[vp.viaje_id];
    if (!viaje || !viaje.fecha_salida) return;
    if (!viaje.fecha_salida.startsWith("2026")) return;

    const pts = vp.puntos_destino || 0;
    if (pts <= 0) return;

    puntosPorPasajero[vp.pasajero_id]  = (puntosPorPasajero[vp.pasajero_id] || 0) + pts;
    nombresPorPasajero[vp.pasajero_id] = vp.pasajeros?.Pasajero || "Sin nombre";
  });

  const ranking = Object.keys(puntosPorPasajero)
    .map(pid => ({
      pasajeroId: parseInt(pid, 10),
      nombre: nombresPorPasajero[pid],
      puntos: puntosPorPasajero[pid],
    }))
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, 10);

  let body;
  if (ranking.length === 0) {
    body = `<div class="dash-state">Sin puntos acumulados en viajes de 2026.</div>`;
  } else {
    body = ranking.map((r, i) => {
      const pos = i + 1;
      const cls = pos === 1 ? "top1" : pos === 2 ? "top2" : pos === 3 ? "top3" : "";
      return `
      <div class="dash-rank-row" onclick="irADashPasajero(${r.pasajeroId})">
        <div class="dash-rank-num ${cls}">${pos}</div>
        <div class="dash-rank-avatar">${getInitials(r.nombre)}</div>
        <div class="dash-rank-name">${r.nombre}</div>
        <span class="dash-rank-pts">⭐ ${r.puntos} pts</span>
      </div>`;
    }).join("");
  }

  return `
  <div class="dash-section">
    <div class="dash-section-title">
      <span class="dash-icon">${_dashIcons.puntos}</span>
      Top pasajeros · puntos 2026
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
