let viajeActualId = null;
let pasajeroSeleccionado = null;
let viajeActualData = null;
let pasajerosDelViaje = [];

/* Contexto de "reemplazo de pasajero" (ceder seña a otro).
   activo=true mientras estemos en el flujo iniciado desde
   iniciarReemplazoPasajero() en pagos.js. Se resetea al
   guardar o al cancelar. */
let reemplazoCtx = {
  activo: false,
  viajePasajeroOrigenId: null,
  viajeId: null,
  nombreOrigen: null,
};
// CIs normalizados presentes en basesycondiciones (aceptaron ByC)
let _bycAceptados = new Set();
/* ─────────────────────────────────────────────
   viajes_activos.js — Gestión de viajes
───────────────────────────────────────────── */

let allViajes = [];

/* ── HISTÓRICO: estado de paginación ───────── */
// Cada "página" = 6 meses hacia atrás
// _historicoOffset = 0 → últimos 6 meses
// _historicoOffset = 1 → meses 6-12 atrás, etc.
let _historicoOffset     = 0;
let _historicoAgotado    = false;
let _historicoData       = []; // acumulado de todos los viajes cargados

/* ── CARGAR VIAJES ─────────────────────────── */
// modo: "activos" (default) → estado activo
//       "historico"         → completado/cancelado, paginado por fecha_salida
async function loadViajes(modo = "activos") {
  const listId = modo === "historico" ? "historico-list" : "viajes-list";
  const list = document.getElementById(listId);
  if (!list) return;

  if (modo !== "historico") {
    list.innerHTML = "Cargando…";
  }

  if (modo === "historico") {
    // Reset al entrar al histórico (primera carga)
    _historicoOffset  = 0;
    _historicoAgotado = false;
    _historicoData    = [];
    list.innerHTML    = "Cargando…";
    await _cargarBloqueHistorico(list);
    return;
  }

  // ── Viajes activos ──────────────────────────
  const { data, error } = await supabaseClient
    .from("viajes")
    .select("*")
    .eq("estado", "activo")
    .order("fecha_salida", { ascending: true });

  if (error) {
    console.error(error);
    list.innerHTML = "Error al cargar viajes";
    return;
  }

  allViajes = data;

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin viajes registrados</div>`;
    return;
  }

  list.innerHTML = renderViajeCards(data);
  // Chequear alertas 48h solo para viajes activos
  checkAlertasViajes(data);
}

/* ── CARGA UN BLOQUE DE 6 MESES DEL HISTÓRICO ─ */
async function _cargarBloqueHistorico(list) {
  if (!list) list = document.getElementById("historico-list");
  if (!list) return;

  const hoy   = new Date();
  const desde = new Date(hoy);
  desde.setMonth(desde.getMonth() - (_historicoOffset + 1) * 6);
  const hasta = new Date(hoy);
  hasta.setMonth(hasta.getMonth() - _historicoOffset * 6);

  const desdeStr = desde.toISOString().split("T")[0];
  const hastaStr = hasta.toISOString().split("T")[0];

  let query = supabaseClient
    .from("viajes")
    .select("*")
    .in("estado", ["completado", "cancelado"])
    .gte("fecha_salida", desdeStr);

  // En el primer bloque (offset 0) no ponemos tope superior: así los viajes
  // cancelados/completados con fecha_salida aún futura (ej. cancelados antes
  // de su fecha de salida) no quedan huérfanos fuera del rango.
  if (_historicoOffset > 0) {
    query = query.lt("fecha_salida", hastaStr);
  }

  const { data, error } = await query.order("fecha_salida", { ascending: false });

  if (error) {
    console.error(error);
    list.innerHTML = "Error al cargar histórico";
    return;
  }

  const nuevos = data || [];
  _historicoData = [..._historicoData, ...nuevos];
  allViajes      = _historicoData; // para que filtrarHistorico funcione sobre el acumulado

  // Si vino vacío, marcar como agotado y seguir buscando hacia atrás (puede haber huecos)
  if (nuevos.length === 0) {
    // Comprobamos si hay algo más antiguo aún
    const { count } = await supabaseClient
      .from("viajes")
      .select("id", { count: "exact", head: true })
      .in("estado", ["completado", "cancelado"])
      .lt("fecha_salida", desdeStr);

    if (!count || count === 0) {
      _historicoAgotado = true;
    }
    _historicoOffset++;
  } else {
    _historicoOffset++;
  }

  renderHistorico(_historicoData);
}

/* ── BOTÓN VER MÁS DEL HISTÓRICO ──────────── */
async function cargarMasHistorico() {
  if (_historicoAgotado) return;
  const btn = document.getElementById("historico-ver-mas");
  if (btn) { btn.disabled = true; btn.textContent = "Cargando…"; }
  await _cargarBloqueHistorico();
}

function renderViajeCards(data) {
  return data.map(v => {
  const estado = v.estado || "activo";
  const placeholder = `
    <div class="viaje-card-img-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
    </div>`;
  return `
  <div class="viaje-card" data-viaje-id="${v.id}" onclick="openViajeDetalle('${v.id}')">
    <div class="viaje-card-media">
      ${v.imagen_url ? `<img src="${v.imagen_url}" class="viaje-card-img" />` : placeholder}
      <div class="viaje-card-overlay">
        <div class="viaje-card-nombre">${v.nombre}</div>
        <div class="viaje-card-meta">
          <span class="viaje-pill ${estado}">${estado}</span>
          ${v.puntos_destino ? `<span class="viaje-puntos">⭐ ${v.puntos_destino} pts</span>` : ""}
          ${v.fecha_salida ? `
            <span class="viaje-card-fecha">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              ${formatFecha(v.fecha_salida)}
            </span>` : ""}
        </div>
      </div>
    </div>
  </div>`
}).join("");
}

/* ── ALERTAS 48h / DÍA DE SALIDA ───────────── */
async function checkAlertasViajes(viajes) {
  const ahora  = new Date();
  const en48h  = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);
  const hoyStr = ahora.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // Viajes que salen hoy O dentro de las próximas 48 horas
  const viajesEnRiesgo = viajes.filter(v => {
    if (!v.fecha_salida) return false;
    const salida = new Date(v.fecha_salida + "T00:00:00");
    // Hoy: fecha_salida == hoy (independientemente de la hora actual)
    if (v.fecha_salida === hoyStr) return true;
    // Próximas 48h: salida futura pero dentro del rango
    return salida > ahora && salida <= en48h;
  });

  if (viajesEnRiesgo.length === 0) return;

  // Para cada viaje dentro de 48h, consultar pagos, total esperado y asistentes
  const checks = await Promise.all(
    viajesEnRiesgo.map(async v => {
      // Traer pasajeros (total_a_pagar + asistencia) en una sola query
      const { data: pasajeros } = await supabaseClient
        .from("viaje_pasajeros")
        .select("id, total_a_pagar, asistencia")
        .eq("viaje_id", v.id);

      const vpIds = (pasajeros || []).map(p => p.id);

      const { data: pagos } = vpIds.length > 0
        ? await supabaseClient
            .from("pagos")
            .select("monto, tipo")
            .in("viaje_pasajero_id", vpIds)
        : { data: [] };

      // ── Cálculo de cobro ────────────────────
      const totalEsperado = (pasajeros || []).reduce((s, p) => s + (p.total_a_pagar || 0), 0);

      const pagosReales    = (pagos || []).filter(p => p.tipo === "Pago");
      const devoluciones   = (pagos || []).filter(p => p.tipo === "Devolución");
      const transferencias = (pagos || []).filter(p => p.tipo === "Transferencia");

      const totalCobrado =
        pagosReales.reduce((s, p) => s + (p.monto || 0), 0) -
        devoluciones.reduce((s, p) => s + (p.monto || 0), 0) -
        transferencias.reduce((s, p) => s + (p.monto || 0), 0);

      const porcentaje = totalEsperado > 0
        ? Math.round((totalCobrado / totalEsperado) * 100)
        : 100; // si no hay total definido, no es riesgo por cobro

      // ── Cálculo de asistentes ───────────────
      const cantAsiste = (pasajeros || []).filter(p =>
        (p.asistencia || "").toLowerCase() === "asiste"
      ).length;
      const pocosAsistentes = cantAsiste < 25;

      const enRiesgo = porcentaje < 60 || pocosAsistentes;
      const esHoy    = v.fecha_salida === hoyStr;

      return { viaje: v, totalEsperado, totalCobrado, porcentaje, cantAsiste, pocosAsistentes, enRiesgo, esHoy };
    })
  );

  const conRiesgo = checks.filter(c => c.enRiesgo);
  if (conRiesgo.length === 0) return;

  // Separar: los que salen hoy son candidatos a cancelar; el resto, en riesgo
  const aCancelar  = conRiesgo.filter(c => c.esHoy);
  const enRiesgo48 = conRiesgo.filter(c => !c.esHoy);

  // ── Marcar las cards ────────────────────────
  conRiesgo.forEach(c => {
    const card = document.querySelector(`.viaje-card[data-viaje-id="${c.viaje.id}"]`);
    if (card) {
      card.classList.add(c.esHoy ? "alerta-cancelar" : "alerta-riesgo");
      const overlay = card.querySelector(".viaje-card-overlay");
      if (overlay && !overlay.querySelector(".viaje-alerta-badge")) {
        const badge = document.createElement("div");
        badge.className = "viaje-alerta-badge" + (c.esHoy ? " cancelar" : "");
        const razones = [];
        if (c.porcentaje < 60) razones.push(`${c.porcentaje}% cobrado`);
        if (c.pocosAsistentes)  razones.push(`${c.cantAsiste} asistentes`);
        const icono = c.esHoy
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
          : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
        badge.innerHTML = `${icono} ${c.esHoy ? "Evaluar cancelación" : razones.join(" · ")}`;
        overlay.insertBefore(badge, overlay.firstChild);
      }
    }
  });

  // ── Banner ─────────────────────────────────
  const list = document.getElementById("viajes-list");
  if (!list) return;

  const existingBanner = document.getElementById("alerta-viajes-banner");
  if (existingBanner) existingBanner.remove();

  // El banner muestra el nivel más urgente (cancelación > riesgo)
  // Si hay ambos, el banner es de cancelación y menciona también los de riesgo
  const grupoPrincipal = aCancelar.length > 0 ? aCancelar : enRiesgo48;
  const esCancelar     = aCancelar.length > 0;
  const esSingular     = grupoPrincipal.length === 1;

  const detalleCausas = conRiesgo.map(c => {
    const causas = [];
    if (c.porcentaje < 60) causas.push(`${c.porcentaje}% cobrado`);
    if (c.pocosAsistentes)  causas.push(`${c.cantAsiste} pasajeros confirmados`);
    const prefijo = c.esHoy ? "🔴 " : "⚠️ ";
    return `${prefijo}<strong>${c.viaje.nombre}</strong>: ${causas.join(" · ")}`;
  }).join("<br>");

  const titulo = esCancelar
    ? (esSingular
        ? `Evaluar cancelación: ${aCancelar[0].viaje.nombre}`
        : `${aCancelar.length} viajes: evaluar cancelación`)
    : (esSingular
        ? `Viaje en riesgo · sale en menos de 48 hs`
        : `${enRiesgo48.length} viajes en riesgo · salen en menos de 48 hs`);

  const subtitulo = esCancelar
    ? "El viaje sale hoy y no cumple los mínimos. Se recomienda evaluar la cancelación."
    : "";

  const banner = document.createElement("div");
  banner.id = "alerta-viajes-banner";
  banner.className = "alerta-viajes-banner" + (esCancelar ? " cancelar" : "");
  banner.innerHTML = `
    <div class="alerta-banner-icon">
      ${esCancelar
        ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
        : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
      }
    </div>
    <div class="alerta-banner-texto">
      <span class="alerta-banner-titulo">${titulo}</span>
      ${subtitulo ? `<span class="alerta-banner-subtitulo">${subtitulo}</span>` : ""}
      <span class="alerta-banner-detalle">${detalleCausas}</span>
    </div>`;

  list.insertAdjacentElement("beforebegin", banner);

}

function renderHistorico(data) {
  const list = document.getElementById("historico-list");
  if (!list) return;

  // Remover botón anterior si existe
  const btnAnterior = document.getElementById("historico-ver-mas");
  if (btnAnterior) btnAnterior.remove();

  if (!data || data.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin resultados</div>`;
    return;
  }

  list.innerHTML = renderViajeCards(data);

  // Agregar botón "Ver más" si hay más datos para cargar
  if (!_historicoAgotado) {
    const btn = document.createElement("button");
    btn.id        = "historico-ver-mas";
    btn.className = "btn-ver-mas";
    btn.textContent = "Ver más";
    btn.onclick   = cargarMasHistorico;
    list.insertAdjacentElement("afterend", btn);
  }
}

function filtrarHistorico() {
  const q = document.getElementById("historico-search")?.value.toLowerCase().trim() || "";
  // Filtra sobre el acumulado ya cargado (no hace nueva query)
  const filtrados = q
    ? _historicoData.filter(v => (v.nombre || "").toLowerCase().includes(q))
    : _historicoData;

  // Render directo sin tocar el botón "Ver más" (que ya está debajo del list)
  const list = document.getElementById("historico-list");
  if (!list) return;
  if (!filtrados || filtrados.length === 0) {
    list.innerHTML = `<div class="users-empty">Sin resultados</div>`;
    return;
  }
  list.innerHTML = renderViajeCards(filtrados);
}

/* ── FORMATEAR FECHA ───────────────────────── */
function formatFecha(val) {
  if (!val) return "—";
  const d = new Date(val);
  return d.toLocaleDateString("es-PY");
}

/* ── SUBIR IMAGEN ─────────────────────────── */
async function uploadViajeImage(file, fixedName = null) {
  const fileName = fixedName || `${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("viajes")
    .upload(fileName, file, { upsert: !!fixedName });

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("viajes")
    .getPublicUrl(fileName);

  return fixedName ? `${data.publicUrl}?t=${Date.now()}` : data.publicUrl;
}
async function uploadEgresoFile(file) {
  const fileName = `${viajeActualId}/${Date.now()}_${file.name}`;

  const { error } = await supabaseClient.storage
    .from("egresos")
    .upload(fileName, file);

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from("egresos")
    .getPublicUrl(fileName);

  return data.publicUrl;
}

/* ── CREAR VIAJE ──────────────────────────── */
async function crearViaje() {
  const nombre   = document.getElementById("v-nombre").value.trim();
  const salida   = document.getElementById("v-salida").value;
  const regreso  = document.getElementById("v-regreso").value;
  const estado   = document.getElementById("v-estado").value;
  const puntos_destino = parseInt(document.getElementById("v-puntos").value) || 0;
  const file     = document.getElementById("v-imagen").files[0];

  if (!nombre) {
    document.getElementById("v-nombre").classList.add("error");
    setTimeout(() => document.getElementById("v-nombre").classList.remove("error"), 2000);
    return;
  }

  const btn = document.querySelector("#view-viaje-nuevo .btn-save");
  if (btn) {
    if (btn.disabled) return;          // guard doble ejecución
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-dots"><span>.</span><span>.</span><span>.</span></span> Guardando`;
  }

  let imagen_url = null;

  if (file) {
    try {
      imagen_url = await uploadViajeImage(file);
    } catch (e) {
      console.error(e);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar viaje`;
      }
      alert("Error subiendo imagen");
      return;
    }
  }

  const { error } = await supabaseClient
    .from("viajes")
    .insert([{
      nombre,
      fecha_salida: salida,
      fecha_regreso: regreso,
      estado,
      imagen_url,
      puntos_destino
    }]);

  if (error) {
    console.error(error);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar viaje`;
    }
    alert("Error al guardar viaje");
    return;
  }

  navigateTo("viajes");
}

/* ── EDITAR VIAJE ─────────────────────────── */
function irEditarViaje(viajeId) {
  navigateTo("viaje-editar", parseInt(viajeId, 10));
}

async function initFormEditarViaje(viajeId) {
  viajeActualId = parseInt(viajeId, 10);

  // Usar caché si ya tenemos el viaje cargado
  let viaje = viajeActualData && viajeActualData.id === viajeActualId
    ? viajeActualData
    : null;

  if (!viaje) {
    const { data } = await supabaseClient
      .from("viajes")
      .select("*")
      .eq("id", viajeActualId)
      .single();
    viaje = data;
  }

  if (!viaje) { alert("No se pudo cargar el viaje"); return; }

  viajeActualData = viaje;

  document.getElementById("ve-nombre").value  = viaje.nombre || "";
  document.getElementById("ve-salida").value  = viaje.fecha_salida || "";
  document.getElementById("ve-regreso").value = viaje.fecha_regreso || "";
  document.getElementById("ve-estado").value  = viaje.estado || "activo";
  document.getElementById("ve-puntos").value  = viaje.puntos_destino || 0;

  initCustomSelect("ve-estado");

  // Mostrar imagen actual si existe
  const preview = document.querySelector("#view-viaje-editar .viaje-imagen-preview");
  const overlay = document.getElementById("ve-img-overlay");
  if (preview && viaje.imagen_url) {
    const existing = preview.querySelector("img");
    if (existing) existing.remove();
    const img = document.createElement("img");
    img.src = viaje.imagen_url;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  }
}

// ── Cancelación automática de viaje ─────────────────────────────────────────
// Al pasar un viaje a "cancelado":
//   1. Todos los viaje_pasajeros → asistencia = "No asiste", puntos = 0
//   2. Por cada pago real (no Devolución, no Transferencia) registrado,
//      se inserta una Devolución espejando metodo_pago_id y banco originales.
async function _procesarCancelacionViaje(viajeId) {
  // 1. Traer todos los viaje_pasajeros del viaje
  const { data: vps } = await supabaseClient
    .from("viaje_pasajeros")
    .select("id")
    .eq("viaje_id", viajeId);

  if (!vps || vps.length === 0) return;

  const vpIds = vps.map(v => v.id);

  // 2. Marcar todos como No asiste con puntos 0
  await supabaseClient
    .from("viaje_pasajeros")
    .update({ asistencia: "No asiste", puntos_destino: 0 })
    .in("id", vpIds);

  // 3. Traer pagos reales (excluir Devoluciones y Transferencias)
  const { data: pagos } = await supabaseClient
    .from("pagos")
    .select("viaje_pasajero_id, monto, metodo_pago_id, banco")
    .in("viaje_pasajero_id", vpIds)
    .eq("tipo", "Pago");

  if (!pagos || pagos.length === 0) return;

  // 4. Agrupar por viaje_pasajero_id + metodo_pago_id + banco → sumar montos
  const agrupado = {};
  pagos.forEach(p => {
    const key = `${p.viaje_pasajero_id}__${p.metodo_pago_id || ""}__${p.banco || ""}`;
    if (!agrupado[key]) {
      agrupado[key] = {
        viaje_pasajero_id : p.viaje_pasajero_id,
        metodo_pago_id    : p.metodo_pago_id || null,
        banco             : p.banco || null,
        monto             : 0,
      };
    }
    agrupado[key].monto += p.monto || 0;
  });

  // 5. Insertar una Devolución por cada grupo con monto > 0
  const hoy = new Date().toISOString().split("T")[0];
  const { data: { user } } = await supabaseClient.auth.getUser();

  const devoluciones = Object.values(agrupado)
    .filter(d => d.monto > 0)
    .map(d => ({
      viaje_pasajero_id : d.viaje_pasajero_id,
      monto             : d.monto,
      tipo              : "Devolución",
      metodo_pago_id    : d.metodo_pago_id,
      banco             : d.banco,
      fecha_pago        : hoy,
      observacion       : "Devolución automática por cancelación de viaje",
      creado_por        : user?.email || null,
    }));

  if (devoluciones.length > 0) {
    const { error } = await supabaseClient.from("pagos").insert(devoluciones);
    if (error) console.error("Error insertando devoluciones:", error);
    else console.log(`✅ ${devoluciones.length} devolución(es) registrada(s) por cancelación`);
  }
}
// ────────────────────────────────────────────────────────────────────────────

async function guardarEditarViaje() {
  const nombre  = document.getElementById("ve-nombre").value.trim();
  const salida  = document.getElementById("ve-salida").value;
  const regreso = document.getElementById("ve-regreso").value;
  const estado  = document.getElementById("ve-estado").value;
  const puntos_destino = parseInt(document.getElementById("ve-puntos").value) || 0;
  const file    = document.getElementById("ve-imagen").files[0];

  if (!nombre) { alert("El nombre es obligatorio"); return; }

  const btn = document.getElementById("btn-guardar-editar-viaje");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  let imagen_url = viajeActualData?.imagen_url || null;

  if (file) {
    try {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "CLEAR_IMAGE_CACHE",
          pathContains: `viaje_${viajeActualId}`
        });
      }
      imagen_url = await uploadViajeImage(file, `viaje_${viajeActualId}`);
    } catch (e) {
      console.error(e);
      alert("Error subiendo imagen: " + (e?.message || JSON.stringify(e)));
      if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("viajes")
    .update({ nombre, fecha_salida: salida, fecha_regreso: regreso, estado, imagen_url, puntos_destino })
    .eq("id", viajeActualId);

  if (btn) { btn.disabled = false; btn.textContent = "Guardar cambios"; }

  if (error) {
    console.error(error);
    alert("Error al guardar cambios");
    return;
  }

  // Capturar estado anterior ANTES de pisar el caché
  const estadoAnterior = viajeActualData?.estado;

  // Actualizar caché
  viajeActualData = { ...viajeActualData, nombre, fecha_salida: salida, fecha_regreso: regreso, estado, imagen_url, puntos_destino };

  // ── Lógica de cancelación automática ────────────────────────────────────
  if (estado === "cancelado" && estadoAnterior !== "cancelado") {
    await _procesarCancelacionViaje(viajeActualId);
  }
  // ────────────────────────────────────────────────────────────────────────

  navigateTo("viaje-detalle", viajeActualId);
}

function previewViajeImgEditar(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector("#view-viaje-editar .viaje-imagen-preview");
  const overlay = document.getElementById("ve-img-overlay");
  const reader  = new FileReader();
  reader.onload = (e) => {
    const prev = preview.querySelector("img");
    if (prev) prev.remove();
    const img = document.createElement("img");
    img.src = e.target.result;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ── PREVIEW IMAGEN FORMULARIO ─────────────── */
function previewViajeImg(event) {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector(".viaje-imagen-preview");
  const overlay = document.getElementById("viaje-img-overlay");
  const reader = new FileReader();
  reader.onload = (e) => {
    const prev = preview.querySelector("img");
    if (prev) prev.remove();
    const img = document.createElement("img");
    img.src = e.target.result;
    preview.appendChild(img);
    if (overlay) overlay.style.display = "none";
  };
  reader.readAsDataURL(file);
}

/* ── FAB HANDLER ──────────────────────────── */
function handleFabViajes() {
  navigateTo("viaje-nuevo");
}
function irAgregarPasajero() {
  navigateTo("viaje-pasajero-nuevo", viajeActualId);
}

function initFormPasajero(viajeId) {
  viajeActualId = parseInt(viajeId, 10);
  pasajeroSeleccionado = null;

  document.getElementById("buscar-pasajero").value = "";
  document.getElementById("input-total").value = "";
  document.getElementById("resultados-pasajero").innerHTML = "";

  // 🔑 ESTA LÍNEA TE FALTABA
  if (allPassengers.length === 0) {
    loadPassengers();
  }

  const banner   = document.getElementById("reemplazo-banner");
  const titulo   = document.getElementById("vpn-titulo");
  const desc     = document.getElementById("vpn-desc");
  const nombreEl = document.getElementById("reemplazo-nombre-origen");
  const btnGuardar = document.getElementById("btn-guardar-pasajero");

  if (reemplazoCtx.activo) {
    if (banner) banner.style.display = "block";
    if (titulo) titulo.textContent = "Reemplazar pasajero";
    if (desc) desc.textContent = "Elegí quién ocupa el lugar cedido";
    if (nombreEl) nombreEl.textContent = reemplazoCtx.nombreOrigen || "este pasajero";
    if (btnGuardar) btnGuardar.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Confirmar reemplazo`;
  } else {
    if (banner) banner.style.display = "none";
    if (titulo) titulo.textContent = "Agregar pasajero";
    if (desc) desc.textContent = "Buscá y seleccioná el pasajero a sumar al viaje";
    if (btnGuardar) btnGuardar.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      Guardar`;
  }
}

function cancelarAltaPasajero() {
  reemplazoCtx.activo = false;
  reemplazoCtx.viajePasajeroOrigenId = null;
  reemplazoCtx.nombreOrigen = null;
  navigateTo("viaje-detalle", viajeActualId);
}

function openViajeDetalle(viajeId) {
  navigateTo("viaje-detalle", parseInt(viajeId, 10));
}
async function loadViajeDetalle(viajeId) {
  viajeActualId = parseInt(viajeId, 10);

  const nombreEl = document.getElementById("detalle-viaje-nombre");
  const infoEl = document.getElementById("detalle-viaje-info");
  const listEl = document.getElementById("viaje-pasajeros-list");

  listEl.innerHTML = "Cargando...";

  // Etapa 1: viaje, lista de pasajeros y BYC no dependen entre sí → en paralelo
  const [
    { data: viaje },
    { data: pasajeros, error: errPasajeros },
    { data: bycData },
  ] = await Promise.all([
    supabaseClient
      .from("viajes")
      .select("*")
      .eq("id", viajeId)
      .single(),
    supabaseClient
      .from("viaje_pasajeros")
      .select(`
        id,
        pasajero_id,
        total_a_pagar,
        puntos_destino,
        asistencia,
        reemplaza_a,
        pasajeros ( id, Pasajero, "Documento de Identidad", Vendedor )
      `)
      .eq("viaje_id", viajeId),
    supabaseClient
      .from("basesycondiciones")
      .select("ci"),
  ]);

  if (!viaje) return;

  // ✅ AHORA SÍ existe
  viajeActualData = viaje;

  nombreEl.textContent = viaje.nombre;
  const estado = viaje.estado || "activo";

  const esAdminDetalle = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  infoEl.innerHTML = `
    <span class="viaje-pill ${estado}" style="font-size:.75rem">${estado}</span>
    ${viaje.puntos_destino ? `<span class="viaje-puntos viaje-puntos-claro" style="margin-left:.4rem">⭐ ${viaje.puntos_destino} pts base</span>` : ""}
    ${viaje.fecha_salida ? `<span style="margin-left:.4rem;font-size:.8rem;color:var(--text-muted)">📅 ${formatFecha(viaje.fecha_salida)}${viaje.fecha_regreso ? " → " + formatFecha(viaje.fecha_regreso) : ""}</span>` : ""}
  `;

  const editBtnSlot = document.getElementById("detalle-viaje-edit-btn");
  if (editBtnSlot) {
    editBtnSlot.innerHTML = esAdminDetalle ? `
      <button class="btn-editar-viaje" onclick="irEditarViaje(${viaje.id})" title="Editar viaje">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Editar
      </button>` : "";
  }

  if (errPasajeros) { console.error("Error cargando pasajeros:", errPasajeros); }

  // ── Insignia de pendientes BYC ──────────────────────────────────────────
  _bycAceptados = new Set();
  if (pasajeros && pasajeros.length > 0) {
    (bycData || []).forEach(r => {
      const norm = (r.ci || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
      if (norm) _bycAceptados.add(norm);
    });
  }
  // ───────────────────────────────────────────────────────────────────────

  // Botón agregar pasajero: visible para todos los roles (admin, worker, viewer)
  const btnAgregarEarly = document.getElementById("btn-agregar-vp");
  if (btnAgregarEarly) btnAgregarEarly.style.display = "";

  // Rol del usuario actual (se necesita para los tabs, incluso sin pasajeros)
  const esWorkerOAdminEarly = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);

  // Mostrar tabs según rol — antes del return temprano, para que
  // Egresos/Presupuesto/Resumen queden disponibles aunque el viaje
  // todavía no tenga pasajeros cargados.
  const tabEgresosEarly = document.getElementById("tab-egresos");
  if (tabEgresosEarly) tabEgresosEarly.style.display = esWorkerOAdminEarly ? "" : "none";
  const tabPresEarly = document.getElementById("tab-presupuesto");
  if (tabPresEarly) tabPresEarly.style.display = esWorkerOAdminEarly ? "" : "none";
  const tabResEarly = document.getElementById("tab-resumen");
  if (tabResEarly) tabResEarly.style.display = esWorkerOAdminEarly ? "" : "none";

  if (!pasajeros || pasajeros.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
        Sin pasajeros aún
      </div>`;
    return;
  }

  // Traer pagos por separado para calcular restante
  const vpIds = pasajeros.map(p => p.id);
  const { data: todosPagos } = await supabaseClient
    .from("pagos")
    .select("viaje_pasajero_id, monto, tipo")
    .in("viaje_pasajero_id", vpIds);

  const pagosPorVP = {};
  (todosPagos || []).forEach(pg => {
    if (!pagosPorVP[pg.viaje_pasajero_id]) pagosPorVP[pg.viaje_pasajero_id] = [];
    pagosPorVP[pg.viaje_pasajero_id].push(pg);
  });

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  // Mapa inverso: id de origen → nombre del pasajero que lo reemplazó
  const _reemplazadoPorNombre = {};
  pasajeros.forEach(p => {
    if (p.reemplaza_a) {
      const nombreCompleto = p.pasajeros?.Pasajero || "otro pasajero";
      _reemplazadoPorNombre[p.reemplaza_a] = nombreCompleto.trim().split(/\s+/)[0];
    }
  });

  // Guardar para filtrado — incluye campos pre-calculados para los filtros
  pasajerosDelViaje = pasajeros.map(p => {
    const _pgs         = pagosPorVP[p.id] || [];
    const _pagado      = _pgs.filter(pg => pg.tipo === "Pago").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _devuelto    = _pgs.filter(pg => pg.tipo === "Devolución").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _transferido = _pgs.filter(pg => pg.tipo === "Transferencia").reduce((s, pg) => s + (pg.monto || 0), 0);
    const total  = p.total_a_pagar || 0;
    const neto   = _pagado - _devuelto - _transferido;
    const esCanje = total === 0;
    const noAsiste = (p.asistencia || "Asiste") === "No asiste";
    let _pillClass;
    if (esCanje && neto > 0)       _pillClass = "excedente";
    else if (esCanje)              _pillClass = "canje";
    else if (neto > total)         _pillClass = "excedente";
    else if (total > 0 && neto >= total) _pillClass = "saldado";
    else if (noAsiste)             _pillClass = "no-asiste";
    else if (neto / (total || 1) >= 0.5) _pillClass = "parcial";
    else                           _pillClass = "deuda";

    return {
      ...p,
      _nombre    : p.pasajeros?.Pasajero || "Sin nombre",
      _vendedor  : (p.pasajeros?.Vendedor || "").trim().replace(/\s+/g, " "),
      _esMiembro : (p.puntos_destino || 0) > 0,
      _pillClass,
      _pagos     : _pgs,
      _sinByc    : (() => {
        const ciNorm = (p.pasajeros?.["Documento de Identidad"] || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
        return !ciNorm || !_bycAceptados.has(ciNorm);
      })(),
      _reemplazadoPor : _reemplazadoPorNombre[p.id] || null, // este pasajero fue cedido a otro
    };
  });

  // Botón agregar pasajero: visible para todos los roles (admin, worker, viewer)
  const btnAgregar = document.getElementById("btn-agregar-vp");
  if (btnAgregar) btnAgregar.style.display = "";

  // (Tabs Egresos/Presupuesto/Resumen ya se muestran/ocultan más arriba,
  // antes del return temprano por "sin pasajeros")

  // Limpiar buscador y filtros al cargar
  const buscador = document.getElementById("buscador-vp");
  if (buscador) buscador.value = "";
  _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "", byc: "", reservado: "" };
  const panelF = document.getElementById("filtro-panel-vp");
  if (panelF) panelF.style.display = "none";

  // Inyectar botón filtro junto al buscador (solo una vez)
  _inyectarUIFiltros();

  // Habilitar swipe horizontal entre tabs (solo una vez)
  _initSwipeTabsViaje();

  renderPasajerosViaje(pasajerosDelViaje, esAdmin, pagosPorVP);

  // Botón/caja flotante de alertas del viaje (deudas + BYC pendiente)
  _renderAlertasViaje();
}

/* ── ALERTAS DE VIAJE (deuda + BYC pendiente) ─────────────────────────── */
function _renderAlertasViaje() {
  const slot = document.getElementById("detalle-viaje-alertas-btn");
  if (!slot) return;

  const conDeuda   = pasajerosDelViaje.filter(p => p._pillClass === "deuda");
  const sinByc     = pasajerosDelViaje.filter(p => p._sinByc);
  const reservados = pasajerosDelViaje.filter(p => /reservado/i.test(p._nombre || ""));

  if (conDeuda.length === 0 && sinByc.length === 0 && reservados.length === 0) {
    slot.innerHTML = "";
    return;
  }

  const total = conDeuda.length + sinByc.length + reservados.length;

  slot.innerHTML = `
    <button class="btn-alertas-viaje" onclick="toggleAlertasPanel(event)" title="Alertas del viaje">
      ⚠️ Alertas
      <span class="alertas-badge">${total}</span>
    </button>
    <div class="alertas-panel-viaje" id="alertas-panel-viaje" style="display:none">
      ${conDeuda.length > 0 ? `
        <div class="alertas-panel-item" onclick="irAAlertaViaje('deuda')">
          <span class="alertas-panel-icon">🔴</span>
          <span>${conDeuda.length} pasajero${conDeuda.length === 1 ? "" : "s"} adeuda${conDeuda.length === 1 ? "" : "n"}</span>
        </div>` : ""}
      ${sinByc.length > 0 ? `
        <div class="alertas-panel-item" onclick="irAAlertaViaje('byc')">
          <span class="alertas-panel-icon">⚠️</span>
          <span>${sinByc.length} pasajero${sinByc.length === 1 ? "" : "s"} no ${sinByc.length === 1 ? "ha" : "han"} aceptado BYC</span>
        </div>` : ""}
      ${reservados.length > 0 ? `
        <div class="alertas-panel-item" onclick="irAAlertaViaje('reservado')">
          <span class="alertas-panel-icon">📌</span>
          <span>${reservados.length} pasajero${reservados.length === 1 ? "" : "s"} marcado${reservados.length === 1 ? "" : "s"} como reservado${reservados.length === 1 ? "" : "s"}</span>
        </div>` : ""}
    </div>`;
}

function toggleAlertasPanel(event) {
  if (event) event.stopPropagation();
  const panel = document.getElementById("alertas-panel-viaje");
  if (!panel) return;
  const abierto = panel.style.display !== "none";
  panel.style.display = abierto ? "none" : "";

  if (!abierto) {
    // Cerrar al tocar fuera del panel
    setTimeout(() => {
      document.addEventListener("click", _cerrarAlertasPanelFuera, { once: true });
    }, 0);
  }
}

function _cerrarAlertasPanelFuera(e) {
  const panel = document.getElementById("alertas-panel-viaje");
  const btn   = document.querySelector(".btn-alertas-viaje");
  if (!panel) return;
  if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
  panel.style.display = "none";
}

function irAAlertaViaje(tipo) {
  const panel = document.getElementById("alertas-panel-viaje");
  if (panel) panel.style.display = "none";

  // Asegurar que estamos en el tab de pasajeros
  switchViajeTab("pasajeros");

  // Aplicar filtro correspondiente
  _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "", byc: "", reservado: "" };
  if (tipo === "deuda") {
    _filtrosVP.pago = "deuda";
  } else if (tipo === "byc") {
    _filtrosVP.byc = "pendiente";
  } else if (tipo === "reservado") {
    _filtrosVP.reservado = "si";
  }

  const buscador = document.getElementById("buscador-vp");
  if (buscador) buscador.value = "";

  _aplicarFiltrosVP();
}

// Estado de filtros activos
let _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "", byc: "", reservado: "" };

function filtrarPasajerosViaje(q) {
  _aplicarFiltrosVP(q);
}

function _aplicarFiltrosVP(qOverride) {
  const q = (qOverride !== undefined)
    ? qOverride
    : (document.getElementById("buscador-vp")?.value || "");

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  let filtrados = pasajerosDelViaje;

  // Filtro texto
  if (q.trim()) {
    filtrados = filtrados.filter(p =>
      p._nombre.toLowerCase().includes(q.toLowerCase())
    );
  }

  // Filtro vendedor
  if (_filtrosVP.vendedor) {
    filtrados = filtrados.filter(p => p._vendedor === _filtrosVP.vendedor);
  }

  // Filtro membresía
  if (_filtrosVP.miembro === "si") {
    filtrados = filtrados.filter(p => p._esMiembro);
  } else if (_filtrosVP.miembro === "no") {
    filtrados = filtrados.filter(p => !p._esMiembro);
  }

  // Filtro asistencia
  if (_filtrosVP.asistencia) {
    filtrados = filtrados.filter(p => (p.asistencia || "Asiste") === _filtrosVP.asistencia);
  }

  // Filtro estado de pago
  if (_filtrosVP.pago) {
    filtrados = filtrados.filter(p => p._pillClass === _filtrosVP.pago);
  }

  // Filtro BYC pendiente
  if (_filtrosVP.byc === "pendiente") {
    filtrados = filtrados.filter(p => p._sinByc);
  }

  // Filtro reservados (nombre contiene "Reservado")
  if (_filtrosVP.reservado === "si") {
    filtrados = filtrados.filter(p => /reservado/i.test(p._nombre || ""));
  }

  const pagosPorVP = {};
  pasajerosDelViaje.forEach(p => { pagosPorVP[p.id] = p._pagos; });
  renderPasajerosViaje(filtrados, esAdmin, pagosPorVP);
  _actualizarBadgeFiltros();
}

function _actualizarBadgeFiltros() {
  const activos = Object.values(_filtrosVP).filter(Boolean).length;
  const badge = document.getElementById("filtro-badge");
  const btn   = document.getElementById("btn-filtro-vp");
  if (badge) {
    badge.textContent = activos;
    badge.style.display = activos > 0 ? "" : "none";
  }
  if (btn) {
    btn.classList.toggle("filtro-activo", activos > 0);
  }
}

function _inyectarUIFiltros() {
  // Envolver el buscador en un row con el botón filtro (solo si no existe aún)
  const buscadorWrap = document.querySelector("#panel-pasajeros .form-buscar-wrap");
  if (!buscadorWrap) return;

  // Si ya existe el row, no volver a inyectar
  if (document.getElementById("btn-filtro-vp")) return;

  // Crear el wrapper row
  const row = document.createElement("div");
  row.className = "buscador-filtro-row";
  buscadorWrap.parentNode.insertBefore(row, buscadorWrap);
  row.appendChild(buscadorWrap);

  // Botón de filtro
  const btn = document.createElement("button");
  btn.id = "btn-filtro-vp";
  btn.className = "btn-filtro-vp";
  btn.title = "Filtrar pasajeros";
  btn.setAttribute("onclick", "toggleFiltroPanel()");
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <line x1="4" y1="6" x2="20" y2="6"/>
      <line x1="7" y1="12" x2="17" y2="12"/>
      <line x1="10" y1="18" x2="14" y2="18"/>
    </svg>
    <span class="filtro-badge" id="filtro-badge" style="display:none">0</span>`;
  row.appendChild(btn);

  // Panel de filtros (oculto por defecto)
  const panel = document.createElement("div");
  panel.id = "filtro-panel-vp";
  panel.className = "filtro-panel-vp";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="filtro-panel-title">Filtrar pasajeros</div>
    <div class="filtro-panel-fields">
      <div class="form-field">
        <label class="form-label">Vendedor</label>
        <select id="filtro-sel-vendedor" class="form-input">
          <option value="">Todos</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Club Destino</label>
        <select id="filtro-sel-miembro" class="form-input">
          <option value="">Todos</option>
          <option value="si">⭐ Miembro</option>
          <option value="no">No miembro</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Estado de pago</label>
        <select id="filtro-sel-pago" class="form-input">
          <option value="">Todos</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Asistencia</label>
        <select id="filtro-sel-asistencia" class="form-input">
          <option value="">Todos</option>
          <option value="Asiste">✅ Asiste</option>
          <option value="No asiste">❌ No asiste</option>
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Bases y Condiciones</label>
        <select id="filtro-sel-byc" class="form-input">
          <option value="">Todos</option>
          <option value="pendiente">⚠️ No aceptó BYC</option>
        </select>
      </div>
    </div>
    <div class="filtro-panel-actions">
      <button class="btn-filtro-limpiar" onclick="limpiarFiltros()">Limpiar</button>
      <button class="btn-filtro-aplicar" onclick="aplicarFiltros()">Aplicar</button>
    </div>`;

  // Insertar panel después del row
  row.parentNode.insertBefore(panel, row.nextSibling);
}

function toggleFiltroPanel()  {
  const panel = document.getElementById("filtro-panel-vp");
  if (!panel) return;
  const abierto = panel.style.display !== "none";
  panel.style.display = abierto ? "none" : "";
  if (!abierto) _renderFiltroPanel();
}

function _renderFiltroPanel() {
  // Vendedores únicos ya normalizados
  const vendedores = [...new Set(
    pasajerosDelViaje.map(p => p._vendedor).filter(Boolean)
  )].sort();

  // Estados de pago que realmente existen en este viaje
  const pillLabels = {
    saldado: "✅ Saldado", parcial: "🟡 Parcial", deuda: "🔴 Deuda",
    canje: "🔄 Canje", excedente: "⚠️ Excedente"
  };
  const pagosPresentes = [...new Set(pasajerosDelViaje.map(p => p._pillClass))];

  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");
  const selByc   = document.getElementById("filtro-sel-byc");

  if (selVend) {
    selVend.innerHTML = `<option value="">Todos</option>` +
      vendedores.map(v => `<option value="${v}" ${_filtrosVP.vendedor === v ? "selected" : ""}>${v}</option>`).join("");
  }
  if (selMiem) selMiem.value = _filtrosVP.miembro;
  if (selPago) {
    selPago.innerHTML = `<option value="">Todos</option>` +
      Object.entries(pillLabels)
        .filter(([k]) => pagosPresentes.includes(k))
        .map(([k, label]) => `<option value="${k}" ${_filtrosVP.pago === k ? "selected" : ""}>${label}</option>`)
        .join("");
  }
  if (selAsist) selAsist.value = _filtrosVP.asistencia;
  if (selByc) selByc.value = _filtrosVP.byc;
}

function aplicarFiltros() {
  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");
  const selByc   = document.getElementById("filtro-sel-byc");
  _filtrosVP.vendedor   = selVend?.value  || "";
  _filtrosVP.miembro    = selMiem?.value  || "";
  _filtrosVP.pago       = selPago?.value  || "";
  _filtrosVP.asistencia = selAsist?.value || "";
  _filtrosVP.byc        = selByc?.value   || "";
  document.getElementById("filtro-panel-vp").style.display = "none";
  _aplicarFiltrosVP();
}

function limpiarFiltros() {
  _filtrosVP = { vendedor: "", miembro: "", pago: "", asistencia: "", byc: "", reservado: "" };
  const selVend  = document.getElementById("filtro-sel-vendedor");
  const selMiem  = document.getElementById("filtro-sel-miembro");
  const selPago  = document.getElementById("filtro-sel-pago");
  const selAsist = document.getElementById("filtro-sel-asistencia");
  const selByc   = document.getElementById("filtro-sel-byc");
  if (selVend)  selVend.value  = "";
  if (selMiem)  selMiem.value  = "";
  if (selPago)  selPago.value  = "";
  if (selAsist) selAsist.value = "";
  if (selByc)   selByc.value   = "";
  document.getElementById("filtro-panel-vp").style.display = "none";
  _aplicarFiltrosVP();
}

function renderPasajerosViaje(pasajeros, esAdmin, pagosPorVP) {
  const listEl = document.getElementById("viaje-pasajeros-list");

  // ── Contador de asistencia (siempre sobre el total real del viaje) ──
  const counterEl = document.getElementById("vp-asistencia-counter");
  if (counterEl && pasajerosDelViaje.length > 0) {
    const totalAsiste = pasajerosDelViaje.filter(p => (p.asistencia || "Asiste") === "Asiste").length;
    const total = pasajerosDelViaje.length;
    counterEl.style.display = "";
    counterEl.textContent = `${totalAsiste} de ${total} asisten`;
  } else if (counterEl) {
    counterEl.style.display = "none";
  }

  if (!pasajeros || pasajeros.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Sin resultados
      </div>`;
    return;
  }

  listEl.innerHTML = pasajeros.map(p => {
    const nombre   = p._nombre || p.pasajeros?.Pasajero || "Sin nombre";
    const nombreE  = nombre.replace(/'/g, "\\'");
    const pid      = p.pasajero_id || p.pasajeros?.id || "";
    const total    = p.total_a_pagar || 0;
    const ciNorm   = (p.pasajeros?.["Documento de Identidad"] || "").replace(/[\.\-\s]/g, "").trim().toLowerCase();
    const sinByc   = !ciNorm || !_bycAceptados.has(ciNorm);
    const esCanje  = total === 0;
    const _pgs         = pagosPorVP[p.id] || [];
    const _pagado      = _pgs.filter(pg => pg.tipo === "Pago").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _devuelto    = _pgs.filter(pg => pg.tipo === "Devolución").reduce((s, pg) => s + (pg.monto || 0), 0);
    const _transferido = _pgs.filter(pg => pg.tipo === "Transferencia").reduce((s, pg) => s + (pg.monto || 0), 0);
    const neto         = _pagado - _devuelto - _transferido;
    const excedente    = esCanje ? neto : Math.max(0, neto - total);
    const restante     = esCanje ? 0 : Math.max(0, total - neto);
    const saldado      = !esCanje && restante === 0 && total > 0;
    const hayExcedente = !esCanje && neto > total;

    const noAsiste = (p.asistencia || "Asiste") === "No asiste";

    const pct = total > 0 ? neto / total : 0;
    let pillClass, pillLabel;
    if (esCanje && neto > 0) {
      pillClass = "excedente";
      pillLabel = `⚠️ Exc. Gs. ${excedente.toLocaleString("es-PY")}`;
    } else if (esCanje) {
      pillClass = "saldado";
      pillLabel = "🔄 Canje";
    } else if (hayExcedente) {
      pillClass = "excedente";
      pillLabel = `⚠️ Exc. Gs. ${excedente.toLocaleString("es-PY")}`;
    } else if (saldado) {
      pillClass = "saldado";
      pillLabel = "✅ Saldado";
    } else {
      pillClass = pct >= 0.5 ? "parcial" : "deuda";
      pillLabel = `Gs. ${restante.toLocaleString("es-PY")}`;
    }

    return `
    <div class="viaje-pasajero-row">
      <div class="vp-info" style="cursor:pointer;flex:1;min-width:0"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">
        <div class="vp-nombre${sinByc ? " byc-pendiente" : ""}">${nombre}</div>
        ${p.reemplaza_a ? `<span class="vp-tag-reemplazo vp-tag-entrante">Reemplazo</span>` : ""}
        ${p._reemplazadoPor ? `<span class="vp-tag-reemplazo vp-tag-cedido">Cedido a ${p._reemplazadoPor}</span>` : ""}
      </div>
      <div class="vp-pills" style="cursor:pointer"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">
        ${noAsiste ? "" : `<span class="vp-pill ${pillClass}">${pillLabel}</span>`}
      </div>
      ${esAdmin ? `
      <button class="btn-editar-vp" title="Editar"
        onclick="abrirEdicionVP(event, '${p.id}', ${total}, ${p.puntos_destino || 0}, '${p.asistencia || "Asiste"}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>` : ""}
      <button class="btn-pdf-vp" title="Descargar historial de pagos"
        onclick="generarHistorialPDF(event, '${p.id}', '${nombreE}')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 18 15 15"/>
        </svg>
      </button>
      <div class="vp-chevron" style="cursor:pointer"
           onclick="abrirPagosPasajero('${p.id}', '${viajeActualId}', '${pid}', '${nombreE}')">›</div>
    </div>`;
  }).join("");
}

function abrirEdicionVP(event, vpId, total, puntos, asistencia) {
  event.stopPropagation();

  // Cerrar cualquier form abierto
  document.querySelectorAll(".vp-edit-form").forEach(el => el.remove());
  document.querySelectorAll(".btn-editar-vp.activo").forEach(el => el.classList.remove("activo"));

  const btn = event.currentTarget;
  btn.classList.add("activo");
  const row = btn.closest(".viaje-pasajero-row");

  const form = document.createElement("div");
  form.className = "vp-edit-form";
  form.innerHTML = `
    <div class="vp-edit-inner">
      <div class="vp-edit-field" style="grid-column:1/-1">
        <label class="pcf-label">Total a pagar (Gs.) <span class="req">*</span></label>
        <input type="number" id="vpe-total" class="form-input" value="${total}" min="0" />
      </div>
      <div class="vp-edit-field">
        <label class="pcf-label">Puntos destino</label>
        <input type="number" id="vpe-puntos" class="form-input" value="${puntos}" min="0" />
      </div>
      <div class="vp-edit-field">
        <label class="pcf-label">Asistencia</label>
        <select id="vpe-asistencia" class="form-input">
          <option value="Asiste" ${asistencia === "Asiste" ? "selected" : ""}>Asiste</option>
          <option value="No asiste" ${asistencia === "No asiste" ? "selected" : ""}>No asiste</option>
        </select>
      </div>
      <div class="vp-edit-actions">
        <button class="btn-cancel" onclick="cerrarEdicionVP()">Cancelar</button>
        <button class="btn-save" onclick="guardarEdicionVP('${vpId}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Guardar
        </button>
      </div>
    </div>`;

  row.after(form);
}

function cerrarEdicionVP() {
  document.querySelectorAll(".vp-edit-form").forEach(el => el.remove());
  document.querySelectorAll(".btn-editar-vp.activo").forEach(el => el.classList.remove("activo"));
}

async function guardarEdicionVP(vpId) {
  const total      = parseInt(document.getElementById("vpe-total").value);
  const puntosInput = parseInt(document.getElementById("vpe-puntos").value) || 0;
  const asistencia = document.getElementById("vpe-asistencia").value;

  if (total == null || isNaN(total) || total < 0) {
    document.getElementById("vpe-total").classList.add("error");
    return;
  }

  const btn = document.querySelector(".vp-edit-form .btn-save");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  // Si No asiste, puntos siempre 0. Si Asiste, respetar el valor manual del input.
  const puntosAsignar = asistencia === "No asiste" ? 0 : puntosInput;

  const { error } = await supabaseClient
    .from("viaje_pasajeros")
    .update({ total_a_pagar: total, puntos_destino: puntosAsignar, asistencia })
    .eq("id", vpId);

  btn.disabled = false;
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;

  if (error) {
    alert("Error al guardar. Intentá de nuevo.");
    return;
  }

  cerrarEdicionVP();
  loadViajeDetalle(viajeActualId);
}
async function guardarPasajeroEnViaje() {
  try {
    if (!viajeActualId) {
      showToast("Error: no hay viaje seleccionado", "error");
      return;
    }

    if (!pasajeroSeleccionado) {
      showToast("Seleccioná un pasajero", "warning");
      return;
    }

    const total = parseInt(document.getElementById("input-total").value);

    if (total == null || isNaN(total) || total < 0) {
      showToast("Ingresá un monto válido", "warning");
      return;
    }

    // ── Modo reemplazo: delega todo al RPC atómico ──
    if (reemplazoCtx.activo) {
      await confirmarReemplazoPasajero(total);
      return;
    }

    console.log("Guardando...", {
      viaje_id: viajeActualId,
      pasajero_id: pasajeroSeleccionado.id,
      total
    });

// ✅ CORRECTO
const { data: { user } } = await supabaseClient.auth.getUser();

// Verificar si el pasajero ya es miembro Club Destino (≥2 viajes previos con Asiste)
const { data: viajesPrevios } = await supabaseClient
  .from("viaje_pasajeros")
  .select("id")
  .eq("pasajero_id", pasajeroSeleccionado.id)
  .eq("asistencia", "Asiste");

const viajesCount = (viajesPrevios || []).length; // Este nuevo será el siguiente
const esMiembro   = viajesCount >= 2; // Con este nuevo viaje llega a 3+

// Obtener puntos base del viaje actual
const { data: viajeData } = await supabaseClient
  .from("viajes")
  .select("puntos_destino")
  .eq("id", viajeActualId)
  .single();

const puntosViaje = viajeData?.puntos_destino || 0;
const puntosAsignar = esMiembro ? puntosViaje : 0;

const { error } = await supabaseClient
  .from("viaje_pasajeros")
  .insert([{
    viaje_id: viajeActualId,
    pasajero_id: pasajeroSeleccionado.id,
    total_a_pagar: total,
    asistencia: "Asiste",
    puntos_destino: puntosAsignar,
    creado_por: user.email
  }]);

    if (error) {
      console.error("ERROR SUPABASE:", error);
      showToast("Error al guardar en base de datos", "error");
      return;
    }

    showToast("✅ Pasajero agregado correctamente", "success");

    navigateTo("viaje-detalle", viajeActualId);
  } catch (e) {
    console.error("ERROR GENERAL:", e);
    showToast("Error inesperado", "error");
  }
}

/* ── Confirmar reemplazo de pasajero (modo reemplazo) ──
   Llama al RPC reemplazar_pasajero(), que hace todo en
   una transacción: marca "No asiste" al origen, inserta
   el nuevo con reemplaza_a, y transfiere la seña si se
   pidió. El trigger de notificación se dispara solo, del
   lado de la base, sobre el INSERT resultante. */
async function confirmarReemplazoPasajero(total) {
  const btnGuardar = document.getElementById("btn-guardar-pasajero");
  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = "Procesando…"; }

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const transferirSena = document.getElementById("reemplazo-transferir-sena")?.checked ?? true;

    const { data: nuevoVpId, error } = await supabaseClient.rpc("reemplazar_pasajero", {
      p_viaje_pasajero_origen_id: reemplazoCtx.viajePasajeroOrigenId,
      p_pasajero_nuevo_id: pasajeroSeleccionado.id,
      p_total_a_pagar: total,
      p_transferir_sena: transferirSena,
      p_creado_por: user.email,
    });

    if (error) {
      console.error("ERROR RPC reemplazar_pasajero:", error);
      showToast(error.message || "Error al reemplazar pasajero", "error");
      return;
    }

    showToast("✅ Pasajero reemplazado correctamente", "success");

    reemplazoCtx.activo = false;
    reemplazoCtx.viajePasajeroOrigenId = null;
    reemplazoCtx.nombreOrigen = null;

    navigateTo("viaje-detalle", viajeActualId);
  } catch (e) {
    console.error("ERROR GENERAL reemplazo:", e);
    showToast("Error inesperado al reemplazar", "error");
  } finally {
    if (btnGuardar) {
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Confirmar reemplazo`;
    }
  }
}
function buscarPasajero() {
  const q = document.getElementById("buscar-pasajero").value.toLowerCase().trim();
  const cont = document.getElementById("resultados-pasajero");

  if (!q) {
    cont.innerHTML = "";
    pasajeroSeleccionado = null;
    return;
  }

  const resultados = allPassengers.filter(p =>
    (p.Pasajero || "").toLowerCase().includes(q) ||
    (p["Documento de Identidad"] || "").toLowerCase().includes(q)
  );

  if (resultados.length === 0) {
    cont.innerHTML = `
      <div class="pasajero-crear-wrap">
        <div class="pasajero-crear-msg">Sin resultados para "<strong>${q}</strong>"</div>
        <div class="pasajero-item pasajero-item-nuevo" onclick="mostrarFormCrearPasajero('${q.trim()}')">
          <div class="pasajero-item-nuevo-inner">
            <span class="pasajero-crear-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </span>
            <div>
              <strong>Crear "${q.trim()}"</strong>
              <div class="ci">Se agregará a la base de clientes</div>
            </div>
          </div>
        </div>
      </div>`;
    return;
  }

  cont.innerHTML = resultados.map(p => `
    <div class="pasajero-item" onclick="seleccionarPasajero(${p._idx})">
      <div class="pasajero-item-inner">
        <div>
          <strong>${p.Pasajero}</strong>
          <div class="ci">CI: ${p["Documento de Identidad"] || "—"}</div>
        </div>
        <span class="pasajero-select-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </span>
      </div>
    </div>
  `).join("");
}
function seleccionarPasajero(idx) {
  const p = allPassengers.find(x => x._idx === idx);
  if (!p) return;

  pasajeroSeleccionado = p;

  document.getElementById("buscar-pasajero").value = p.Pasajero;

  document.getElementById("resultados-pasajero").innerHTML = `
    <div class="pasajero-seleccionado">
      ✅ ${p.Pasajero} (CI ${p["Documento de Identidad"]})
    </div>
  `;
}
async function mostrarFormCrearPasajero(nombre) {
  const cont = document.getElementById("resultados-pasajero");

  // Cargar vendedores desde caché global
  const vendedoresData = await getVendedores();

  const optsVendedor = vendedoresData
    .map(v => `<option value="${v.Nombre_del_vendedor}">${v.Nombre_del_vendedor}</option>`)
    .join("");

  cont.innerHTML = `
    <div class="pasajero-crear-form">
      <div class="pasajero-crear-form-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nuevo cliente
      </div>

      <div class="pcf-field">
        <label class="pcf-label">Nombre completo <span class="req">*</span></label>
        <input id="pcf-nombre" class="form-input" type="text" value="${nombre}" placeholder="Nombre completo" />
      </div>

      <div class="pcf-row">
        <div class="pcf-field">
          <label class="pcf-label">Sexo <span class="req">*</span></label>
          <select id="pcf-sexo" class="form-input">
            <option value="">— Seleccionar —</option>
            <option value="Masculino">Masculino</option>
            <option value="Femenino">Femenino</option>
            <option value="Otro">Otro</option>
          </select>
        </div>
        <div class="pcf-field">
          <label class="pcf-label">Vendedor <span class="req">*</span></label>
          <select id="pcf-vendedor" class="form-input">
            <option value="">— Seleccionar —</option>
            ${optsVendedor}
          </select>
        </div>
      </div>

      <div class="pcf-actions">
        <button class="btn-cancel pcf-btn-cancel" onclick="document.getElementById('resultados-pasajero').innerHTML=''">
          Cancelar
        </button>
        <button class="btn-save pcf-btn-save" onclick="confirmarCrearPasajero()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          Guardar
        </button>
      </div>
    </div>
  `;
}

async function confirmarCrearPasajero() {
  const nombreInput   = document.getElementById("pcf-nombre");
  const sexoInput     = document.getElementById("pcf-sexo");
  const vendedorInput = document.getElementById("pcf-vendedor");

  const nombre   = capitalizarNombre(nombreInput?.value.trim());
  const sexo     = sexoInput?.value || null;
  const vendedor = vendedorInput?.value || null;
  const cont     = document.getElementById("resultados-pasajero");

  // Limpiar errores previos
  nombreInput?.classList.remove("error");
  sexoInput?.classList.remove("error");
  vendedorInput?.classList.remove("error");

  // Validación: nombre, sexo y vendedor son obligatorios
  let hayError = false;
  if (!nombre) {
    nombreInput?.classList.add("error");
    hayError = true;
  }
  if (!sexo) {
    sexoInput?.classList.add("error");
    hayError = true;
  }
  if (!vendedor) {
    vendedorInput?.classList.add("error");
    hayError = true;
  }

  if (hayError) {
    let errEl = cont.querySelector(".pcf-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "pcf-error";
      cont.querySelector(".pasajero-crear-form").appendChild(errEl);
    }
    errEl.textContent = "Nombre, sexo y vendedor son obligatorios.";
    return;
  }

  const saveBtn = cont.querySelector(".pcf-btn-save");
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Guardando…"; }

  const { data, error } = await supabaseClient
    .from("pasajeros")
    .insert([{ Pasajero: nombre, Sexo: sexo, Vendedor: vendedor }])
    .select()
    .single();

  if (error) {
    console.error("Error creando pasajero:", error);
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
    }
    let errEl = cont.querySelector(".pcf-error");
    if (!errEl) {
      errEl = document.createElement("div");
      errEl.className = "pcf-error";
      cont.querySelector(".pasajero-crear-form").appendChild(errEl);
    }
    errEl.textContent = "Error al guardar. Intentá de nuevo.";
    return;
  }

  const nuevoIdx = allPassengers.length;
  const nuevoPasajero = { ...data, _idx: nuevoIdx };
  allPassengers.push(nuevoPasajero);

  pasajeroSeleccionado = nuevoPasajero;
  document.getElementById("buscar-pasajero").value = nombre;
  cont.innerHTML = `
    <div class="pasajero-seleccionado">
      ✅ ${nombre} <span style="font-weight:400;opacity:.7">(nuevo cliente agregado)</span>
    </div>
  `;
}

function capitalizarNombre(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}

/* ── TABS VIAJE DETALLE ────────────────────── */
function switchViajeTab(tab) {
  // Redirigir viewer si intenta acceder a tabs restringidos
  const _esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);
  if (!_esWorkerOAdmin && (tab === "egresos" || tab === "presupuesto" || tab === "resumen")) {
    tab = "pasajeros";
  }

  // Botones
  document.getElementById("tab-pasajeros").classList.toggle("active", tab === "pasajeros");
  document.getElementById("tab-egresos").classList.toggle("active", tab === "egresos");
  const tabPres = document.getElementById("tab-presupuesto");
  if (tabPres) tabPres.classList.toggle("active", tab === "presupuesto");
  const tabRes = document.getElementById("tab-resumen");
  if (tabRes) tabRes.classList.toggle("active", tab === "resumen");

  // Paneles
  document.getElementById("panel-pasajeros").style.display   = tab === "pasajeros"   ? "" : "none";
  document.getElementById("panel-egresos").style.display     = tab === "egresos"     ? "" : "none";
  const panelPres = document.getElementById("panel-presupuesto");
  if (panelPres) panelPres.style.display = tab === "presupuesto" ? "" : "none";
  const panelRes = document.getElementById("panel-resumen");
  if (panelRes) panelRes.style.display = tab === "resumen" ? "" : "none";

  if (tab === "egresos")     loadEgresos(viajeActualId);
  if (tab === "presupuesto") loadPresupuesto(viajeActualId);
  if (tab === "resumen")     loadResumen(viajeActualId);
}

/* ── SWIPE HORIZONTAL ENTRE TABS (desde las cards) ─── */
let _swipeTabsInit = false;
function _initSwipeTabsViaje() {
  if (_swipeTabsInit) return;
  _swipeTabsInit = true;

  const wrap = document.getElementById("viaje-tab-panels");
  if (!wrap) return;

  let startX = 0, startY = 0, tracking = false, isHorizontal = false;
  const UMBRAL_DIRECCION = 10; // px para decidir si el gesto es horizontal
  const UMBRAL_CAMBIO    = 50; // px para considerar que se quiso cambiar de tab

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
    // Si el gesto es horizontal, evitamos que el navegador haga scroll vertical
    if (isHorizontal) e.preventDefault();
  }, { passive: false });

  wrap.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    if (!isHorizontal) return;

    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) < UMBRAL_CAMBIO) return;

    // Deslizar hacia la izquierda → siguiente tab. Hacia la derecha → tab anterior.
    _cambiarTabViajePorSwipe(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function _cambiarTabViajePorSwipe(direccion) {
  const ordenTabs = ["pasajeros", "egresos", "presupuesto", "resumen"];

  // Solo se consideran las tabs visibles según el rol del usuario
  const visibles = ordenTabs.filter(t => {
    const btn = document.getElementById("tab-" + t);
    return btn && btn.style.display !== "none";
  });

  const actual = visibles.find(t => document.getElementById("tab-" + t).classList.contains("active"));
  let idx = visibles.indexOf(actual);
  if (idx === -1) idx = 0;

  idx += direccion;
  if (idx < 0 || idx >= visibles.length) return; // ya está en el extremo

  switchViajeTab(visibles[idx]);

  // Asegura que el tab activo quede visible dentro del scroll de tabs
  const tabBtn = document.getElementById("tab-" + visibles[idx]);
  if (tabBtn && tabBtn.scrollIntoView) {
    tabBtn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }
}

/* ── EGRESOS ───────────────────────────────── */

// Caché para los selects del form
let _egresosCategorias = [];
let _egresosMetodos    = [];

async function loadEgresos(viajeId) {
  const listEl = document.getElementById("egresos-list");
  const btnAdd = document.getElementById("btn-agregar-egreso");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin", "worker"].includes(r))
    : ["admin", "worker"].includes(currentUserRole);

  if (btnAdd) btnAdd.style.display = esWorkerOAdmin ? "" : "none";

  // Query principal de egresos
  const { data, error } = await supabaseClient
    .from("egresos")
    .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente")
    .eq("viaje_id", viajeId)
    .order("fecha", { ascending: false });

  if (error) {
    console.error("Error cargando egresos:", error);
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar egresos</div>`;
    return;
  }

  // Traer nombres de categorías (sin cache) y métodos desde cache global
  const [{ data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);
  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

  if (!data || data.length === 0) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
        Sin egresos registrados
      </div>`;
    return;
  }

  const totalEgresos = data.reduce((s, e) => s + (e.monto || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row">
      <span class="egresos-total-label">Total egresos</span>
      <span class="egresos-total-valor">Gs. ${totalEgresos.toLocaleString("es-PY")}</span>
    </div>
    ${data.map(e => {
      const categoria = catMap[e.categoria_id] || "Sin categoría";
      const caja      = metMap[e.caja_saliente] || "—";
      const fecha     = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
      return `
  <div class="egreso-row" style="cursor:pointer"
       onclick="abrirEgresoDetalle('${e.id}', '${viajeId}')">
    <div class="egreso-info">
      <div class="egreso-concepto">${categoria}</div>
      <div class="egreso-fecha">${fecha}${e.ejecutor ? " · " + e.ejecutor : ""}</div>
    </div>
    <div style="display:flex;align-items:center;gap:.5rem">
      <div class="egreso-monto">Gs. ${(e.monto || 0).toLocaleString("es-PY")}</div>
      <span style="color:var(--text-muted);font-size:1.1rem">›</span>
    </div>
  </div>
`;    }).join("")}
  `;

  // Mover botón "Registrar egreso" justo después del total-row
  if (btnAdd) {
    const totalRow = listEl.querySelector(".egresos-total-row");
    if (totalRow) {
      btnAdd.style.marginTop = ".5rem";
      btnAdd.style.marginBottom = ".5rem";
      totalRow.after(btnAdd);
    }
  }
}

async function _cargarOpcionesFormEgreso() {
  // Categorías: solo las presupuestadas para este viaje + exclusivas del viaje
  // Siempre re-consultamos (el caché se invalida en mostrarFormEgreso)
  const [
    { data: presupuestadas },
    { data: exclusivas }
  ] = await Promise.all([
    // Categorías con presupuesto en este viaje (join con presupuesto_viaje)
    supabaseClient
      .from("presupuesto_viaje")
      .select("categoria_id, categorias(id, nombre, scope)")
      .eq("viaje_id", parseInt(viajeActualId)),
    // Categorías exclusivas del viaje (scope = viajeActualId), aunque no estén presupuestadas
    supabaseClient
      .from("categorias")
      .select("id, nombre, scope")
      .eq("scope", parseInt(viajeActualId))
      .order("nombre", { ascending: true })
  ]);

  // Armar lista deduplicada
  const vistos = new Set();
  _egresosCategorias = [];

  (presupuestadas || []).forEach(row => {
    const c = row.categorias;
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });
  (exclusivas || []).forEach(c => {
    if (c && !vistos.has(c.id)) {
      vistos.add(c.id);
      _egresosCategorias.push(c);
    }
  });

  // Ordenar alfabéticamente
  _egresosCategorias.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  // Métodos de pago (caja saliente) — desde caché global
  const metodosList = await getMetodosPago();
  _egresosMetodos = metodosList;

  const selCat = document.getElementById("egreso-categoria");
  const selCaja = document.getElementById("egreso-caja");

  if (selCat) {
    const opcionesCats = _egresosCategorias.length > 0
      ? _egresosCategorias.map(c => {
          const label = c.scope ? `${c.nombre} (exclusiva)` : c.nombre;
          return `<option value="${c.id}">${label}</option>`;
        }).join("")
      : "";

    selCat.innerHTML =
      `<option value="">— Seleccionar categoría —</option>` +
      opcionesCats +
      `<option value="__nuevo__">+ Otro tipo…</option>`;

    // Mostrar/ocultar input de nueva categoría al cambiar
    selCat.onchange = () => _toggleNuevaCategoriaInput(selCat.value === "__nuevo__");
  }

  if (selCaja) {
    selCaja.innerHTML = `<option value="">— Seleccionar caja —</option>` +
      _egresosMetodos.map(m => `<option value="${m.id}">${m.metodo_de_pago}</option>`).join("");
  }

  // Inicializar custom selects (idempotente: se refresca si ya existe)
  initCustomSelect("egreso-categoria");
  initCustomSelect("egreso-caja");
}

function _toggleNuevaCategoriaInput(mostrar) {
  let wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (mostrar) {
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "egreso-nueva-cat-wrap";
      wrap.style.cssText = "margin-top:.5rem";
      wrap.innerHTML = `
        <input id="egreso-nueva-cat-nombre" class="form-input"
               type="text" placeholder="Nombre del nuevo tipo de egreso" />
      `;
      document.getElementById("egreso-categoria").after(wrap);
    }
    wrap.style.display = "";
    document.getElementById("egreso-nueva-cat-nombre")?.focus();
  } else if (wrap) {
    wrap.style.display = "none";
  }
}

async function mostrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (!form) return;

  // Fecha de hoy por defecto
  const fechaEl = document.getElementById("egreso-fecha");
  if (fechaEl && !fechaEl.value) {
    fechaEl.value = new Date().toISOString().split("T")[0];
  }

  form.style.display = "";
  if (btn) btn.style.display = "none";

  // Invalidar caché si cambiamos de viaje
  _egresosCategorias = [];
  await _cargarOpcionesFormEgreso();
}

function cerrarFormEgreso() {
  const form = document.getElementById("form-nuevo-egreso");
  const btn  = document.getElementById("btn-agregar-egreso");
  if (form) form.style.display = "none";
  if (btn) {
    const esWorkerOAdmin = Array.isArray(currentUserRole)
      ? currentUserRole.some(r => ["admin", "worker"].includes(r))
      : ["admin", "worker"].includes(currentUserRole);
    btn.style.display = esWorkerOAdmin ? "" : "none";
  }

  ["egreso-categoria", "egreso-monto", "egreso-fecha", "egreso-descripcion", "egreso-ejecutor", "egreso-caja", "egreso-archivo"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Limpiar input de nueva categoría si quedó visible
  const wrap = document.getElementById("egreso-nueva-cat-wrap");
  if (wrap) wrap.remove();
}

async function guardarEgreso() {
  let categoriaSelVal = document.getElementById("egreso-categoria")?.value;
  const monto        = parseInt(document.getElementById("egreso-monto")?.value);
  const fecha        = document.getElementById("egreso-fecha")?.value || null;
  const descripcion  = document.getElementById("egreso-descripcion")?.value.trim() || null;
  const ejecutor     = document.getElementById("egreso-ejecutor")?.value.trim();
  const cajaId       = document.getElementById("egreso-caja")?.value;
  const archivo      = document.getElementById("egreso-archivo")?.files[0];
  const nuevaCatNombre = document.getElementById("egreso-nueva-cat-nombre")?.value.trim();

  // Validaciones
  let valido = true;
  if (!categoriaSelVal) {
    document.getElementById("egreso-categoria")?.classList.add("error");
    valido = false;
  }
  if (categoriaSelVal === "__nuevo__" && !nuevaCatNombre) {
    document.getElementById("egreso-nueva-cat-nombre")?.classList.add("error");
    valido = false;
  }
  if (!monto || monto <= 0) {
    document.getElementById("egreso-monto")?.classList.add("error");
    valido = false;
  }
  if (!fecha) {
    document.getElementById("egreso-fecha")?.classList.add("error");
    valido = false;
  }
  if (!ejecutor) {
    document.getElementById("egreso-ejecutor")?.classList.add("error");
    valido = false;
  }
  if (!cajaId) {
    document.getElementById("egreso-caja")?.classList.add("error");
    valido = false;
  }
  if (!valido) return;

  const btn = document.getElementById("btn-guardar-egreso");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  // Si eligió "+ Otro tipo…", crear la categoría exclusiva del viaje primero
  let categoriaId = categoriaSelVal;
  if (categoriaSelVal === "__nuevo__") {
    const { data: nuevaCat, error: errCat } = await supabaseClient
      .from("categorias")
      .insert([{ nombre: nuevaCatNombre, scope: parseInt(viajeActualId) }])
      .select("id")
      .single();

    if (errCat || !nuevaCat) {
      console.error("Error creando categoría:", errCat);
      alert("Error al crear el tipo de egreso. Intentá de nuevo.");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
    categoriaId = nuevaCat.id;
    // Invalidar caché de categorías para que la próxima apertura del form la muestre
    _egresosCategorias = [];
  }

  const { data: { user } } = await supabaseClient.auth.getUser();

  let comprobante_url = null;

  if (archivo) {
    try {
      comprobante_url = await uploadEgresoFile(archivo);
    } catch (e) {
      console.error(e);
      alert("Error subiendo comprobante");
      if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`; }
      return;
    }
  }

  const { error } = await supabaseClient
    .from("egresos")
    .insert([{
      viaje_id: viajeActualId,
      categoria_id: categoriaId,
      monto,
      descripcion,
      fecha,
      ejecutor,
      caja_saliente: cajaId,
      comprobante_nro: comprobante_url,
      creado_por: user?.email || null
    }]);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando egreso:", error);
    alert("Error al guardar el egreso. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormEgreso();
  loadEgresos(viajeActualId);
}

/* ── EGRESO DETALLE ────────────────────────── */

function abrirEgresoDetalle(egresoId, viajeId) {
  navigateTo("egreso-detalle", { egresoId, viajeId });
}

async function initEgresoDetalleView({ egresoId, viajeId }) {
  const cont = document.getElementById("egreso-detalle-cont");
  if (!cont) return;

  cont.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;

  // Query egreso + categorías + métodos en paralelo
  const [{ data: e, error }, { data: catData }, metDataRaw] = await Promise.all([
    supabaseClient.from("egresos")
      .select("id, monto, descripcion, fecha, ejecutor, creado_por, categoria_id, caja_saliente, comprobante_nro")
      .eq("id", egresoId)
      .single(),
    supabaseClient.from("categorias").select("id, nombre"),
    getMetodosPago()
  ]);

  if (error || !e) {
    cont.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar el egreso.</div>`;
    return;
  }

  const catMap = Object.fromEntries((catData || []).map(c => [c.id, c.nombre]));
  const metMap = Object.fromEntries(metDataRaw.map(m => [m.id, m.metodo_de_pago]));

  const categoria  = catMap[e.categoria_id] || "Sin categoría";
  const caja       = metMap[e.caja_saliente] || "—";
  const fecha      = e.fecha ? e.fecha.split("T")[0].split("-").reverse().join("/") : "—";
  const monto      = (e.monto || 0).toLocaleString("es-PY");
  const descripcion = e.descripcion || "—";
  const ejecutor   = e.ejecutor || "—";
  const creadoPor  = e.creado_por || "—";

  const comprobanteHtml = e.comprobante_nro
    ? `<a href="${e.comprobante_nro}" target="_blank" class="egreso-det-comprobante">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Ver comprobante
      </a>`
    : `<span class="egreso-det-sin-comprobante">Sin comprobante adjunto</span>`;

  cont.innerHTML = `
    <div class="egreso-det-monto-hero">
      <span class="egreso-det-monto-label">Monto</span>
      <span class="egreso-det-monto-valor">Gs. ${monto}</span>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Información
      </div>
      <div class="egreso-det-grid">
        <div class="egreso-det-field">
          <span class="egreso-det-label">Categoría</span>
          <span class="egreso-det-value">${categoria}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Fecha</span>
          <span class="egreso-det-value">${fecha}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Caja saliente</span>
          <span class="egreso-det-value">${caja}</span>
        </div>
        <div class="egreso-det-field">
          <span class="egreso-det-label">Ejecutor</span>
          <span class="egreso-det-value">${ejecutor}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Descripción</span>
          <span class="egreso-det-value">${descripcion}</span>
        </div>
        <div class="egreso-det-field full">
          <span class="egreso-det-label">Registrado por</span>
          <span class="egreso-det-value">${creadoPor}</span>
        </div>
      </div>
    </div>

    <div class="detalle-section">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        Comprobante
      </div>
      ${comprobanteHtml}
    </div>
  `;
}

/* ── PRESUPUESTO ───────────────────────────── */

let _presupuestoCategorias = [];   // caché de categorías globales
let _presupuestoOriginal   = {};   // { categoria_id: monto } al cargar para detectar cambios
let _presupuestoModoEdicion = false;

async function loadPresupuesto(viajeId) {
  const listEl  = document.getElementById("presupuesto-list");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const formEl  = document.getElementById("form-presupuesto");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
  if (formEl)  formEl.style.display  = "none";

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  // Traer presupuesto guardado + categorías en paralelo
  const [{ data: filas, error }, { data: globales }, { data: locales }] = await Promise.all([
    supabaseClient
      .from("presupuesto_viaje")
      .select("id, categoria_id, monto_presupuestado")
      .eq("viaje_id", viajeId),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true }),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .eq("scope", parseInt(viajeId))
      .order("nombre", { ascending: true })
  ]);

  if (error) {
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar presupuesto.</div>`;
    return;
  }

  _presupuestoCategorias = [...(globales || []), ...(locales || [])];

  const hayPresupuesto = filas && filas.length > 0;

  if (!hayPresupuesto) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Sin presupuesto registrado
      </div>`;
    if (btnReg && esWorkerOAdmin) btnReg.style.display = "";
    return;
  }

  // Hay presupuesto — construir mapa para renderizar
  const catMap = Object.fromEntries(_presupuestoCategorias.map(c => [c.id, c.nombre]));
  _presupuestoOriginal = {};
  filas.forEach(f => { _presupuestoOriginal[f.categoria_id] = f.monto_presupuestado; });

  const total = filas.reduce((s, f) => s + (f.monto_presupuestado || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row" style="margin-bottom:.85rem">
      <span class="egresos-total-label">Total presupuestado</span>
      <span class="egresos-total-valor">Gs. ${total.toLocaleString("es-PY")}</span>
    </div>
    ${filas.map(f => `
    <div class="egreso-row">
      <div class="egreso-info">
        <div class="egreso-concepto">${catMap[f.categoria_id] || "—"}</div>
      </div>
      <div class="egreso-monto" style="color:var(--accent)">
        Gs. ${(f.monto_presupuestado || 0).toLocaleString("es-PY")}
      </div>
    </div>`).join("")}
  `;

  if (btnEdit && esAdmin) btnEdit.style.display = "";
}

function confirmarEditarPresupuesto() {
  const advertencia = document.getElementById("presupuesto-advertencia");
  if (advertencia) {
    advertencia.remove();
    mostrarFormPresupuesto(true);
    return;
  }

  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const warn = document.createElement("div");
  warn.id = "presupuesto-advertencia";
  warn.className = "presupuesto-advertencia";
  warn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    Estás por editar un presupuesto ya registrado. Los cambios reemplazarán los valores actuales.
    <div class="presupuesto-adv-actions">
      <button class="btn-cancel" onclick="this.closest('#presupuesto-advertencia').remove()">Cancelar</button>
      <button class="btn-save" onclick="this.closest('#presupuesto-advertencia').remove(); mostrarFormPresupuesto(true)">Continuar</button>
    </div>
  `;
  if (btnEdit) btnEdit.after(warn);
}

async function mostrarFormPresupuesto(esEdicion) {
  _presupuestoModoEdicion = esEdicion;

  const formEl    = document.getElementById("form-presupuesto");
  const fieldsEl  = document.getElementById("presupuesto-form-fields");
  const btnReg    = document.getElementById("btn-registrar-presupuesto");
  const btnEdit   = document.getElementById("btn-editar-presupuesto");
  if (!formEl || !fieldsEl) return;

  // Cargar categorías si no están en caché
  if (_presupuestoCategorias.length === 0) {
    const { data } = await supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true });
    _presupuestoCategorias = data || [];
  }

  fieldsEl.innerHTML = `
    <p class="presupuesto-form-hint">Completá los montos por categoría. Las categorías sin monto serán ignoradas.</p>
    <div class="detail-grid">
      ${_presupuestoCategorias.map(c => {
        const valorPrevio = _presupuestoOriginal[c.id] || "";
        return `
        <div class="form-field">
          <label class="form-label">${c.nombre}</label>
          <input type="number" class="form-input presupuesto-input"
                 data-cat-id="${c.id}" min="0" placeholder="0"
                 value="${valorPrevio}" />
        </div>`;
      }).join("")}
    </div>`;

  formEl.style.display = "";
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
}

function cerrarFormPresupuesto() {
  const formEl  = document.getElementById("form-presupuesto");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const advertencia = document.getElementById("presupuesto-advertencia");

  if (formEl)       formEl.style.display  = "none";
  if (advertencia)  advertencia.remove();

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  const hayPresupuesto = Object.keys(_presupuestoOriginal).length > 0;
  if (btnReg)  btnReg.style.display  = (!hayPresupuesto && esWorkerOAdmin) ? "" : "none";
  if (btnEdit) btnEdit.style.display = (hayPresupuesto && esAdmin) ? "" : "none";
}

async function guardarPresupuesto() {
  const inputs = document.querySelectorAll(".presupuesto-input");
  const btn    = document.getElementById("btn-guardar-presupuesto");

  // Construir filas a upsert: solo las que tienen monto > 0
  const filas = [];
  inputs.forEach(input => {
    const catId = parseInt(input.dataset.catId);
    const monto = parseInt(input.value) || 0;
    if (monto > 0) {
      filas.push({
        viaje_id:            viajeActualId,
        categoria_id:        catId,
        monto_presupuestado: monto
      });
    }
  });

  if (filas.length === 0) {
    inputs[0]?.classList.add("error");
    return;
  }

  // En modo edición: detectar cambios y solo upsert los que cambiaron
  let filasAGuardar = filas;
  if (_presupuestoModoEdicion) {
    filasAGuardar = filas.filter(f => {
      const original = _presupuestoOriginal[f.categoria_id];
      return !original || original !== f.monto_presupuestado;
    });

    // Categorías que tenían monto y ahora quedaron vacías → eliminar
    const catIdsNuevos = new Set(filas.map(f => f.categoria_id));
    const aEliminar = Object.keys(_presupuestoOriginal).filter(id => !catIdsNuevos.has(id));
    if (aEliminar.length > 0) {
      await supabaseClient
        .from("presupuesto_viaje")
        .delete()
        .eq("viaje_id", viajeActualId)
        .in("categoria_id", aEliminar);
    }

    if (filasAGuardar.length === 0) {
      cerrarFormPresupuesto();
      loadPresupuesto(viajeActualId);
      return;
    }
  }

  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("presupuesto_viaje")
    .upsert(filasAGuardar, { onConflict: "viaje_id,categoria_id" });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando presupuesto:", error);
    alert("Error al guardar. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormPresupuesto();
  loadPresupuesto(viajeActualId);
}

async function agregarCatExtra() {
  const input = document.getElementById("input-cat-extra");
  if (!input) return;

  const nombre = input.value.trim();
  if (!nombre) {
    input.classList.add("error");
    input.focus();
    return;
  }
  input.classList.remove("error");

  // Deshabilitar el botón mientras se guarda
  const btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = "Agregando…"; }

  // Insertar categoría local (scope = viajeActualId)
  const { data: nueva, error } = await supabaseClient
    .from("categorias")
    .insert([{ nombre, scope: viajeActualId }])
    .select("id, nombre")
    .single();

  if (btn) { btn.disabled = false; btn.textContent = "+ Agregar"; }

  if (error) {
    console.error("Error al crear categoría extra:", JSON.stringify(error));
    alert("Error: " + (error.message || error.details || JSON.stringify(error)));
    return;
  }

  // Agregar al caché local
  _presupuestoCategorias.push(nueva);

  // Agregar el campo al grid del formulario
  const grid = document.querySelector("#presupuesto-form-fields .detail-grid");
  if (grid) {
    const div = document.createElement("div");
    div.className = "form-field";
    div.innerHTML = `
      <label class="form-label">${nueva.nombre}</label>
      <input type="number" class="form-input presupuesto-input"
             data-cat-id="${nueva.id}" min="0" placeholder="0" value="" />`;
    grid.appendChild(div);
  }

  // Limpiar el input y enfocar el nuevo campo
  input.value = "";
  const nuevoInput = document.querySelector(`.presupuesto-input[data-cat-id="${nueva.id}"]`);
  if (nuevoInput) nuevoInput.focus();
}

// ── Generador de Historial de Pagos PDF ──────────────────────────────────────
const APPS_SCRIPT_PDF_URL = "https://script.google.com/macros/s/AKfycbzal5GP399HgePINzuV7ifuSl_N5wiLGfkurCQ2XbMtdX4BaCJFb9PetaS3Qn6VHGFn/exec";

async function generarHistorialPDF(event, vpId, nombrePasajero) {
  event.stopPropagation();

  const btn = event.currentTarget;
  btn.disabled = true;
  btn.classList.add("btn-pdf-loading");

  try {
    // 1. Datos del viaje_pasajero
    const { data: vp, error: vpErr } = await supabaseClient
      .from("viaje_pasajeros")
      .select("total_a_pagar")
      .eq("id", parseInt(vpId))
      .single();

    if (vpErr || !vp) throw new Error("No se pudo obtener datos del pasajero.");

    // 2. Pagos + bancos en paralelo
    const [{ data: pagos, error: pgErr }, { data: bancosData }] = await Promise.all([
      supabaseClient
        .from("pagos")
        .select("monto, tipo, fecha_pago, banco, comprobante_nro")
        .eq("viaje_pasajero_id", parseInt(vpId))
        .order("fecha_pago", { ascending: true }),
      supabaseClient
        .from("bancos")
        .select("id, banco_id"),
    ]);

    if (pgErr) throw new Error("No se pudo obtener el historial de pagos.");

    const bancosMap = Object.fromEntries(
      (bancosData || []).map(b => [String(b.id), b.banco_id])
    );

    const listaPagos     = pagos || [];
    const pagosReales    = listaPagos.filter(p => p.tipo === "Pago");
    const devoluciones   = listaPagos.filter(p => p.tipo === "Devolución");
    const transferencias = listaPagos.filter(p => p.tipo === "Transferencia");

    const sumaPagado  = pagosReales.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaDevuelto = devoluciones.reduce((s, p) => s + (p.monto || 0), 0);
    const sumaTransf  = transferencias.reduce((s, p) => s + (p.monto || 0), 0);
    const neto        = sumaPagado - sumaDevuelto - sumaTransf;
    const total       = vp.total_a_pagar || 0;
    const saldo       = Math.max(0, total - neto);

    const formatFechaLocal = (fechaStr) => {
      if (!fechaStr) return "—";
      const d = new Date(fechaStr + "T00:00:00");
      return d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    // 3. Armar payload para Apps Script
    const payload = {
      pasajero : nombrePasajero,
      viaje    : viajeActualData?.nombre || "—",
      total    : total,
      suma     : neto,
      saldo    : saldo,
      pagos    : listaPagos.map(p => ({
        fecha       : formatFechaLocal(p.fecha_pago),
        banco       : bancosMap[String(p.banco)] || "—",
        comprobante : p.comprobante_nro || "—",
        monto       : (p.tipo === "Devolución" || p.tipo === "Transferencia")
                        ? -Math.abs(p.monto || 0)
                        : (p.monto || 0)
      }))
    };

    // 4. Llamar al Apps Script
    const response = await fetch(APPS_SCRIPT_PDF_URL, {
      method : "POST",
      body   : JSON.stringify(payload)
    });

    const result = await response.json();
    if (!result.ok) throw new Error(result.error || "Error en Apps Script");

    // 5. Descargar el PDF
    const byteChars = atob(result.pdf);
    const byteArray = new Uint8Array([...byteChars].map(c => c.charCodeAt(0)));
    const blob      = new Blob([byteArray], { type: "application/pdf" });
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement("a");
    a.href          = url;
    a.download      = `Historial_${nombrePasajero.replace(/\s+/g, "_")}_${(viajeActualData?.nombre || "viaje").replace(/\s+/g, "_")}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

  } catch (err) {
    console.error("Error generando PDF:", err);
    alert("No se pudo generar el PDF: " + err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("btn-pdf-loading");
  }
}
