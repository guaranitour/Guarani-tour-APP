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
    { data: catRows }
  ] = await Promise.all([
    // Pasajeros del viaje
    supabaseClient
      .from("viaje_pasajeros")
      .select("id, total_a_pagar, asistencia")
      .eq("viaje_id", viajeId),

    // Todos los pagos de esos pasajeros
    supabaseClient
      .from("pagos")
      .select("viaje_pasajero_id, monto, tipo")
      .in(
        "viaje_pasajero_id",
        // necesitamos los ids; si aún no los tenemos hacemos la query igualmente
        // (Supabase acepta subquery via viaje_id con join, pero usamos ids vacíos como fallback seguro)
        (pasajerosDelViaje && pasajerosDelViaje.length > 0)
          ? pasajerosDelViaje.map(p => p.id)
          : ["__none__"]
      ),

    // Egresos del viaje
    supabaseClient
      .from("egresos")
      .select("monto, categoria_id")
      .eq("viaje_id", viajeId),

    // Presupuesto del viaje
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, monto_presupuestado")
      .eq("viaje_id", viajeId),

    // Nombres de categorías
    supabaseClient
      .from("categorias")
      .select("id, nombre")
  ]);

  /* ── Cálculos de pasajeros ───────────────────── */
  const totalPasajeros = (vpRows || []).length;
  const totalAsisten   = (vpRows || []).filter(p => p.asistencia === "Asiste").length;
  const totalEsperado  = (vpRows || []).reduce((s, p) => s + (p.total_a_pagar || 0), 0);

  /* ── Cálculos de pagos ───────────────────────── */
  let totalCobrado = 0, totalDevuelto = 0, totalTransferido = 0;
  (pagosRows || []).forEach(pg => {
    if (pg.tipo === "Pago")          totalCobrado     += pg.monto || 0;
    if (pg.tipo === "Devolución")    totalDevuelto    += pg.monto || 0;
    if (pg.tipo === "Transferencia") totalTransferido += pg.monto || 0;
  });
  const netoIngresado = totalCobrado - totalDevuelto - totalTransferido;
  const saldoPendiente = Math.max(0, totalEsperado - netoIngresado);
  const pctCobrado = totalEsperado > 0
    ? Math.min(100, Math.round((netoIngresado / totalEsperado) * 100))
    : 0;

  /* ── Cálculos de egresos ─────────────────────── */
  const totalEgresos = (egresosRows || []).reduce((s, e) => s + (e.monto || 0), 0);
  const saldoNeto    = netoIngresado - totalEgresos;

  /* ── Desglose egresos por categoría ─────────── */
  const catMap = Object.fromEntries((catRows || []).map(c => [c.id, c.nombre]));
  const egresosPorCat = {};
  (egresosRows || []).forEach(e => {
    const nombre = catMap[e.categoria_id] || "Sin categoría";
    egresosPorCat[nombre] = (egresosPorCat[nombre] || 0) + (e.monto || 0);
  });
  const desgloseEntries = Object.entries(egresosPorCat)
    .sort((a, b) => b[1] - a[1]);

  /* ── Presupuesto total ───────────────────────── */
  const totalPresupuestado = (presRows || [])
    .reduce((s, f) => s + (f.monto_presupuestado || 0), 0);
  const desvioPresupuesto  = totalEgresos - totalPresupuestado;

  /* ── Render ──────────────────────────────────── */
  const fmt = n => n.toLocaleString("es-PY");

  cont.innerHTML = `

    <!-- Stat cards: pasajeros -->
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

    <!-- Recaudación -->
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

    <!-- Egresos -->
    <div class="resumen-section-title" style="margin-top:1.25rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
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
            ? "▲ Gs. " + fmt(desvioPresupuesto) + " sobre presupuesto"
            : desvioPresupuesto < 0
              ? "▼ Gs. " + fmt(Math.abs(desvioPresupuesto)) + " bajo presupuesto"
              : "Exacto"}
        </span>` : ""}
      </div>
    </div>

    ${desgloseEntries.length > 0 ? `
    <div class="resumen-section-title" style="margin-top:.25rem">
      Por categoría
    </div>
    <div>
      ${desgloseEntries.map(([nombre, monto]) => `
      <div class="resumen-desglose-row">
        <span class="resumen-desglose-nombre">${nombre}</span>
        <span class="resumen-desglose-monto">Gs. ${fmt(monto)}</span>
      </div>`).join("")}
    </div>` : ""}

    <!-- Saldo neto final -->
    <div class="resumen-saldo-row">
      <span class="resumen-saldo-label">Saldo neto (cobrado − egresos)</span>
      <span class="resumen-saldo-valor ${saldoNeto >= 0 ? "positivo" : "negativo"}">
        Gs. ${fmt(saldoNeto)}
      </span>
    </div>
  `;
}
