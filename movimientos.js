// ══════════════════════════════════════════════════
//  movimientos.js — Módulo Movimientos Bancarios
//  Guaraní Tour APP
// ══════════════════════════════════════════════════

let _todosMovimientos = [];

// ── Helpers ────────────────────────────────────────
function formatMonto(n) {
  if (n == null) return "—";
  return "Gs. " + Number(n).toLocaleString("es-PY");
}

function _labelFecha(fechaStr) {
  if (!fechaStr) return "Sin fecha";
  const hoy  = new Date();
  const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
  const [y, m, d] = fechaStr.split("-").map(Number);
  const fecha = new Date(y, m - 1, d);

  if (fecha.toDateString() === hoy.toDateString())  return "Hoy";
  if (fecha.toDateString() === ayer.toDateString()) return "Ayer";

  const mismoAnio = fecha.getFullYear() === hoy.getFullYear();
  return fecha.toLocaleDateString("es-PY", mismoAnio
    ? { day: "numeric", month: "long", weekday: "long" }
    : { day: "numeric", month: "long", year: "numeric", weekday: "long" }
  );
}

// ── Tarjeta bancaria ────────────────────────────────
function _renderTarjetaBanco(totalIng, totalEgr, balance) {
  const card = document.getElementById("mov-banco-card");
  if (!card) return;
  const esNeg = balance < 0;

  card.innerHTML = `
    <div class="banco-card">
      <div class="banco-card__bg1"></div>
      <div class="banco-card__bg2"></div>

      <!-- Fila: nombre+número | saldo -->
      <div class="banco-card__top">
        <div class="banco-card__info">
          <span class="banco-card__nombre">Caja E.A.S.</span>
          <span class="banco-card__cuenta">Nro 1441004705</span>
        </div>
        <div class="banco-card__saldo-wrap">
          <span class="banco-card__saldo-label">Saldo</span>
          <span class="banco-card__saldo-monto${esNeg ? " negativo" : ""}">
            ${formatMonto(Math.abs(balance))}${esNeg ? `<em class="banco-card__neg">(−)</em>` : ""}
          </span>
        </div>
      </div>

      <!-- Stats -->
      <div class="banco-card__stats">
        <div class="banco-card__stat">
          <div class="banco-card__stat-label"><span class="stat-dot ing"></span>Ingresos</div>
          <div class="banco-card__stat-val">+ ${formatMonto(totalIng)}</div>
        </div>
        <div class="banco-card__stat banco-card__stat--sep">
          <div class="banco-card__stat-label"><span class="stat-dot egr"></span>Egresos</div>
          <div class="banco-card__stat-val">− ${formatMonto(totalEgr)}</div>
        </div>
      </div>
    </div>`;
}

// ── Carga desde Supabase ────────────────────────────
async function cargarMovimientos() {
  const listEl = document.getElementById("mov-list");
  if (!listEl) return;

  // Mostrar tarjeta con ceros mientras carga
  _renderTarjetaBanco(0, 0, 0);

  listEl.innerHTML = `
    <div class="mov-estado">
      <div class="icon">⏳</div>
      <p>Cargando movimientos…</p>
    </div>`;

  const { data, error } = await supabaseClient
    .from("movimientos_bancarios")
    .select("id, created_at, fecha, tipo, categoria, descripcion, monto, cuenta_beneficiaria, cuenta_emisora, usuario")
    .order("fecha", { ascending: false });

  if (error) {
    listEl.innerHTML = `
      <div class="mov-estado">
        <div class="icon">⚠️</div>
        <p>Error al cargar movimientos.</p>
      </div>`;
    return;
  }

  _todosMovimientos = data || [];
  renderMovimientos(_todosMovimientos);
}

// ── Render lista ────────────────────────────────────
function renderMovimientos(lista) {
  const listEl = document.getElementById("mov-list");
  if (!listEl) return;

  // Totales siempre sobre todos los datos
  const totalIng = _todosMovimientos.filter(m => m.tipo === "ingreso").reduce((s, m) => s + (m.monto || 0), 0);
  const totalEgr = _todosMovimientos.filter(m => m.tipo === "egreso").reduce((s, m)  => s + (m.monto || 0), 0);
  _renderTarjetaBanco(totalIng, totalEgr, totalIng - totalEgr);

  const resEl = document.getElementById("mov-resumen");
  if (resEl) resEl.style.display = "none";

  if (!lista.length) {
    listEl.innerHTML = `
      <div class="mov-estado">
        <div class="icon">📭</div>
        <p>No hay movimientos${lista.length !== _todosMovimientos.length ? " que coincidan" : " registrados"}.</p>
      </div>`;
    return;
  }

  const grupos = {};
  lista.forEach(m => {
    const key = m.fecha || "sin-fecha";
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(m);
  });

  let html = "";
  Object.keys(grupos).forEach(k => {
    html += `<div class="mov-fecha-group">${_labelFecha(k)}</div>`;
    grupos[k].forEach(m => { html += _renderMovItem(m); });
  });

  listEl.innerHTML = html;
}

function _renderMovItem(m) {
  const esIng = m.tipo === "ingreso";
  const cls   = esIng ? "ing" : "egr";
  const signo = esIng ? "+" : "−";
  const color = esIng ? "#2e7d32" : "#c62828";
  const icon  = esIng
    ? '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'
    : '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>';

  const cat = m.categoria || (esIng ? "Ingreso" : "Egreso");

  return `
    <div class="mov-item" onclick="abrirDetalleMovimiento('${m.id}')">
      <div class="mov-item__icon ${cls}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2">${icon}</svg>
      </div>
      <div class="mov-item__body">
        <span class="mov-item__categoria">${cat}</span>
      </div>
      <div class="mov-item__monto ${cls}">${signo} ${formatMonto(m.monto)}</div>
    </div>`;
}

// ── Filtrado ────────────────────────────────────────
function filtrarMovimientos() {
  const q    = (document.getElementById("mov-search")?.value || "").toLowerCase().trim();
  const tipo = document.getElementById("mov-filtro-tipo")?.value || "";

  const filtrado = _todosMovimientos.filter(m => {
    const matchTipo = !tipo || m.tipo === tipo;
    const matchQ    = !q ||
      (m.descripcion         || "").toLowerCase().includes(q) ||
      (m.categoria           || "").toLowerCase().includes(q) ||
      (m.cuenta_emisora      || "").toLowerCase().includes(q) ||
      (m.cuenta_beneficiaria || "").toLowerCase().includes(q) ||
      (m.usuario             || "").toLowerCase().includes(q);
    return matchTipo && matchQ;
  });

  renderMovimientos(filtrado);
}

// ── Formulario nuevo movimiento ─────────────────────
const _catPorTipo = {
  ingreso: ["Pasaje", "Club Destino", "Servicio"],
  egreso:  ["Préstamo", "Pérdida", "Inversión", "Club Destino"],
};

function actualizarCategoriasMovimiento() {
  const tipo = document.getElementById("mnv-tipo")?.value;
  const sel  = document.getElementById("mnv-categoria");
  if (!sel) return;
  const opciones = _catPorTipo[tipo] || [];
  sel.innerHTML = opciones.length
    ? `<option value="">— Seleccionar —</option>` + opciones.map(c => `<option value="${c}">${c}</option>`).join("")
    : `<option value="">— Seleccionar tipo primero —</option>`;
}

function actualizarCuentasPorTipo() {
  const tipo    = document.getElementById("mnv-tipo")?.value;
  const emisora = document.getElementById("mnv-cuenta-emisora");
  const benef   = document.getElementById("mnv-cuenta-beneficiaria");
  if (!emisora || !benef) return;

  if (tipo === "ingreso") {
    // Emisora: UENO JAMIL / UENO OSCAR (seleccionable)
    emisora.innerHTML = `
      <option value="">— Seleccionar —</option>
      <option value="UENO JAMIL">UENO JAMIL</option>
      <option value="UENO OSCAR">UENO OSCAR</option>`;
    emisora.disabled = false;

    // Beneficiaria: fijo Caja E.A.S
    benef.innerHTML = `<option value="Caja E.A.S">Caja E.A.S</option>`;
    benef.disabled = true;

  } else if (tipo === "egreso") {
    // Emisora: fijo Caja E.A.S
    emisora.innerHTML = `<option value="Caja E.A.S">Caja E.A.S</option>`;
    emisora.disabled = true;

    // Beneficiaria: UENO JAMIL / UENO OSCAR (seleccionable)
    benef.innerHTML = `
      <option value="">— Seleccionar —</option>
      <option value="UENO JAMIL">UENO JAMIL</option>
      <option value="UENO OSCAR">UENO OSCAR</option>`;
    benef.disabled = false;

  } else {
    // Sin tipo — reset
    emisora.innerHTML = `<option value="">— Seleccionar tipo primero —</option>`;
    emisora.disabled = false;
    benef.innerHTML  = `<option value="">— Seleccionar tipo primero —</option>`;
    benef.disabled   = false;
  }
}

function iniciarFormMovimiento() {
  const hoy = new Date().toISOString().split("T")[0];
  const fechaEl = document.getElementById("mnv-fecha");
  if (fechaEl) fechaEl.value = hoy;

  ["mnv-tipo", "mnv-descripcion", "mnv-monto"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  // Resetear categorías y cuentas (sin tipo seleccionado = estado inicial)
  actualizarCategoriasMovimiento();
  actualizarCuentasPorTipo();

  // Escuchar cambio de tipo para actualizar categorías y cuentas
  const tipoEl = document.getElementById("mnv-tipo");
  if (tipoEl) {
    tipoEl.onchange = () => {
      actualizarCategoriasMovimiento();
      actualizarCuentasPorTipo();
    };
  }

  const errEl = document.getElementById("mnv-error");
  if (errEl) errEl.textContent = "";
  const btn = document.getElementById("btn-guardar-movimiento");
  if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }
}

// ── Detalle de movimiento (modal) ───────────────────
function abrirDetalleMovimiento(id) {
  const m = _todosMovimientos.find(x => String(x.id) === String(id));
  if (!m) return;

  const esIng = m.tipo === "ingreso";
  const cls   = esIng ? "tipo-ingreso" : "tipo-egreso";
  const signo = esIng ? "+" : "−";

  let fecha = "—";
  if (m.fecha) {
    const [y, mo, d] = m.fecha.split("-").map(Number);
    fecha = new Date(y, mo - 1, d).toLocaleDateString("es-PY", {
      day: "numeric", month: "long", year: "numeric"
    });
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-transferir-overlay";
  overlay.id = "mov-detalle-overlay";
  overlay.onclick = (e) => { if (e.target === overlay) cerrarDetalleMovimiento(); };

  overlay.innerHTML = `
    <div class="modal-transferir-card">
      <div class="modal-transferir-header">
        <div class="modal-transferir-titulo">
          <span>Detalle del movimiento</span>
        </div>
        <button class="modal-transferir-close" onclick="cerrarDetalleMovimiento()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="pd-monto-valor ${cls}">${signo} ${formatMonto(m.monto)}</div>

      <div class="pd-grid">
        <div class="pd-row"><span class="pd-label">Fecha</span><span class="pd-value">${fecha}</span></div>
        <div class="pd-row"><span class="pd-label">Tipo</span><span class="pd-value">${esIng ? "Ingreso" : "Egreso"}</span></div>
        <div class="pd-row"><span class="pd-label">Categoría</span><span class="pd-value">${m.categoria || "—"}</span></div>
        <div class="pd-row"><span class="pd-label">Descripción</span><span class="pd-value">${m.descripcion || "—"}</span></div>
        <div class="pd-row"><span class="pd-label">Cuenta emisora</span><span class="pd-value">${m.cuenta_emisora || "—"}</span></div>
        <div class="pd-row"><span class="pd-label">Cuenta beneficiaria</span><span class="pd-value">${m.cuenta_beneficiaria || "—"}</span></div>
        <div class="pd-row"><span class="pd-label">Registrado por</span><span class="pd-value">${m.usuario || "—"}</span></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
}

function cerrarDetalleMovimiento() {
  document.getElementById("mov-detalle-overlay")?.remove();
}

async function guardarMovimiento() {
  const errEl = document.getElementById("mnv-error");
  if (errEl) errEl.textContent = "";

  const fecha       = document.getElementById("mnv-fecha")?.value;
  const tipo        = document.getElementById("mnv-tipo")?.value;
  const categoria   = document.getElementById("mnv-categoria")?.value.trim();
  const descripcion = document.getElementById("mnv-descripcion")?.value.trim();
  const monto       = document.getElementById("mnv-monto")?.value;
  const cuentaEmisora      = document.getElementById("mnv-cuenta-emisora")?.value.trim();
  const cuentaBeneficiaria = document.getElementById("mnv-cuenta-beneficiaria")?.value.trim();

  if (!fecha || !tipo || !categoria || !descripcion || !monto || !cuentaEmisora || !cuentaBeneficiaria) {
    if (errEl) errEl.textContent = "Completá todos los campos obligatorios.";
    return;
  }

  const btn = document.getElementById("btn-guardar-movimiento");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("movimientos_bancarios")
    .insert([{
      fecha,
      tipo,
      categoria,
      descripcion,
      monto:               Number(monto),
      cuenta_emisora:      cuentaEmisora,
      cuenta_beneficiaria: cuentaBeneficiaria,
      usuario:             document.getElementById("user-email")?.textContent || null,
    }]);

  if (error) {
    if (errEl) errEl.textContent = "Error al guardar. Intentá de nuevo.";
    if (btn) { btn.disabled = false; btn.textContent = "Guardar"; }
    return;
  }

  showToast("Movimiento guardado correctamente.", "success");
  navigateTo("movimientos");
}
