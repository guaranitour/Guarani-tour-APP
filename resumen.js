/* ═══════════════════════════════════════════════
   resumen.js — Resumen financiero del viaje
   Solo visible para admin y worker
═══════════════════════════════════════════════ */

async function loadResumen(viajeId) {
  const cont = document.getElementById("resumen-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  /* ── Queries en paralelo ─────────────────────── */
  const [
    { data: vpRows },
    { data: pagosRows },
    { data: egresosRows },
    { data: presRows },
    { data: catRows },
    { data: metodosRows }
  ] = await Promise.all([
    // Pasajeros del viaje + join a pasajeros para Vendedor y Sexo
    supabaseClient
      .from("viaje_pasajeros")
      .select(`
        id, total_a_pagar, asistencia, puntos_destino,
        pasajeros ( Vendedor, Sexo )
      `)
      .eq("viaje_id", viajeId),

    // Todos los pagos: monto, tipo y método
    supabaseClient
      .from("pagos")
      .select("viaje_pasajero_id, monto, tipo, metodo_pago_id")
      .in(
        "viaje_pasajero_id",
        (pasajerosDelViaje && pasajerosDelViaje.length > 0)
          ? pasajerosDelViaje.map(p => p.id)
          : ["__none__"]
      ),

    // Egresos: monto, categoría y caja_saliente (método de pago)
    supabaseClient
      .from("egresos")
      .select("monto, categoria_id, caja_saliente")
      .eq("viaje_id", viajeId),

    // Presupuesto del viaje
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, monto_presupuestado")
      .eq("viaje_id", viajeId),

    // Nombres de categorías
    supabaseClient
      .from("categorias")
      .select("id, nombre"),

    // Nombres de métodos de pago
    supabaseClient
      .from("metodos_de_pago")
      .select("id, metodo_de_pago")
  ]);

  /* ── Mapas de lookup ─────────────────────────── */
  const catMap = Object.fromEntries((catRows    || []).map(c => [String(c.id), c.nombre]));
  const metMap = Object.fromEntries((metodosRows|| []).map(m => [String(m.id), m.metodo_de_pago]));

  /* ── Cálculos de pasajeros ───────────────────── */
  const totalPasajeros = (vpRows || []).length;
  const totalAsisten   = (vpRows || []).filter(p => p.asistencia === "Asiste").length;
  const totalEsperado  = (vpRows || []).reduce((s, p) => s + (p.total_a_pagar || 0), 0);

  // Desglose por sexo
  const porSexo = { M: 0, F: 0, otro: 0 };
  (vpRows || []).forEach(p => {
    const s = p.pasajeros?.Sexo;
    if (s === "M" || s === "Masculino") porSexo.M++;
    else if (s === "F" || s === "Femenino") porSexo.F++;
    else porSexo.otro++;
  });

  // Club Destino: miembro = puntos_destino > 0
  const totalMiembros   = (vpRows || []).filter(p => (p.puntos_destino || 0) > 0).length;
  const totalNoMiembros = totalPasajeros - totalMiembros;

  // Puntos acumulados (solo Asiste)
  const totalPuntos = (vpRows || [])
    .filter(p => p.asistencia === "Asiste")
    .reduce((s, p) => s + (p.puntos_destino || 0), 0);
  const ptsPorMiembro = totalMiembros > 0
    ? Math.round(totalPuntos / totalMiembros)
    : 0;

  // Pasajeros por vendedor
  const porVendedor = {};
  (vpRows || []).forEach(p => {
    const v = p.pasajeros?.Vendedor || "Sin vendedor";
    if (!porVendedor[v]) porVendedor[v] = { total: 0, asisten: 0 };
    porVendedor[v].total++;
    if (p.asistencia === "Asiste") porVendedor[v].asisten++;
  });
  const vendedorEntries = Object.entries(porVendedor)
    .sort((a, b) => b[1].total - a[1].total);

  /* ── Cálculos de pagos ───────────────────────── */
  // Pagado por pasajero (solo tipo "Pago" menos "Devolución" y "Transferencia")
  const pagadoPorVP = {};
  const cobradoPorMetodo = {};
  let totalCobrado = 0, totalDevuelto = 0, totalTransferido = 0;

  (pagosRows || []).forEach(pg => {
    const vpId = String(pg.viaje_pasajero_id);
    if (!pagadoPorVP[vpId]) pagadoPorVP[vpId] = 0;

    if (pg.tipo === "Pago") {
      totalCobrado += pg.monto || 0;
      pagadoPorVP[vpId] += pg.monto || 0;
      const nombre = metMap[String(pg.metodo_pago_id)] || "Sin método";
      cobradoPorMetodo[nombre] = (cobradoPorMetodo[nombre] || 0) + (pg.monto || 0);
    }
    if (pg.tipo === "Devolución") {
      totalDevuelto += pg.monto || 0;
      pagadoPorVP[vpId] -= pg.monto || 0;
    }
    if (pg.tipo === "Transferencia") {
      totalTransferido += pg.monto || 0;
      pagadoPorVP[vpId] -= pg.monto || 0;
    }
  });

  // Pasajeros con saldo pendiente vs. al día
  let paxAlDia = 0, paxConDeuda = 0;
  (vpRows || []).forEach(p => {
    const pagado = pagadoPorVP[String(p.id)] || 0;
    const debe   = (p.total_a_pagar || 0) - pagado;
    if (debe <= 0) paxAlDia++;
    else paxConDeuda++;
  });

  const netoIngresado  = totalCobrado - totalDevuelto - totalTransferido;
  const saldoPendiente = Math.max(0, totalEsperado - netoIngresado);
  const pctCobrado     = totalEsperado > 0
    ? Math.min(100, Math.round((netoIngresado / totalEsperado) * 100))
    : 0;

  /* ── Cálculos de egresos ─────────────────────── */
  const totalEgresos = (egresosRows || []).reduce((s, e) => s + (e.monto || 0), 0);

  const egresosPorMetodo = {};
  (egresosRows || []).forEach(e => {
    const nombre = metMap[String(e.caja_saliente)] || "Sin método";
    egresosPorMetodo[nombre] = (egresosPorMetodo[nombre] || 0) + (e.monto || 0);
  });

  const todosMetodos = new Set([
    ...Object.keys(cobradoPorMetodo),
    ...Object.keys(egresosPorMetodo)
  ]);
  const saldoPorMetodoEntries = [...todosMetodos]
    .map(nombre => ({
      nombre,
      cobrado: cobradoPorMetodo[nombre] || 0,
      egresos: egresosPorMetodo[nombre] || 0,
      saldo:  (cobradoPorMetodo[nombre] || 0) - (egresosPorMetodo[nombre] || 0)
    }))
    .sort((a, b) => b.cobrado - a.cobrado);

  const egresosPorCat = {};
  (egresosRows || []).forEach(e => {
    const nombre = catMap[e.categoria_id] || "Sin categoría";
    egresosPorCat[nombre] = (egresosPorCat[nombre] || 0) + (e.monto || 0);
  });
  const desgloseEntries = Object.entries(egresosPorCat)
    .sort((a, b) => b[1] - a[1]);

  /* ── Presupuesto ─────────────────────────────── */
  const totalPresupuestado = (presRows || [])
    .reduce((s, f) => s + (f.monto_presupuestado || 0), 0);
  const desvioPresupuesto  = totalEgresos - totalPresupuestado;

  /* ── Saldo neto global ───────────────────────── */
  const saldoNeto = netoIngresado - totalEgresos;

  /* ── Render ──────────────────────────────────── */
  const fmt = n => (n || 0).toLocaleString("es-PY");

  cont.innerHTML = `

    <!-- ── Stat cards: pasajeros + pendiente ── -->
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Pasajeros</span>
        <span class="resumen-card-value">${totalPasajeros}</span>
        <span class="resumen-card-sub">${totalAsisten} asisten</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Saldo pendiente</span>
        <span class="resumen-card-value ${saldoPendiente > 0 ? "negativo" : "positivo"}">
          ${saldoPendiente > 0 ? "Gs. " + fmt(saldoPendiente) : "✅ Al día"}
        </span>
        <span class="resumen-card-sub">${pctCobrado}% cobrado</span>
      </div>
    </div>

    <!-- ── Pasajeros: deuda + sexo ── -->
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Al día / Con deuda</span>
        <span class="resumen-card-value">
          <span class="positivo">${paxAlDia}</span>
          <span style="color:var(--text-muted);font-weight:400"> / </span>
          <span class="${paxConDeuda > 0 ? "negativo" : ""}">${paxConDeuda}</span>
        </span>
        <span class="resumen-card-sub">pasajeros</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Por sexo</span>
        <span class="resumen-card-value">${porSexo.M}M · ${porSexo.F}F${porSexo.otro > 0 ? " · " + porSexo.otro + "?" : ""}</span>
        <span class="resumen-card-sub">de ${totalPasajeros} pasajeros</span>
      </div>
    </div>

    <!-- ── Recaudación ── -->
    <div class="resumen-section-title">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      Recaudación
    </div>
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Total esperado</span>
        <span class="resumen-card-value">Gs. ${fmt(totalEsperado)}</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Neto cobrado</span>
        <span class="resumen-card-value positivo">Gs. ${fmt(netoIngresado)}</span>
      </div>
    </div>
    <div class="resumen-progress-wrap">
      <div class="resumen-progress-bar">
        <div class="resumen-progress-fill ${pctCobrado >= 100 ? "completo" : ""}"
             style="width:${pctCobrado}%"></div>
      </div>
      <span class="resumen-pct">${pctCobrado}%</span>
    </div>
    ${totalDevuelto > 0 || totalTransferido > 0 ? `
    <div class="resumen-movimientos">
      ${totalCobrado > 0    ? `<div class="resumen-mov-row"><span>Total cobrado</span><span class="positivo">+ Gs. ${fmt(totalCobrado)}</span></div>` : ""}
      ${totalDevuelto > 0   ? `<div class="resumen-mov-row"><span>Devoluciones</span><span class="negativo">− Gs. ${fmt(totalDevuelto)}</span></div>` : ""}
      ${totalTransferido > 0? `<div class="resumen-mov-row"><span>Transferencias internas</span><span class="negativo">− Gs. ${fmt(totalTransferido)}</span></div>` : ""}
    </div>` : ""}

    <!-- ── Por método de pago ── -->
    <div class="resumen-section-title" style="margin-top:1.25rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
      Por método de pago
    </div>
    ${saldoPorMetodoEntries.map(r => `
    <div class="resumen-metodo-card">
      <div class="resumen-metodo-nombre">${r.nombre}</div>
      <div class="resumen-metodo-cols">
        <div class="resumen-metodo-col">
          <span class="resumen-metodo-col-label">Cobrado</span>
          <span class="resumen-metodo-col-value cobrado">Gs. ${fmt(r.cobrado)}</span>
        </div>
        <div class="resumen-metodo-col">
          <span class="resumen-metodo-col-label">Egresos</span>
          <span class="resumen-metodo-col-value egreso">${r.egresos > 0 ? "Gs. " + fmt(r.egresos) : "—"}</span>
        </div>
        <div class="resumen-metodo-col">
          <span class="resumen-metodo-col-label">Saldo</span>
          <span class="resumen-metodo-col-value ${r.saldo >= 0 ? "positivo" : "negativo"}">
            ${r.saldo >= 0 ? "+" : "−"} Gs. ${fmt(Math.abs(r.saldo))}
          </span>
        </div>
      </div>
    </div>`).join("")}

    <!-- ── Egresos ── -->
    <div class="resumen-section-title" style="margin-top:1.25rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="12" y1="1" x2="12" y2="23"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
      Egresos
    </div>
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Total egresos</span>
        <span class="resumen-card-value negativo">Gs. ${fmt(totalEgresos)}</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Presupuestado</span>
        <span class="resumen-card-value neutro">
          ${totalPresupuestado > 0 ? "Gs. " + fmt(totalPresupuestado) : "—"}
        </span>
        ${totalPresupuestado > 0 ? `
        <span class="resumen-card-sub">
          ${desvioPresupuesto > 0
            ? "▲ Gs. " + fmt(desvioPresupuesto) + " sobre"
            : desvioPresupuesto < 0
              ? "▼ Gs. " + fmt(Math.abs(desvioPresupuesto)) + " bajo"
              : "Exacto"}
        </span>` : ""}
      </div>
    </div>

    ${desgloseEntries.length > 0 ? `
    <div class="resumen-section-title" style="margin-top:.25rem">Por categoría</div>
    <div>
      ${desgloseEntries.map(([nombre, monto]) => `
      <div class="resumen-desglose-row">
        <span class="resumen-desglose-nombre">${nombre}</span>
        <span class="resumen-desglose-monto">Gs. ${fmt(monto)}</span>
      </div>`).join("")}
    </div>` : ""}

    <!-- ── Saldo neto global ── -->
    <div class="resumen-saldo-row">
      <span class="resumen-saldo-label">Saldo neto (cobrado − egresos)</span>
      <span class="resumen-saldo-valor ${saldoNeto >= 0 ? "positivo" : "negativo"}">
        Gs. ${fmt(saldoNeto)}
      </span>
    </div>

    <!-- ── Club Destino ── -->
    <div class="resumen-section-title" style="margin-top:1.25rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      Club Destino
    </div>
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Miembros / No miembros</span>
        <span class="resumen-card-value">
          <span class="neutro">${totalMiembros}</span>
          <span style="color:var(--text-muted);font-weight:400"> / </span>
          ${totalNoMiembros}
        </span>
        <span class="resumen-card-sub">de ${totalPasajeros} pasajeros</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Puntos acumulados</span>
        <span class="resumen-card-value neutro">⭐ ${fmt(totalPuntos)}</span>
        <span class="resumen-card-sub">~${fmt(ptsPorMiembro)} pts/miembro</span>
      </div>
    </div>

    <!-- ── Por vendedor ── -->
    ${vendedorEntries.length > 0 ? `
    <div class="resumen-section-title" style="margin-top:1.25rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      Por vendedor
    </div>
    <div>
      ${vendedorEntries.map(([nombre, data]) => `
      <div class="resumen-desglose-row">
        <span class="resumen-desglose-nombre">${nombre}</span>
        <span class="resumen-vendedor-pills">
          <span class="resumen-pill">${data.total} pax</span>
          ${data.asisten > 0 ? `<span class="resumen-pill asiste">${data.asisten} asisten</span>` : ""}
        </span>
      </div>`).join("")}
    </div>` : ""}

    <div style="height:1.5rem"></div>
  `;
}
