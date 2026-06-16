// ══════════════════════════════════════════════
//  MÓDULO ESTADO BYC
// ══════════════════════════════════════════════

let todosLosRegistrosByc = [];
let bycFiltrados = [];

// ── Inicializar vista ─────────────────────────
function initBycView() {
  const search = document.getElementById('byc-search');
  if (search) search.value = '';

  const filterEstado = document.getElementById('byc-filter-estado');
  if (filterEstado) filterEstado.value = '';

  const filterEnvio = document.getElementById('byc-filter-envio');
  if (filterEnvio) filterEnvio.value = '';

  cargarByc();
}

// ── Cargar datos ──────────────────────────────
async function cargarByc() {
  const cont = document.getElementById('byc-cont');
  cont.innerHTML = '<p class="byc-loading">Cargando registros…</p>';

  const { data, error } = await supabaseClient
    .from('basesycondiciones')
    .select('id, nombre, ci, estado, email, email_disponible, correo_duplicado, link, estado_envio')
    .order('nombre', { ascending: true });

  if (error) {
    cont.innerHTML = `<p class="byc-error">Error al cargar: ${error.message}</p>`;
    return;
  }

  todosLosRegistrosByc = data || [];
  bycFiltrados = [...todosLosRegistrosByc];
  renderizarByc(bycFiltrados);
}

// ── Filtrar ───────────────────────────────────
function filtrarByc() {
  const q = (document.getElementById('byc-search')?.value || '').trim().toLowerCase();
  const estado = document.getElementById('byc-filter-estado')?.value || '';
  const envio  = document.getElementById('byc-filter-envio')?.value  || '';

  bycFiltrados = todosLosRegistrosByc.filter(r => {
    const matchQ = !q ||
      (r.nombre || '').toLowerCase().includes(q) ||
      (r.ci     || '').toLowerCase().includes(q) ||
      (r.email  || '').toLowerCase().includes(q);
    const matchEstado = !estado || (r.estado || '') === estado;
    const matchEnvio  = !envio  || (r.estado_envio || '') === envio;
    return matchQ && matchEstado && matchEnvio;
  });

  renderizarByc(bycFiltrados);
}

// ── Renderizar lista ──────────────────────────
function renderizarByc(lista) {
  const cont = document.getElementById('byc-cont');
  const countEl = document.getElementById('byc-count');
  if (countEl) countEl.textContent =
    lista.length === 1 ? '1 registro' : `${lista.length} registros`;

  if (lista.length === 0) {
    cont.innerHTML = `
      <div class="byc-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
        </svg>
        <p>No se encontraron registros</p>
      </div>`;
    return;
  }

  cont.innerHTML = lista.map(r => renderBycRow(r)).join('');
}

// ── Fila de registro ──────────────────────────
function renderBycRow(r) {
  const estadoBadge  = r.estado      ? `<span class="byc-badge byc-estado-${slugByc(r.estado)}">${r.estado}</span>`           : '<span class="byc-badge byc-estado-sin">—</span>';
  const envioBadge   = r.estado_envio ? `<span class="byc-badge byc-envio-${slugByc(r.estado_envio)}">${r.estado_envio}</span>` : '';
  const emailInfo    = r.email
    ? `<span class="byc-email">${r.email}${r.correo_duplicado ? ' <span class="byc-dup-tag">dup.</span>' : ''}</span>`
    : '<span class="byc-email byc-email--vacio">Sin email</span>';
  const linkBtn      = r.link
    ? `<a href="${r.link}" target="_blank" class="byc-link-btn" onclick="event.stopPropagation()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ver
      </a>`
    : '';

  return `
    <div class="byc-row">
      <div class="byc-row-main">
        <div class="byc-row-left">
          <span class="byc-nombre">${r.nombre || '—'}</span>
          <span class="byc-ci">${r.ci || ''}</span>
        </div>
        <div class="byc-row-right">
          ${estadoBadge}
          ${envioBadge}
          ${linkBtn}
        </div>
      </div>
      <div class="byc-row-email">${emailInfo}</div>
    </div>`;
}

// ── Helper slug ───────────────────────────────
function slugByc(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
