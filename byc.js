// ══════════════════════════════════════════════
//  MÓDULO ESTADO BYC
// ══════════════════════════════════════════════

let todosLosRegistrosByc = [];
let bycFiltrados = [];

// ── Inicializar vista ─────────────────────────
function initBycView() {
  const search = document.getElementById('byc-search');
  if (search) search.value = '';
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

  bycFiltrados = !q ? [...todosLosRegistrosByc] : todosLosRegistrosByc.filter(r =>
    (r.nombre || '').toLowerCase().includes(q) ||
    (r.ci     || '').toLowerCase().includes(q)
  );

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
  const linkBtn = r.link
    ? `<a href="${r.link}" target="_blank" class="byc-link-btn" onclick="event.stopPropagation()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Ver
      </a>`
    : '';

  return `
    <div class="byc-row">
      <div class="byc-row-inner">
        <div class="byc-row-left">
          <span class="byc-nombre">${r.nombre || '—'}</span>
          <span class="byc-ci">${r.ci || '—'}</span>
        </div>
        <div class="byc-row-right">
          ${linkBtn}
        </div>
      </div>
    </div>`;
}

// ── Helper slug ───────────────────────────────
function slugByc(s) {
  return (s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ── Normalizar CI (quita puntos, guiones y espacios para comparar) ──
function normalizarCI(ci) {
  return (ci || '').replace(/[\.\-\s]/g, '').trim().toLowerCase();
}

// ══════════════════════════════════════════════
//  PENDIENTES DE VINCULAR
// ══════════════════════════════════════════════

let _pendientesLista = [];
let _pendientesFiltrados = [];
let _pendienteSeleccionado = null;
let _pasajeroSeleccionado = null;
let _pasajerosCache = [];

// ── Abrir modal ───────────────────────────────
async function abrirPendientesVincular() {
  const overlay = document.getElementById('byc-vincular-overlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  mostrarPaso1();
  await cargarPendientes();
}

function cerrarPendientesVincular() {
  _cerrarModalVincular();
}

function _cerrarModalVincular() {
  document.getElementById('byc-vincular-overlay').style.display = 'none';
  document.body.style.overflow = '';
  _pendienteSeleccionado = null;
  _pasajeroSeleccionado = null;
  const inp = document.getElementById('byc-pendientes-search');
  if (inp) inp.value = '';
}

// ── Paso 1: cargar pendientes ─────────────────
async function cargarPendientes() {
  const cont = document.getElementById('byc-pendientes-cont');
  cont.innerHTML = '<p class="byc-loading">Cargando…</p>';

  // Traer todos los CI de byc y de pasajeros y comparar en cliente
  const [bycRes, pasRes] = await Promise.all([
    supabaseClient.from('basesycondiciones').select('id, nombre, ci, email').order('nombre'),
    supabaseClient.from('pasajeros').select('"Documento de Identidad"')
  ]);

  if (bycRes.error || pasRes.error) {
    cont.innerHTML = '<p class="byc-error">Error al cargar datos.</p>';
    return;
  }

  const cisPasajeros = new Set(
    (pasRes.data || []).map(p => normalizarCI(p['Documento de Identidad']))
  );

  // Pendientes = están en byc pero NO en pasajeros (comparación normalizada)
  _pendientesLista = (bycRes.data || []).filter(r =>
    r.ci && !cisPasajeros.has(normalizarCI(r.ci))
  );
  _pendientesFiltrados = [..._pendientesLista];
  renderPendientes(_pendientesFiltrados);
}

function filtrarPendientes() {
  const q = (document.getElementById('byc-pendientes-search')?.value || '').trim().toLowerCase();
  _pendientesFiltrados = !q ? [..._pendientesLista] : _pendientesLista.filter(r =>
    (r.nombre || '').toLowerCase().includes(q) ||
    (r.ci     || '').toLowerCase().includes(q)
  );
  renderPendientes(_pendientesFiltrados);
}

function renderPendientes(lista) {
  const cont = document.getElementById('byc-pendientes-cont');
  if (lista.length === 0) {
    cont.innerHTML = '<div class="byc-empty" style="padding:1.5rem"><p>Sin pendientes 🎉</p></div>';
    return;
  }
  cont.innerHTML = `
    <div class="byc-pendientes-list">
      ${lista.map(r => `
        <div class="byc-pendiente-row" onclick="seleccionarPendiente(${r.id})" ontouchend="event.preventDefault();seleccionarPendiente(${r.id})">
          <div class="byc-row-left">
            <span class="byc-nombre">${r.nombre || '—'}</span>
            <span class="byc-ci">${r.ci || '—'}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:#aaa;flex-shrink:0"><path d="M9 18l6-6-6-6"/></svg>
        </div>`).join('')}
    </div>`;
}

// ── Paso 2: seleccionar pendiente y buscar pasajero ──
async function seleccionarPendiente(id) {
  _pendienteSeleccionado = _pendientesLista.find(r => r.id === id);
  if (!_pendienteSeleccionado) return;

  // Precargar pasajeros si no están en cache
  if (_pasajerosCache.length === 0) {
    const { data } = await supabaseClient
      .from('pasajeros')
      .select('id, Pasajero, "Documento de Identidad", "E-mail"')
      .order('Pasajero');
    _pasajerosCache = data || [];
  }

  // Resetear paso 2
  _pasajeroSeleccionado = null;
  const inp = document.getElementById('byc-pasajero-input');
  if (inp) inp.value = '';
  const sel = document.getElementById('byc-pasajero-seleccionado');
  if (sel) sel.style.display = 'none';
  const btn = document.getElementById('byc-btn-confirmar');
  if (btn) btn.disabled = true;
  const err = document.getElementById('byc-vincular-error');
  if (err) err.textContent = '';

  // Mostrar info del byc seleccionado
  const info = document.getElementById('byc-paso2-info');
  if (info) info.innerHTML = `
    <div class="byc-paso2-tag">
      <strong>${_pendienteSeleccionado.nombre || '—'}</strong>
      <span>${_pendienteSeleccionado.ci || ''}</span>
      ${_pendienteSeleccionado.email ? `<span>${_pendienteSeleccionado.email}</span>` : ''}
    </div>`;

  // Forzar repaint antes de cambiar de paso (evita pantalla negra en móvil)
  requestAnimationFrame(() => mostrarPaso2());
}

// ── Autocomplete pasajeros ────────────────────
function filtrarPasajerosVincular(q) {
  const dd = document.getElementById('byc-pasajero-dropdown');
  _pasajeroSeleccionado = null;
  const btn = document.getElementById('byc-btn-confirmar');
  if (btn) btn.disabled = true;
  const sel = document.getElementById('byc-pasajero-seleccionado');
  if (sel) sel.style.display = 'none';

  if (!q || q.trim().length < 2) { dd.style.display = 'none'; return; }

  const resultados = _pasajerosCache.filter(p =>
    (p.Pasajero || '').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);

  if (resultados.length === 0) {
    dd.innerHTML = '<div class="byc-dd-item byc-dd-empty">Sin resultados</div>';
    dd.style.display = 'block';
    return;
  }

  dd.innerHTML = resultados.map(p => `
    <div class="byc-dd-item" onmousedown="elegirPasajero(${p.id})">
      <span class="byc-dd-nombre">${p.Pasajero}</span>
      <span class="byc-dd-sub">${p['Documento de Identidad'] || 'Sin CI'}</span>
    </div>`).join('');
  dd.style.display = 'block';
}

function elegirPasajero(id) {
  _pasajeroSeleccionado = _pasajerosCache.find(p => p.id === id);
  if (!_pasajeroSeleccionado) return;

  const inp = document.getElementById('byc-pasajero-input');
  if (inp) inp.value = _pasajeroSeleccionado.Pasajero;
  const dd = document.getElementById('byc-pasajero-dropdown');
  if (dd) dd.style.display = 'none';

  // Mostrar resumen de lo que se va a actualizar
  const sel = document.getElementById('byc-pasajero-seleccionado');
  if (sel) {
    const ciNuevo    = _pendienteSeleccionado.ci    || '—';
    const emailNuevo = _pendienteSeleccionado.email || '—';
    const ciActual    = _pasajeroSeleccionado['Documento de Identidad'] || 'vacío';
    const emailActual = _pasajeroSeleccionado['E-mail'] || 'vacío';
    sel.innerHTML = `
      <div class="byc-vincular-preview">
        <div class="byc-vp-row">
          <span class="byc-vp-label">CI</span>
          <span class="byc-vp-actual">${ciActual}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          <span class="byc-vp-nuevo">${ciNuevo}</span>
        </div>
        <div class="byc-vp-row">
          <span class="byc-vp-label">Email</span>
          <span class="byc-vp-actual">${emailActual}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          <span class="byc-vp-nuevo">${emailNuevo}</span>
        </div>
      </div>`;
    sel.style.display = 'block';
  }

  const btn = document.getElementById('byc-btn-confirmar');
  if (btn) btn.disabled = false;
}

function cerrarPasajerosDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('byc-pasajero-dropdown');
    if (dd) dd.style.display = 'none';
  }, 150);
}

// ── Confirmar vínculo ─────────────────────────
async function confirmarVinculo() {
  if (!_pendienteSeleccionado || !_pasajeroSeleccionado) return;

  const btn = document.getElementById('byc-btn-confirmar');
  const err = document.getElementById('byc-vincular-error');
  btn.disabled = true;
  btn.textContent = 'Vinculando…';
  if (err) err.textContent = '';

  const update = {};
  if (_pendienteSeleccionado.ci)    update['Documento de Identidad'] = _pendienteSeleccionado.ci;
  if (_pendienteSeleccionado.email) update['E-mail'] = _pendienteSeleccionado.email;

  const { error } = await supabaseClient
    .from('pasajeros')
    .update(update)
    .eq('id', _pasajeroSeleccionado.id);

  btn.textContent = 'Vincular';

  if (error) {
    if (err) err.textContent = 'Error al vincular: ' + error.message;
    btn.disabled = false;
    return;
  }

  // Actualizar cache local
  const idx = _pasajerosCache.findIndex(p => p.id === _pasajeroSeleccionado.id);
  if (idx !== -1) {
    if (_pendienteSeleccionado.ci)    _pasajerosCache[idx]['Documento de Identidad'] = _pendienteSeleccionado.ci;
    if (_pendienteSeleccionado.email) _pasajerosCache[idx]['E-mail'] = _pendienteSeleccionado.email;
  }

  // Quitar de la lista de pendientes
  _pendientesLista = _pendientesLista.filter(r => r.id !== _pendienteSeleccionado.id);

  _cerrarModalVincular();
  mostrarToastByc('✅ Pasajero vinculado correctamente');
}

// ── Navegación entre pasos ────────────────────
function mostrarPaso1() {
  document.getElementById('byc-paso1').style.display = '';
  document.getElementById('byc-paso2').style.display = 'none';
}

function mostrarPaso2() {
  document.getElementById('byc-paso1').style.display = 'none';
  document.getElementById('byc-paso2').style.display = '';
}

function volverPaso1() {
  _pendienteSeleccionado = null;
  _pasajeroSeleccionado = null;
  mostrarPaso1();
}

// ── Toast ─────────────────────────────────────
function mostrarToastByc(msg) {
  let t = document.getElementById('byc-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'byc-toast';
    t.className = 'recibo-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('recibo-toast--visible');
  setTimeout(() => t.classList.remove('recibo-toast--visible'), 2500);
}
