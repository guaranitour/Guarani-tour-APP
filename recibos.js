// ══════════════════════════════════════════════
//  MÓDULO RECIBOS
// ══════════════════════════════════════════════

let todosLosRecibos = [];
let recibosFiltrados = [];

// ── Cargar y renderizar ───────────────────────
async function cargarRecibos() {
  const cont = document.getElementById('recibos-cont');
  cont.innerHTML = '<p class="recibos-loading">Cargando recibos…</p>';

  const { data, error } = await supabaseClient
    .from('recibos')
    .select('*')
    .order('fecha', { ascending: false });

  if (error) {
    cont.innerHTML = `<p class="recibos-error">Error al cargar recibos: ${error.message}</p>`;
    return;
  }

  todosLosRecibos = data || [];
  recibosFiltrados = [...todosLosRecibos];
  renderizarRecibos(recibosFiltrados);
}

function renderizarRecibos(lista) {
  const cont = document.getElementById('recibos-cont');

  // Actualizar contador
  document.getElementById('recibos-count').textContent =
    lista.length === 1 ? '1 recibo' : `${lista.length} recibos`;

  if (lista.length === 0) {
    cont.innerHTML = '<div class="recibos-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>No se encontraron recibos</p></div>';
    return;
  }

  // Agrupar por abona_por
  const grupos = {};
  for (const r of lista) {
    const clave = r.abona_por || '(Sin vendedor)';
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(r);
  }

  // Ordenar grupos por nombre
  const claves = Object.keys(grupos).sort((a, b) => {
    if (a === '(Sin vendedor)') return 1;
    if (b === '(Sin vendedor)') return -1;
    return a.localeCompare(b);
  });

  cont.innerHTML = claves.map(clave => {
    const items = grupos[clave];
    const totalGs = items.reduce((s, r) => s + (Number(r.monto) || 0), 0);

    return `
      <div class="recibos-grupo">
        <div class="recibos-grupo-header" onclick="toggleGrupoRecibos(this)">
          <div class="recibos-grupo-info">
            <div class="recibos-grupo-avatar">${inicialRecibo(clave)}</div>
            <div class="recibos-grupo-datos">
              <span class="recibos-grupo-nombre">${clave}</span>
              <span class="recibos-grupo-sub">${items.length} recibo${items.length !== 1 ? 's' : ''} · ${formatGs(totalGs)}</span>
            </div>
          </div>
          <svg class="recibos-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
        </div>
        <div class="recibos-grupo-body">
          ${items.map(r => renderReciboCard(r)).join('')}
        </div>
      </div>`;
  }).join('');
}

function renderReciboCard(r) {
  const fecha = r.fecha ? formatFechaRecibo(r.fecha) : '—';
  const metodoBadge = r.forma_pago
    ? `<span class="recibo-metodo-badge recibo-metodo-${slugMetodo(r.forma_pago)}">${r.forma_pago}</span>`
    : '';

  return `
    <div class="recibo-card" onclick="verDetalleRecibo(${r.id})">
      <div class="recibo-card-top">
        <div class="recibo-card-left">
          <span class="recibo-nro">#${r.recibo_nro || r.id}</span>
          <span class="recibo-cliente">${r.cliente || '—'}</span>
          <span class="recibo-concepto">${r.concepto || ''}</span>
        </div>
        <div class="recibo-card-right">
          <span class="recibo-monto">${formatGs(r.monto)}</span>
          <span class="recibo-fecha">${fecha}</span>
        </div>
      </div>
      <div class="recibo-card-bottom">
        ${metodoBadge}
        ${r.banco ? `<span class="recibo-banco">${r.banco}</span>` : ''}
        ${r.comprobante ? `<span class="recibo-comprobante-nro">Comp. ${r.comprobante}</span>` : ''}
      </div>
    </div>`;
}

// ── Detalle de recibo ─────────────────────────
async function verDetalleRecibo(id) {
  const recibo = todosLosRecibos.find(r => r.id === id);
  if (!recibo) return;

  const modal = document.getElementById('modal-recibo-detalle');
  const body  = document.getElementById('modal-recibo-body');

  const campos = [
    { label: 'Recibo Nº',      valor: recibo.recibo_nro || recibo.id },
    { label: 'Cliente',        valor: recibo.cliente },
    { label: 'CI',             valor: recibo.ci },
    { label: 'Correo',        valor: recibo.correo_beneficiario },
    { label: 'Fecha',          valor: recibo.fecha ? formatFechaRecibo(recibo.fecha) : null },
    { label: 'Monto',          valor: recibo.monto != null ? formatGs(recibo.monto) : null },
    { label: 'Forma de pago',  valor: recibo.forma_pago },
    { label: 'Banco',          valor: recibo.banco },
    { label: 'Comprobante',    valor: recibo.comprobante },
    { label: 'Concepto',       valor: recibo.concepto },
    { label: 'Abona por',      valor: recibo.abona_por },
    { label: 'Registrado por', valor: recibo.usuario },
  ];

  body.innerHTML = `
    <div class="recibo-detalle-grid">
      ${campos.map(c => `
        <div class="recibo-detalle-row">
          <span class="recibo-detalle-label">${c.label}</span>
          <span class="recibo-detalle-valor">${c.valor || '—'}</span>
        </div>`).join('')}
    </div>
    ${recibo.link ? `
      <div class="recibo-detalle-link-wrap">
        <a href="${recibo.link}" target="_blank" class="recibo-link-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Ver comprobante / recibo
        </a>
      </div>` : ''}`;

  modal.style.display = 'flex';
}

function cerrarModalRecibo(e) {
  if (!e || e.target === document.getElementById('modal-recibo-detalle') || e.currentTarget.classList.contains('modal-recibo-close')) {
    document.getElementById('modal-recibo-detalle').style.display = 'none';
  }
}

// ── Búsqueda / filtro ─────────────────────────
function filtrarRecibos() {
  const q = document.getElementById('recibos-search').value.trim().toLowerCase();
  if (!q) {
    recibosFiltrados = [...todosLosRecibos];
  } else {
    recibosFiltrados = todosLosRecibos.filter(r =>
      (r.cliente      || '').toLowerCase().includes(q) ||
      (r.ci           || '').toLowerCase().includes(q) ||
      (r.abona_por    || '').toLowerCase().includes(q) ||
      (r.concepto     || '').toLowerCase().includes(q) ||
      (r.recibo_nro   || '').toString().includes(q) ||
      (r.forma_pago   || '').toLowerCase().includes(q)
    );
  }
  renderizarRecibos(recibosFiltrados);
}

// ── Accordion ─────────────────────────────────
function toggleGrupoRecibos(header) {
  const grupo = header.closest('.recibos-grupo');
  grupo.classList.toggle('recibos-grupo--abierto');
}

// ── Helpers ───────────────────────────────────
function formatGs(n) {
  if (n == null || n === '') return '—';
  return 'Gs. ' + Number(n).toLocaleString('es-PY');
}

function formatFechaRecibo(f) {
  if (!f) return '—';
  const d = new Date(f + 'T00:00:00');
  return d.toLocaleDateString('es-PY', { day: '2-digit', month: 'short', year: 'numeric' });
}

function inicialRecibo(nombre) {
  return (nombre || '?').charAt(0).toUpperCase();
}

function slugMetodo(m) {
  return (m || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
