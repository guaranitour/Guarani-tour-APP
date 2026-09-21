/* ═══════════════════════════════════════════════
   resumen.js — Resumen financiero del viaje
   Solo visible para admin y worker
═══════════════════════════════════════════════ */

async function loadResumen(viajeId) {
  const cont = document.getElementById("resumen-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  /* ── Pasajeros del viaje (se necesita antes para filtrar pagos) ── */
  const { data: vpRows } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      id, total_a_pagar, asistencia, puntos_destino,
      pasajeros ( Vendedor, Sexo )
    `)
    .eq("viaje_id", viajeId);

  // Ids de este viaje, para filtrar pagos directo por viajeId
  // (no se usa la variable global pasajerosDelViaje: puede no
  // corresponder todavía al viaje que se está cargando).
  const vpIds = (vpRows || []).map(v => v.id);

  // El viaje puede o no tener habilitados los servicios extra —
  // determina si se consultan y si se muestra la sección en el resumen.
  const extrasHabilitados = !!viajeActualData?.extras_habilitados;

  /* ── Resto de queries en paralelo ────────────── */
  const [
    { data: pagosRows },
    { data: egresosRows },
    { data: presRows },
    { data: catRows },
    { data: metodosRows },
    { data: extrasVpRows },
    { data: serviciosExtraRows }
  ] = await Promise.all([
    // Todos los pagos de este viaje: monto, tipo y método
    supabaseClient
      .from("pagos")
      .select("viaje_pasajero_id, monto, tipo, metodo_pago_id")
      .in("viaje_pasajero_id", vpIds.length > 0 ? vpIds : ["__none__"]),

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
      .select("id, metodo_de_pago"),

    // Servicios extra asignados a pasajeros de este viaje (para sumar al
    // total esperado y para el conteo por servicio). Solo si el viaje
    // tiene la función habilitada.
    extrasHabilitados
      ? supabaseClient
          .from("servicio_extra_pasajeros")
          .select("viaje_pasajero_id, servicio_extra_id, precio_venta_real")
          .in("viaje_pasajero_id", vpIds.length > 0 ? vpIds : ["__none__"])
      : Promise.resolve({ data: [] }),

    // Catálogo de servicios extra del viaje (nombre por id), para mostrar
    // la sección aunque todavía no tenga ningún extra asignado.
    extrasHabilitados
      ? supabaseClient
          .from("servicios_extra")
          .select("id, nombre")
          .eq("viaje_id", viajeId)
      : Promise.resolve({ data: [] })
  ]);

  /* ── Mapas de lookup ─────────────────────────── */
  const catMap = Object.fromEntries((catRows    || []).map(c => [String(c.id), c.nombre]));
  const metMap = Object.fromEntries((metodosRows|| []).map(m => [String(m.id), m.metodo_de_pago]));

  /* ── Cálculos de pasajeros ───────────────────── */
  const totalPasajeros = (vpRows || []).length;
  const totalAsisten   = (vpRows || []).filter(p => p.asistencia === "Asiste").length;

  // Ids de viaje_pasajeros que asisten, para filtrar extras por asistencia.
  const vpIdsAsisten = new Set(
    (vpRows || [])
      .filter(p => p.asistencia === "Asiste")
      .map(p => String(p.id))
  );

  // Solo extras de pasajeros que asisten cuentan en el total esperado y en
  // el conteo por servicio (misma regla que el resto del resumen).
  const extrasVpAsisten = (extrasVpRows || [])
    .filter(e => vpIdsAsisten.has(String(e.viaje_pasajero_id)));

  const totalExtras = extrasVpAsisten
    .reduce((s, e) => s + (e.precio_venta_real || 0), 0);

  // Solo cuenta como "esperado" lo de pasajeros que van a asistir,
  // incluyendo los servicios extra que tengan asignados.
  const totalEsperado  = (vpRows || [])
    .filter(p => p.asistencia === "Asiste")
    .reduce((s, p) => s + (p.total_a_pagar || 0), 0) + totalExtras;

  // Conteo de pasajeros (que asisten) por servicio extra contratado.
  // Se listan todos los servicios del catálogo del viaje, aunque tengan 0.
  const conteoPorServicio = {};
  (serviciosExtraRows || []).forEach(s => {
    conteoPorServicio[s.id] = { nombre: s.nombre, cantidad: 0 };
  });
  extrasVpAsisten.forEach(e => {
    const key = e.servicio_extra_id;
    if (!conteoPorServicio[key]) conteoPorServicio[key] = { nombre: "Servicio eliminado", cantidad: 0 };
    conteoPorServicio[key].cantidad++;
  });
  const serviciosExtraEntries = Object.values(conteoPorServicio)
    .sort((a, b) => b.cantidad - a.cantidad);

  // Desglose por sexo — solo pasajeros que asisten
  const porSexo = { M: 0, F: 0, otro: 0 };
  (vpRows || [])
    .filter(p => p.asistencia === "Asiste")
    .forEach(p => {
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

  // Pasajeros por vendedor — normalizar espacios para evitar duplicados
  const porVendedor = {};
  (vpRows || []).forEach(p => {
    const raw = p.pasajeros?.Vendedor || "";
    const v = raw.trim().replace(/\s+/g, " ") || "Sin vendedor";
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

  // Pasajeros con saldo pendiente vs. al día — solo los que asisten
  let paxAlDia = 0, paxConDeuda = 0;
  (vpRows || [])
    .filter(p => p.asistencia === "Asiste")
    .forEach(p => {
      const pagado = pagadoPorVP[String(p.id)] || 0;
      const debe   = (p.total_a_pagar || 0) - pagado;
      if (debe <= 0) paxAlDia++;
      else paxConDeuda++;
    });

  // Recaudado (neto de devoluciones/transferencias) de pasajeros que NO
  // asisten — se muestra aparte para no inflar el total esperado del viaje.
  const asistenRows     = (vpRows || []).filter(p => p.asistencia === "Asiste");
  const noAsistenRows   = (vpRows || []).filter(p => p.asistencia !== "Asiste");
  const totalNoAsisten  = noAsistenRows.length;
  const recaudadoNoAsisten = noAsistenRows
    .reduce((s, p) => s + (pagadoPorVP[String(p.id)] || 0), 0);

  // netoIngresado = todo lo cobrado en el viaje (para "Neto cobrado" y para
  // el desglose por método/caja, que sí debe incluir a los no-asisten).
  const netoIngresado = totalCobrado - totalDevuelto - totalTransferido;

  // netoIngresadoAsisten = neto solo de pasajeros que asisten. Es el que
  // corresponde comparar contra totalEsperado (también filtrado por
  // "Asiste"), para que saldoPendiente y pctCobrado no se reduzcan por
  // pagos de pasajeros que no van a asistir.
  const netoIngresadoAsisten = asistenRows
    .reduce((s, p) => s + (pagadoPorVP[String(p.id)] || 0), 0);

  const saldoPendiente = Math.max(0, totalEsperado - netoIngresadoAsisten);
  const pctCobrado     = totalEsperado > 0
    ? Math.min(100, Math.round((netoIngresadoAsisten / totalEsperado) * 100))
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

  // Íconos reutilizados (evita repetir el mismo <svg> 3 veces en el string)
  const icoDinero = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
  const icoTarjeta = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
  const icoEstrella = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  const icoUsuarios = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  const icoExtra = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-6"/><path d="M2 7h20v5H2z"/><path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`;

  cont.innerHTML = `

    <!-- ══ HERO: saldo neto global — lo primero que se ve ══ -->
    <div class="resumen-hero ${saldoNeto >= 0 ? "positivo" : "negativo"}">
      <span class="resumen-hero-label">Saldo neto del viaje</span>
      <span class="resumen-hero-valor">Gs. ${fmt(saldoNeto)}</span>
      <span class="resumen-hero-sub">Cobrado − egresos · incluye asisten y no asisten</span>
    </div>

    <!-- ══ RECAUDACIÓN ══ -->
    <div class="resumen-section-title">${icoDinero} Recaudación</div>

    <div class="resumen-progress-wrap">
      <div class="resumen-progress-bar">
        <div class="resumen-progress-fill ${pctCobrado >= 100 ? "completo" : ""}"
             style="width:${pctCobrado}%"></div>
      </div>
      <span class="resumen-pct">${pctCobrado}%</span>
    </div>

    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Total esperado</span>
        <span class="resumen-card-value">Gs. ${fmt(totalEsperado)}</span>
        <span class="resumen-card-sub">pasajeros que asisten${totalExtras > 0 ? " + extras" : ""}</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Saldo pendiente</span>
        <span class="resumen-card-value ${saldoPendiente > 0 ? "negativo" : "positivo"}">
          ${saldoPendiente > 0 ? "Gs. " + fmt(saldoPendiente) : "✅ Al día"}
        </span>
        <span class="resumen-card-sub">${pctCobrado}% cobrado</span>
      </div>
    </div>

    ${totalNoAsisten > 0 ? `
    <div class="resumen-grid">
      <div class="resumen-card full">
        <span class="resumen-card-label">Recaudado de no asisten</span>
        <span class="resumen-card-value ${recaudadoNoAsisten > 0 ? "positivo" : ""}">Gs. ${fmt(recaudadoNoAsisten)}</span>
        <span class="resumen-card-sub">${totalNoAsisten} pasajero${totalNoAsisten === 1 ? "" : "s"} no asiste${totalNoAsisten === 1 ? "" : "n"} · no cuenta en el total esperado</span>
      </div>
    </div>` : ""}

    ${totalDevuelto > 0 || totalTransferido > 0 ? `
    <div class="resumen-movimientos">
      ${totalCobrado > 0    ? `<div class="resumen-mov-row"><span>Total cobrado</span><span class="positivo">+ Gs. ${fmt(totalCobrado)}</span></div>` : ""}
      ${totalDevuelto > 0   ? `<div class="resumen-mov-row"><span>Devoluciones</span><span class="negativo">− Gs. ${fmt(totalDevuelto)}</span></div>` : ""}
      ${totalTransferido > 0? `<div class="resumen-mov-row"><span>Transferencias internas</span><span class="negativo">− Gs. ${fmt(totalTransferido)}</span></div>` : ""}
      <div class="resumen-mov-row"><span>Neto cobrado</span><span class="positivo">Gs. ${fmt(netoIngresado)}</span></div>
    </div>` : ""}

    <!-- ══ PASAJEROS ══ -->
    <div class="resumen-section-title" style="margin-top:1.25rem">${icoUsuarios} Pasajeros</div>
    <div class="resumen-grid">
      <div class="resumen-card">
        <span class="resumen-card-label">Total / Asisten</span>
        <span class="resumen-card-value">${totalPasajeros} <span style="color:var(--text-muted);font-weight:400">/</span> ${totalAsisten}</span>
      </div>
      <div class="resumen-card">
        <span class="resumen-card-label">Al día / Con deuda</span>
        <span class="resumen-card-value">
          <span class="positivo">${paxAlDia}</span>
          <span style="color:var(--text-muted);font-weight:400"> / </span>
          <span class="${paxConDeuda > 0 ? "negativo" : ""}">${paxConDeuda}</span>
        </span>
        <span class="resumen-card-sub">de los que asisten</span>
      </div>
    </div>
    <div class="resumen-grid">
      <div class="resumen-card full">
        <span class="resumen-card-label">Por sexo</span>
        <span class="resumen-card-value">${porSexo.M}M · ${porSexo.F}F${porSexo.otro > 0 ? " · " + porSexo.otro + "?" : ""}</span>
        <span class="resumen-card-sub">de ${totalAsisten} que asisten</span>
      </div>
    </div>

    <!-- ══ CLUB DESTINO ══ -->
    <div class="resumen-section-title" style="margin-top:1.25rem">${icoEstrella} Club Destino</div>
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

    ${extrasHabilitados ? `
    <!-- ══ SERVICIOS EXTRA ══ -->
    <div class="resumen-section-title" style="margin-top:1.25rem">${icoExtra} Servicios extra</div>
    ${serviciosExtraEntries.length > 0 ? `
    <div>
      ${serviciosExtraEntries.map(s => `
      <div class="resumen-desglose-row">
        <span class="resumen-desglose-nombre">${_escapeHtml(s.nombre)}</span>
        <span class="resumen-pill${s.cantidad > 0 ? " asiste" : ""}">${s.cantidad} pasajero${s.cantidad === 1 ? "" : "s"}</span>
      </div>`).join("")}
    </div>` : `
    <div class="viaje-pasajeros-empty">Sin servicios extra registrados</div>`}
    ` : ""}

    <!-- ══ DETALLE (colapsado por defecto) ══ -->
    <div class="resumen-section-title" style="margin-top:1.5rem">Detalle</div>

    <details class="resumen-details">
      <summary>
        ${icoTarjeta}
        <span>Por método de pago</span>
        <span class="resumen-details-badge">${saldoPorMetodoEntries.length}</span>
      </summary>
      <div class="resumen-details-body">
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
      </div>
    </details>

    <details class="resumen-details">
      <summary>
        ${icoDinero}
        <span>Egresos</span>
        <span class="resumen-details-badge">Gs. ${fmt(totalEgresos)}</span>
      </summary>
      <div class="resumen-details-body">
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
        <div class="resumen-section-title" style="margin-top:.5rem">Por categoría</div>
        <div>
          ${desgloseEntries.map(([nombre, monto]) => `
          <div class="resumen-desglose-row">
            <span class="resumen-desglose-nombre">${nombre}</span>
            <span class="resumen-desglose-monto">Gs. ${fmt(monto)}</span>
          </div>`).join("")}
        </div>` : ""}
      </div>
    </details>

    ${vendedorEntries.length > 0 ? `
    <details class="resumen-details">
      <summary>
        ${icoUsuarios}
        <span>Por vendedor</span>
        <span class="resumen-details-badge">${vendedorEntries.length}</span>
      </summary>
      <div class="resumen-details-body">
        ${vendedorEntries.map(([nombre, data]) => `
        <div class="resumen-desglose-row">
          <span class="resumen-desglose-nombre">${nombre}</span>
          <span class="resumen-vendedor-pills">
            <span class="resumen-pill">${data.total} pax</span>
            ${data.asisten > 0 ? `<span class="resumen-pill asiste">${data.asisten} asisten</span>` : ""}
          </span>
        </div>`).join("")}
      </div>
    </details>` : ""}

    <div style="height:1.5rem"></div>
  `;
}
