// ══════════════════════════════════════════════
//  MÓDULO RECIBOS
// ══════════════════════════════════════════════

let todosLosRecibos = [];
let recibosFiltrados = [];

// Modo de vista de la lista: 'todos' (sin agrupar, más reciente primero,
// es el default) | 'viaje' (agrupado por abona_por) | 'comercial' (solo
// es_solidario=false/null, sin agrupar) | 'solidario' (solo
// es_solidario=true, sin agrupar). Se resetea a 'todos' cada vez que se
// entra al módulo.
let _modoAgrupacionRecibos = 'todos';

// ── Cargar y renderizar lista ─────────────────
async function cargarRecibos() {
  const cont = document.getElementById('recibos-cont');
  cont.innerHTML = '<p class="recibos-loading">Cargando recibos…</p>';
  _modoAgrupacionRecibos = 'todos';

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
  actualizarChipsModoRecibos();
  actualizarResumenMesRecibos();
  renderizarRecibos(recibosFiltrados);
}

// Totales del mes en curso (calendario, no "últimos 30 días"), sobre el
// total de recibos cargados —no sobre recibosFiltrados— para que una
// búsqueda activa no altere el resumen mostrado arriba.
function actualizarResumenMesRecibos() {
  const totalEl = document.getElementById('recibos-resumen-total');
  const cantEl  = document.getElementById('recibos-resumen-cantidad');
  if (!totalEl || !cantEl) return;

  const hoy = new Date();
  const anioActual = hoy.getFullYear();
  const mesActual  = hoy.getMonth(); // 0-11

  const delMes = todosLosRecibos.filter(r => {
    if (!r.fecha) return false;
    const d = new Date(r.fecha + 'T00:00:00');
    return d.getFullYear() === anioActual && d.getMonth() === mesActual;
  });

  const totalGs = delMes.reduce((s, r) => s + (Number(r.monto) || 0), 0);

  totalEl.textContent = formatGs(totalGs);
  cantEl.textContent  = delMes.length;
}

// Llamado desde los chips "Todos" / "Por viaje" / "Por cliente"
function cambiarModoAgrupacionRecibos(modo) {
  _modoAgrupacionRecibos = modo;
  actualizarChipsModoRecibos();
  renderizarRecibos(recibosFiltrados);
}

function actualizarChipsModoRecibos() {
  document.querySelectorAll('.recibos-modo-chip').forEach(chip => {
    chip.classList.toggle('activo', chip.dataset.modo === _modoAgrupacionRecibos);
  });
}

function renderizarRecibos(lista) {
  const cont = document.getElementById('recibos-cont');

  const countEl = document.getElementById('recibos-count');
  if (countEl) countEl.textContent =
    lista.length === 1 ? '1 recibo' : `${lista.length} recibos`;

  if (lista.length === 0) {
    cont.innerHTML = '<div class="recibos-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>No se encontraron recibos</p></div>';
    return;
  }

  // Modo "Todos": lista plana, sin agrupar (ya viene ordenada por fecha
  // desc desde la carga; al filtrar se preserva ese orden).
  // Modos "comercial"/"solidario": mismo render plano que "Todos", pero
  // sobre un subconjunto filtrado por es_solidario — no son agrupadores,
  // son filtros rápidos (a diferencia de "Por viaje").
  if (_modoAgrupacionRecibos === 'todos' || _modoAgrupacionRecibos === 'comercial' || _modoAgrupacionRecibos === 'solidario') {
    const listaModo = _modoAgrupacionRecibos === 'comercial' ? lista.filter(r => !r.es_solidario)
                     : _modoAgrupacionRecibos === 'solidario' ? lista.filter(r => r.es_solidario)
                     : lista;

    if (listaModo.length === 0) {
      cont.innerHTML = '<div class="recibos-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>No se encontraron recibos</p></div>';
      return;
    }

    cont.innerHTML = `<div class="recibos-grupo recibos-grupo--abierto recibos-grupo--plana">
      <div class="recibos-grupo-body">
        ${listaModo.map(r => renderReciboCard(r)).join('')}
      </div>
    </div>`;
    return;
  }

  const campoClave = 'abona_por';
  const etiquetaSinDato = '(Sin viaje)';

  const grupos = {};
  for (const r of lista) {
    const clave = r[campoClave] || etiquetaSinDato;
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(r);
  }

  const claves = Object.keys(grupos).sort((a, b) => {
    if (a === etiquetaSinDato) return 1;
    if (b === etiquetaSinDato) return -1;
    return a.localeCompare(b);
  });

  cont.innerHTML = claves.map(clave => {
    const items = grupos[clave];
    const totalGs = items.reduce((s, r) => s + (Number(r.monto) || 0), 0);
    const iconoSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>';

    return `
      <div class="recibos-grupo">
        <div class="recibos-grupo-header" onclick="toggleGrupoRecibos(this)">
          <div class="recibos-grupo-icono">${iconoSvg}</div>
          <div class="recibos-grupo-datos">
            <span class="recibos-grupo-nombre">${clave}</span>
            <span class="recibos-grupo-sub">${items.length} recibo${items.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="recibos-grupo-total">
            <span class="recibos-grupo-total-valor">${formatGs(totalGs)}</span>
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
  const metodoBadge = r.forma_pago
    ? `<span class="recibo-metodo-badge recibo-metodo-${slugMetodo(r.forma_pago)}">${r.forma_pago}</span>`
    : '';
  const solidarioBadge = r.es_solidario
    ? `<span class="recibo-metodo-badge recibo-metodo-solidario">Solidario</span>`
    : '';

  // En cualquier modo que no agrupe por viaje, el viaje no está implícito
  // por el grupo, así que lo mostramos como metadato dentro de la card.
  const mostrarViaje = _modoAgrupacionRecibos !== 'viaje' && r.abona_por;
  const metaTexto = [
    r.fecha ? formatFechaRecibo(r.fecha) : null,
    r.recibo_nro ? `#${r.recibo_nro}` : null,
    mostrarViaje ? r.abona_por : null,
  ].filter(Boolean).join(' · ');

  return `
    <div class="recibo-card" onclick="navigateTo('recibo-detalle', ${r.id})">
      <div class="recibo-avatar">${inicialRecibo(r.cliente)}</div>
      <div class="recibo-card-main">
        <div class="recibo-card-linea1">
          <span class="recibo-cliente">${r.cliente || '—'}</span>
          <span class="recibo-monto">${formatGs(r.monto)}</span>
        </div>
        <div class="recibo-card-linea2">
          <span class="recibo-meta">${metaTexto || '—'}</span>
          <span class="recibo-card-badges">${solidarioBadge}${metodoBadge}</span>
        </div>
      </div>
    </div>`;
}

// ── Precarga de comprobantes (Samsung Internet fix) ──────────
// navigator.share() con archivos exige que el llamado ocurra dentro
// del "user activation" del click, sin awaits previos. Algunos
// navegadores (Samsung Internet) son estrictos y lo invalidan si pasa
// tiempo/await de por medio → NotAllowedError. Por eso descargamos el
// PDF en segundo plano apenas se abre el recibo, así al presionar
// "Compartir" el share sale sin ningún await antes.
const _cacheArchivosCompartir = new Map(); // fileId -> Promise<File>

function precargarComprobante(fileId) {
  if (!fileId || _cacheArchivosCompartir.has(fileId)) return;

  const promesa = fetch(APPSCRIPT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify({ token: APPSCRIPT_TOKEN, action: 'download', fileId }),
  })
    .then(res => res.json())
    .then(data => {
      if (!data.ok) throw new Error(data.error || 'No se pudo precargar el archivo');
      const { base64, mimeType, nombre } = data.data;
      const blob = base64ToBlob(base64, mimeType || 'application/pdf');
      return new File([blob], nombre || 'comprobante.pdf', { type: blob.type });
    })
    .catch(() => {
      // Si falla la precarga, no pasa nada: compartirComprobante hace
      // su propio fetch al momento de compartir, como respaldo.
      _cacheArchivosCompartir.delete(fileId);
      return null;
    });

  _cacheArchivosCompartir.set(fileId, promesa);
}

// ── Vista detalle (página completa) ──────────
function initReciboDetalleView(id) {
  const recibo = todosLosRecibos.find(r => r.id === id);
  const cont = document.getElementById('recibo-detalle-cont');
  if (!cont) return;

  if (!recibo) {
    cont.innerHTML = '<p class="recibos-error">Recibo no encontrado.</p>';
    return;
  }

  // Determinar preview del link
  let previewHtml = '';
  if (recibo.link) {
    const url = recibo.link.trim();
    const esImagen = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
    const esPdf    = /\.pdf(\?.*)?$/i.test(url);
    const esDrive  = url.includes('drive.google.com') || url.includes('docs.google.com');

    if (esImagen) {
      previewHtml = `
        <div class="detalle-section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            Comprobante adjunto
          </div>
          <img src="${url}" class="recibo-preview-img" alt="Comprobante"
               onerror="this.style.display='none'" />
          <div class="recibo-preview-acciones">
            <a href="${url}" target="_blank" class="recibo-preview-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Abrir
            </a>
            <button class="recibo-btn-compartir" onclick="compartirComprobante('${url}', this)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Compartir
            </button>
          </div>
        </div>`;
    } else if (esPdf || esDrive) {
      previewHtml = `
        <div class="detalle-section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Comprobante adjunto
          </div>
          <div class="recibo-preview-acciones">
            <a href="${url}" target="_blank" class="recibo-preview-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Abrir
            </a>
            <button class="recibo-btn-compartir" onclick="compartirComprobante('${url}', this)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Compartir
            </button>
          </div>
        </div>`;
    } else {
      previewHtml = `
        <div class="detalle-section">
          <a href="${url}" target="_blank" class="recibo-link-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Ver comprobante
          </a>
        </div>`;
    }

    // Precarga en segundo plano (Samsung Internet fix): así el botón
    // "Compartir" puede llamar a navigator.share() sin awaits previos.
    if (esDrive) {
      const fileIdPrecarga = extraerFileIdDrive(url);
      if (fileIdPrecarga) precargarComprobante(fileIdPrecarga);
    }
  }

  cont.innerHTML = `
    <!-- Encabezado tipo documento -->
    <div class="recibo-doc">

      <div class="recibo-doc-header">
        <div class="recibo-doc-empresa">
          <span class="recibo-doc-logo-text">Guarani Tour</span>
          <span class="recibo-doc-subtitulo">${recibo.es_solidario ? 'Comprobante de donación' : 'Comprobante de pago'}</span>
        </div>
        <div class="recibo-doc-nro-bloque">
          <span class="recibo-doc-nro-label">RECIBO</span>
          <span class="recibo-doc-nro">#${recibo.recibo_nro || recibo.id}</span>
          <span class="recibo-doc-fecha">${recibo.fecha ? formatFechaRecibo(recibo.fecha) : '—'}</span>
        </div>
      </div>

      <div class="recibo-doc-sep"></div>

      <div class="recibo-doc-partes">
        <div class="recibo-doc-parte">
          <span class="recibo-doc-parte-label">Recibido de</span>
          <span class="recibo-doc-parte-nombre">${recibo.cliente || '—'}</span>
          ${recibo.ci ? `<span class="recibo-doc-parte-sub">CI: ${recibo.ci}</span>` : ''}
          ${recibo.correo_beneficiario ? `<span class="recibo-doc-parte-sub">${recibo.correo_beneficiario}</span>` : ''}
        </div>
        <div class="recibo-doc-parte recibo-doc-parte--right">
          <span class="recibo-doc-parte-label">Recibido por</span>
          <span class="recibo-doc-parte-nombre">${recibo.abona_por || '—'}</span>
          ${recibo.usuario ? `<span class="recibo-doc-parte-sub">Reg. por ${recibo.usuario}</span>` : ''}
        </div>
      </div>

      <div class="recibo-doc-monto-bloque">
        <span class="recibo-doc-monto-label">Monto recibido</span>
        <span class="recibo-doc-monto">${recibo.monto != null ? formatGs(recibo.monto) : '—'}</span>
      </div>

      ${recibo.concepto ? `
      <div class="recibo-doc-concepto">
        <span class="recibo-doc-concepto-label">Concepto</span>
        <span class="recibo-doc-concepto-val">${recibo.concepto}</span>
      </div>` : ''}

      <div class="recibo-doc-sep"></div>

      <div class="recibo-doc-pago-info">
        ${recibo.forma_pago ? `
        <div class="recibo-doc-pago-row">
          <span class="recibo-doc-pago-lbl">Forma de pago</span>
          <span class="recibo-metodo-badge recibo-metodo-${slugMetodo(recibo.forma_pago)}">${recibo.forma_pago}</span>
        </div>` : ''}
        ${recibo.banco ? `
        <div class="recibo-doc-pago-row">
          <span class="recibo-doc-pago-lbl">Banco</span>
          <span class="recibo-doc-pago-val">${recibo.banco}</span>
        </div>` : ''}
        ${recibo.comprobante ? `
        <div class="recibo-doc-pago-row">
          <span class="recibo-doc-pago-lbl">Nº Comprobante</span>
          <span class="recibo-doc-pago-val">${recibo.comprobante}</span>
        </div>` : ''}
      </div>

    </div>

    ${previewHtml}`;
}

// ── Vista nuevo recibo (página completa) ──────
async function initReciboNuevoView() {
  // Reset manual de campos
  const ids = ['frec-cliente','frec-monto',
                'frec-concepto','frec-comprobante','frec-banco-input','frec-banco'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Reset CI y correo: vaciar y volver a readonly
  ['frec-ci','frec-correo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.readOnly = true; }
  });
  // Mostrar botones de desbloqueo
  ['btn-unlock-ci','btn-unlock-correo'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = '';
  });

  const selForma = document.getElementById('frec-forma-pago');
  if (selForma) selForma.value = '';

  const selViaje = document.getElementById('frec-abona-por');
  if (selViaje) {
    selViaje.value = '';
    // Enganchamos el listener acá (además del onchange inline) para
    // asegurarnos de que dispare sin importar cómo el custom select
    // termine sincronizando el <select> nativo subyacente.
    selViaje.removeEventListener('change', _onCambioViajeRecibo_listener);
    selViaje.addEventListener('change', _onCambioViajeRecibo_listener);
  }

  // Ocultar/limpiar el bloque de frases rápidas al abrir el form de cero
  const speechesWrap = document.getElementById('frec-speeches-wrap');
  if (speechesWrap) speechesWrap.style.display = 'none';
  const chipsCont = document.getElementById('frec-speeches-chips');
  if (chipsCont) chipsCont.innerHTML = '';
  _viajeIdSeleccionadoRecibo = null;

  // Reset del checkbox "Es donación solidaria" y su efecto en el form
  const chkSolidario = document.getElementById('frec-es-solidario');
  if (chkSolidario) chkSolidario.checked = false;
  onToggleSolidario(false);

  // Ocultar grupo transferencia explícitamente
  const grupo = document.getElementById('frec-grupo-transferencia');
  if (grupo) grupo.style.display = 'none';

  // Fecha de hoy (en horario local, NO usar toISOString() que es UTC
  // y puede devolver el día equivocado según hora/timezone del dispositivo)
  const campoFecha = document.getElementById('frec-fecha');
  if (campoFecha) campoFecha.value = fechaLocalISO();

  const errEl = document.getElementById('form-recibo-error');
  if (errEl) errEl.textContent = '';

  // Cerrar dropdowns si estuvieran abiertos
  ['frec-banco-dropdown','frec-cliente-dropdown'].forEach(id => {
    const dd = document.getElementById(id);
    if (dd) dd.style.display = 'none';
  });

  // Cargar datos
  await Promise.all([cargarViajesActivosEnSelect(), cargarBancosEnSelect(), cargarClientesCache()]);

  initCustomSelect("frec-forma-pago");
  initCustomSelect("frec-abona-por");
}

function toggleCamposTransferencia() {
  const selForma = document.getElementById('frec-forma-pago');
  const grupo    = document.getElementById('frec-grupo-transferencia');
  if (!selForma || !grupo) return;

  const esTransferencia = selForma.value === 'Transferencia';
  grupo.style.display = esTransferencia ? '' : 'none';

  if (!esTransferencia) {
    ['frec-banco-input', 'frec-banco', 'frec-comprobante'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const dd = document.getElementById('frec-banco-dropdown');
    if (dd) dd.style.display = 'none';
  }
}

// ── Autocomplete cliente (basesycondiciones) ──
let _clientesCache = [];

async function cargarClientesCache() {
  if (_clientesCache.length > 0) return; // ya cargado
  const { data, error } = await supabaseClient
    .from('basesycondiciones')
    .select('nombre, ci, email')
    .order('nombre', { ascending: true });
  if (!error && data) _clientesCache = data;
}

function filtrarClientesDropdown(q) {
  const dd = document.getElementById('frec-cliente-dropdown');
  if (!dd) return;
  const termino = q.trim().toLowerCase();
  const resultado = termino
    ? _clientesCache.filter(c => (c.nombre || '').toLowerCase().includes(termino))
    : _clientesCache.slice(0, 8);

  if (resultado.length === 0) {
    dd.innerHTML = '<div class="frec-cliente-dd-item frec-cliente-dd-empty">Sin coincidencias — podés ingresar manualmente</div>';
  } else {
    dd.innerHTML = resultado.map(c => {
      const nombre = (c.nombre || '').replace(/'/g, "\\'");
      const ci     = (c.ci    || '').replace(/'/g, "\\'");
      const email  = (c.email || '').replace(/'/g, "\\'");
      return `<div class="frec-cliente-dd-item" onmousedown="seleccionarCliente('${nombre}','${ci}','${email}')">
        <span class="frec-cliente-dd-nombre">${c.nombre || '—'}</span>
        <span class="frec-cliente-dd-sub">CI: ${c.ci || '—'} · ${c.email || 'sin correo'}</span>
      </div>`;
    }).join('');
  }
  dd.style.display = 'block';
}

function abrirClientesDropdown() {
  const input = document.getElementById('frec-cliente');
  filtrarClientesDropdown(input?.value || '');
}

function cerrarClientesDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('frec-cliente-dropdown');
    if (dd) dd.style.display = 'none';
  }, 150);
}

function seleccionarCliente(nombre, ci, email) {
  const inputNombre = document.getElementById('frec-cliente');
  const inputCi     = document.getElementById('frec-ci');
  const inputCorreo = document.getElementById('frec-correo');
  const dd          = document.getElementById('frec-cliente-dropdown');

  if (inputNombre) inputNombre.value = nombre;

  // CI
  if (inputCi) {
    inputCi.value = ci;
    inputCi.readOnly = !!ci; // readonly si tiene dato, editable si está vacío
  }
  const btnCi = document.getElementById('btn-unlock-ci');
  if (btnCi) btnCi.style.display = ci ? '' : 'none';

  // Correo
  if (inputCorreo) {
    inputCorreo.value = email;
    inputCorreo.readOnly = !!email;
  }
  const btnCorreo = document.getElementById('btn-unlock-correo');
  if (btnCorreo) btnCorreo.style.display = email ? '' : 'none';

  if (dd) dd.style.display = 'none';
}

function desbloquearCampoCliente(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  if (input) { input.readOnly = false; input.focus(); }
  if (btn)   btn.style.display = 'none';
}

// ── Autocomplete banco ────────────────────────
let _bancosRecibosCache = [];

function filtrarBancosDropdown(q) {
  const dd = document.getElementById('frec-banco-dropdown');
  if (!dd) return;
  const termino = q.trim().toLowerCase();
  const resultado = termino
    ? _bancosRecibosCache.filter(b => b.toLowerCase().includes(termino))
    : _bancosRecibosCache;

  if (resultado.length === 0) {
    dd.innerHTML = '<div class="frec-banco-dd-item frec-banco-dd-empty">Sin resultados</div>';
  } else {
    dd.innerHTML = resultado.map(b => {
      const esc = b.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div class="frec-banco-dd-item" onmousedown="seleccionarBanco('${esc}')">${b}</div>`;
    }).join('');
  }
  dd.style.display = 'block';
}

function abrirBancosDropdown() {
  const input = document.getElementById('frec-banco-input');
  filtrarBancosDropdown(input?.value || '');
}

function cerrarBancosDropdown() {
  setTimeout(() => {
    const dd = document.getElementById('frec-banco-dropdown');
    if (dd) dd.style.display = 'none';
  }, 150);
}

function seleccionarBanco(nombre) {
  const input  = document.getElementById('frec-banco-input');
  const hidden = document.getElementById('frec-banco');
  const dd     = document.getElementById('frec-banco-dropdown');
  if (input)  input.value  = nombre;
  if (hidden) hidden.value = nombre;
  if (dd)     dd.style.display = 'none';
}

// Mapa nombre de viaje -> id real (el <select> usa el nombre como value
// porque así se guarda "abona_por" en el recibo; los speeches en cambio
// se asocian por id, así que necesitamos este mapa para resolverlo).
let _viajesRecibosPorNombre = {};

async function cargarViajesActivosEnSelect() {
  const sel = document.getElementById('frec-abona-por');
  if (!sel) return;

  const { data, error } = await supabaseClient
    .from('viajes')
    .select('id, nombre')
    .eq('estado', 'activo')
    .order('nombre', { ascending: true });

  if (error || !data) {
    sel.innerHTML = '<option value="">— Error al cargar —</option>';
    return;
  }

  _viajesRecibosPorNombre = {};
  data.forEach(v => { _viajesRecibosPorNombre[v.nombre] = v.id; });

  sel.innerHTML = '<option value="">— Seleccionar viaje —</option>' +
    data.map(v => `<option value="${v.nombre}">${v.nombre}</option>`).join('');
  refreshCustomSelect('frec-abona-por');
}

/* ── FRASES RÁPIDAS (SPEECHES) POR VIAJE ──────────────────────────────
 * Tabla Supabase: recibo_speeches (id, viaje_id, texto, created_at)
 * Solo admin puede crear/editar/eliminar. Al elegir un viaje en el
 * formulario de recibo, se muestran como chips debajo del select; al
 * tocar uno, reemplaza por completo el contenido del campo Concepto.
 * ────────────────────────────────────────────────────────────────── */
let _viajeIdSeleccionadoRecibo = null;
let _speechesDelViajeCache = [];

function _esAdminRecibos() {
  return Array.isArray(currentUserRole)
    ? currentUserRole.includes('admin')
    : currentUserRole === 'admin';
}

// ── Checkbox "Es una donación solidaria" ──────
// Al tildarse: oculta el bloque de frases rápidas (aunque haya viaje
// elegido) y cambia el label/placeholder del concepto para guiar qué
// escribir. abona_por sigue siendo obligatorio en ambos casos —no se
// toca su validación ni su combo.
let _esRecibosSolidario = false;

function onToggleSolidario(checked) {
  _esRecibosSolidario = checked;

  const wrap  = document.getElementById('frec-speeches-wrap');
  if (wrap) wrap.style.display = 'none';
  const chips = document.getElementById('frec-speeches-chips');
  if (chips) chips.innerHTML = '';

  const label = document.getElementById('frec-concepto-label');
  const campo = document.getElementById('frec-concepto');
  if (label) label.textContent = checked ? 'Motivo de la donación *' : 'Concepto *';
  if (campo) campo.placeholder = checked
    ? 'Ej: Aporte solidario para la campaña de fin de año…'
    : 'Descripción del pago…';
}

// Wrapper con nombre estable para poder hacer removeEventListener antes
// de volver a engancharlo (evita duplicar el listener entre aperturas
// del formulario).
function _onCambioViajeRecibo_listener(ev) {
  onCambioViajeRecibo(ev.target.value);
}

async function onCambioViajeRecibo(nombreViaje) {
  const wrap  = document.getElementById('frec-speeches-wrap');
  const chips = document.getElementById('frec-speeches-chips');
  const btnGestionar = document.getElementById('btn-gestionar-speeches');
  if (!wrap || !chips) return;

  const viajeId = nombreViaje ? _viajesRecibosPorNombre[nombreViaje] : null;
  _viajeIdSeleccionadoRecibo = viajeId || null;

  // Si es donación solidaria, nunca mostramos frases rápidas por viaje:
  // el concepto de una donación se escribe a mano, no se sugiere.
  if (!viajeId || _esRecibosSolidario) {
    wrap.style.display = 'none';
    chips.innerHTML = '';
    return;
  }

  if (btnGestionar) btnGestionar.style.display = _esAdminRecibos() ? '' : 'none';
  wrap.style.display = '';
  chips.innerHTML = '<span class="frec-speeches-vacio">Cargando…</span>';

  await _cargarYRenderSpeechesChips(viajeId);
}

async function _cargarYRenderSpeechesChips(viajeId) {
  const chips = document.getElementById('frec-speeches-chips');
  if (!chips) return;

  const { data, error } = await supabaseClient
    .from('recibo_speeches')
    .select('id, texto')
    .eq('viaje_id', viajeId)
    .order('created_at', { ascending: true });

  if (error) {
    chips.innerHTML = '<span class="frec-speeches-vacio">Error al cargar frases.</span>';
    return;
  }

  _speechesDelViajeCache = data || [];

  if (_speechesDelViajeCache.length === 0) {
    chips.innerHTML = _esAdminRecibos()
      ? '<span class="frec-speeches-vacio">Sin frases guardadas. Tocá "Gestionar" para crear una.</span>'
      : '<span class="frec-speeches-vacio">Sin frases guardadas para este viaje.</span>';
    return;
  }

  chips.innerHTML = _speechesDelViajeCache.map(s => `
    <button type="button" class="frec-speech-chip" onclick="aplicarSpeech(${s.id})">
      ${_escapeHtmlRecibo(s.texto)}
    </button>
  `).join('');
}

function aplicarSpeech(speechId) {
  const speech = _speechesDelViajeCache.find(s => s.id === speechId);
  if (!speech) return;

  const marcadores = _extraerMarcadores(speech.texto);
  if (marcadores.length === 0) {
    const textarea = document.getElementById('frec-concepto');
    if (textarea) textarea.value = speech.texto;
    return;
  }

  _abrirModalCompletarSpeech(speech, marcadores);
}

// Encuentra cada marcador {algo} en el texto, en orden de aparición, sin
// duplicar nombres repetidos (si el mismo marcador aparece dos veces, se
// pide una sola vez y se reemplaza en ambos lugares).
function _extraerMarcadores(texto) {
  const vistos = new Set();
  const encontrados = [];
  const regex = /\{([^{}]+)\}/g;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    if (!vistos.has(m[1])) {
      vistos.add(m[1]);
      encontrados.push(m[1]);
    }
  }
  return encontrados;
}

function _abrirModalCompletarSpeech(speech, marcadores) {
  const modal = document.getElementById('modal-completar-speech');
  const camposWrap = document.getElementById('modal-completar-campos');
  const errEl = document.getElementById('modal-completar-error');
  if (!modal || !camposWrap) return;

  _speechPendienteDeCompletar = speech;

  if (errEl) errEl.textContent = '';
  camposWrap.innerHTML = marcadores.map((marcador, i) => `
    <div class="form-recibo-field">
      <label for="modal-completar-campo-${i}">${_escapeHtmlRecibo(marcador)}</label>
      <input type="text" id="modal-completar-campo-${i}" data-marcador="${_escapeHtmlRecibo(marcador)}"
             placeholder="Valor para «${_escapeHtmlRecibo(marcador)}»" autocomplete="off"
             onkeydown="if(event.key==='Enter'){event.preventDefault();confirmarCompletarSpeech();}" />
    </div>
  `).join('');

  modal.style.display = '';
  // Foco en el primer campo para completar rápido
  setTimeout(() => {
    const primero = document.getElementById('modal-completar-campo-0');
    if (primero) primero.focus();
  }, 50);
}

function cerrarModalCompletarSpeech(event) {
  if (event && event.target.id !== 'modal-completar-speech') return;
  const modal = document.getElementById('modal-completar-speech');
  if (modal) modal.style.display = 'none';
  _speechPendienteDeCompletar = null;
}

function confirmarCompletarSpeech() {
  const errEl = document.getElementById('modal-completar-error');
  const camposWrap = document.getElementById('modal-completar-campos');
  if (!_speechPendienteDeCompletar || !camposWrap) return;

  const inputs = camposWrap.querySelectorAll('input[data-marcador]');
  const valores = {};
  for (const input of inputs) {
    const val = input.value.trim();
    if (!val) {
      if (errEl) errEl.textContent = `Completá el valor para «${input.dataset.marcador}».`;
      input.focus();
      return;
    }
    valores[input.dataset.marcador] = val;
  }

  let textoFinal = _speechPendienteDeCompletar.texto;

  // Reemplazamos cada marcador {var} por el valor cargado. Si ese valor
  // es exactamente 1, además singularizamos la palabra que viene justo
  // después (ej. "pasajes" -> "pasaje"), para que el admin pueda escribir
  // la frase directamente en plural sin sintaxis extra.
  Object.keys(valores).forEach(marcador => {
    const valor = valores[marcador];
    const esUno = parseFloat(valor.replace(',', '.')) === 1;
    // Escapamos el marcador para usarlo en una regex literal
    const escapado = marcador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (esUno) {
      // Capturamos el número + el espacio + la siguiente palabra juntos,
      // para poder singularizar esa palabra en el mismo reemplazo.
      const regexConPalabra = new RegExp(`\\{${escapado}\\}(\\s+)(\\S+)`, 'g');
      textoFinal = textoFinal.replace(regexConPalabra, (match, espacio, palabra) => {
        return valor + espacio + _singularizar(palabra);
      });
    } else {
      textoFinal = textoFinal.replace(new RegExp(`\\{${escapado}\\}`, 'g'), valor);
    }
  });

  const textarea = document.getElementById('frec-concepto');
  if (textarea) textarea.value = textoFinal;

  cerrarModalCompletarSpeech();
}

let _speechPendienteDeCompletar = null;

// Palabras que pluralizan agregando "es" completo (no solo "s") y que
// aparecen habitualmente en conceptos de recibos/viajes. Sin diccionario
// completo del español, cubrimos estos casos por lista; lo que no está
// acá simplemente no se toca (mejor dejarlo en plural que singularizarlo mal).
const _EXCEPCIONES_SINGULAR_ES = [
  'mes', 'avion', 'camion', 'color', 'autobus', 'tren', 'pais',
  'anden', 'frances', 'ingles', 'autocar', 'furgon',
];

// Singularización básica en español para la palabra que sigue a un
// {n}=1 (ej. "pasajes" -> "pasaje", "veces" -> "vez", "meses" -> "mes").
// No es un analizador lingüístico completo: cubre el caso mayoritario
// (vocal + "s") y una lista corta de excepciones conocidas; para todo lo
// demás no toca la palabra, priorizando no romper el texto por sobre
// singularizar perfecto en cualquier caso posible. Preserva mayúscula
// inicial y signos pegados al final (paréntesis, punto, coma).
function _singularizar(palabra) {
  const match = palabra.match(/^(\p{L}+)(.*)$/u);
  if (!match) return palabra;
  const [, letras, resto] = match;
  const esMayuscula = letras[0] === letras[0].toUpperCase();
  const minusc = letras.toLowerCase();

  let singular = null;

  // 1) Excepciones conocidas: raíz + "es" (mes+es, avion+es, etc.)
  for (const raiz of _EXCEPCIONES_SINGULAR_ES) {
    if (minusc === raiz + 'es') { singular = raiz; break; }
  }

  if (singular === null) {
    if (/ces$/.test(minusc) && minusc.length > 4) {
      singular = minusc.slice(0, -3) + 'z';   // veces -> vez, luces -> luz
    } else if (/[aeiou]s$/.test(minusc)) {
      singular = minusc.slice(0, -1);          // pasajes -> pasaje, cuotas -> cuota, boletos -> boleto
    }
  }

  if (singular === null) return palabra; // caso no reconocido: no tocar

  if (esMayuscula) singular = singular.charAt(0).toUpperCase() + singular.slice(1);
  return singular + resto;
}

function _escapeHtmlRecibo(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ── MODAL: GESTIONAR SPEECHES ────────────────────────────────────────── */
function abrirModalSpeeches() {
  if (!_viajeIdSeleccionadoRecibo || !_esAdminRecibos()) return;

  const modal = document.getElementById('modal-speeches');
  const nombreEl = document.getElementById('modal-speeches-viaje-nombre');
  const errEl = document.getElementById('modal-speeches-error');
  const inputEl = document.getElementById('modal-speeches-input');
  if (!modal) return;

  const nombreViaje = document.getElementById('frec-abona-por')?.value || '';
  if (nombreEl) nombreEl.textContent = nombreViaje;
  if (errEl) errEl.textContent = '';
  if (inputEl) inputEl.value = '';

  _renderListaSpeechesModal();
  modal.style.display = '';
}

function cerrarModalSpeeches(event) {
  if (event && event.target.id !== 'modal-speeches') return;
  const modal = document.getElementById('modal-speeches');
  if (modal) modal.style.display = 'none';
}

function _renderListaSpeechesModal() {
  const lista = document.getElementById('modal-speeches-lista');
  if (!lista) return;

  if (_speechesDelViajeCache.length === 0) {
    lista.innerHTML = '<p class="modal-speeches-vacio">Todavía no hay frases para este viaje.</p>';
    return;
  }

  lista.innerHTML = _speechesDelViajeCache.map(s => `
    <div class="modal-speech-item">
      <span class="modal-speech-texto">${_escapeHtmlRecibo(s.texto)}</span>
      <button type="button" class="modal-speech-borrar" onclick="borrarSpeech(${s.id})" title="Eliminar frase">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
      </button>
    </div>
  `).join('');
}

async function agregarSpeech() {
  const errEl = document.getElementById('modal-speeches-error');
  const inputEl = document.getElementById('modal-speeches-input');
  if (errEl) errEl.textContent = '';

  const texto = (inputEl?.value || '').trim();
  if (!texto) {
    if (errEl) errEl.textContent = 'Escribí el texto de la frase.';
    return;
  }
  if (!_viajeIdSeleccionadoRecibo) return;

  const { data, error } = await supabaseClient
    .from('recibo_speeches')
    .insert({ viaje_id: _viajeIdSeleccionadoRecibo, texto })
    .select('id, texto')
    .single();

  if (error) {
    if (errEl) errEl.textContent = 'No se pudo guardar la frase. Intentá de nuevo.';
    return;
  }

  _speechesDelViajeCache.push(data);
  if (inputEl) inputEl.value = '';
  _renderListaSpeechesModal();
  await _cargarYRenderSpeechesChips(_viajeIdSeleccionadoRecibo);
}

async function borrarSpeech(speechId) {
  if (!confirm('¿Eliminar esta frase para este viaje?')) return;

  const { error } = await supabaseClient
    .from('recibo_speeches')
    .delete()
    .eq('id', speechId);

  if (error) {
    const errEl = document.getElementById('modal-speeches-error');
    if (errEl) errEl.textContent = 'No se pudo eliminar. Intentá de nuevo.';
    return;
  }

  _speechesDelViajeCache = _speechesDelViajeCache.filter(s => s.id !== speechId);
  _renderListaSpeechesModal();
  await _cargarYRenderSpeechesChips(_viajeIdSeleccionadoRecibo);
}

async function cargarBancosEnSelect() {
  const { data, error } = await supabaseClient
    .from('bancos')
    .select('banco_id')
    .order('banco_id', { ascending: true });

  if (!error && data) {
    _bancosRecibosCache = data.map(b => b.banco_id);
  }
}

function actualizarPreviewLinkForm(url) {
  const wrap = document.getElementById('frec-link-preview');
  if (!wrap) return;
  url = (url || '').trim();
  if (!url) { wrap.innerHTML = ''; return; }

  const esImagen = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i.test(url);
  const esPdf    = /\.pdf(\?.*)?$/i.test(url);
  const esDrive  = url.includes('drive.google.com') || url.includes('docs.google.com');

  if (esImagen) {
    wrap.innerHTML = `<img src="${url}" class="recibo-preview-img" alt="Preview" onerror="this.style.display='none'" />`;
  } else if (esPdf || esDrive) {
    const embedUrl = esDrive ? url.replace('/view', '/preview').replace('/edit', '/preview') : url;
    wrap.innerHTML = `<iframe src="${embedUrl}" class="recibo-preview-iframe" allowfullscreen></iframe>`;
  } else {
    wrap.innerHTML = `<a href="${url}" target="_blank" class="recibo-preview-link" style="margin-top:.5rem">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Ver enlace
    </a>`;
  }
}

const APPSCRIPT_URL = 'https://script.google.com/macros/s/AKfycby8i_g5g1iG7Yb9xYq34dWv4UIq9CoAszM0sy_uKZfrRIEgGJaGgxAFBFBQ5b7bLAvRUw/exec';
const APPSCRIPT_TOKEN = 'MI_TOKEN_SECRETO'; // ⚠️ debe coincidir con el token en Apps Script

async function guardarNuevoRecibo() {
  const btn = document.getElementById('btn-guardar-recibo');
  const errEl = document.getElementById('form-recibo-error');
  errEl.textContent = '';

  const cliente    = document.getElementById('frec-cliente').value.trim();
  const ci         = document.getElementById('frec-ci').value.trim();
  const correo     = document.getElementById('frec-correo').value.trim();
  const monto      = document.getElementById('frec-monto').value.trim();
  const fecha      = document.getElementById('frec-fecha').value;
  const concepto   = document.getElementById('frec-concepto').value.trim();
  const forma_pago = document.getElementById('frec-forma-pago').value || null;
  const abona_por  = document.getElementById('frec-abona-por').value || null;
  const es_solidario = document.getElementById('frec-es-solidario').checked;

  if (!cliente)                        { errEl.textContent = 'El nombre del cliente es obligatorio.'; return; }
  if (!ci)                             { errEl.textContent = 'El CI es obligatorio.'; return; }
  if (!correo)                         { errEl.textContent = 'El correo es obligatorio.'; return; }
  if (!monto || isNaN(Number(monto)))  { errEl.textContent = 'Ingresá un monto válido.'; return; }
  if (!fecha)                          { errEl.textContent = 'La fecha es obligatoria.'; return; }
  if (!concepto)                       { errEl.textContent = 'El concepto es obligatorio.'; return; }
  if (!forma_pago)                     { errEl.textContent = 'Seleccioná una forma de pago.'; return; }
  if (!abona_por)                      { errEl.textContent = 'Seleccioná el viaje (abona por).'; return; }

  btn.disabled = true;
  btn.textContent = 'Generando recibo…';

  // ── 1. Llamar a Apps Script para generar el PDF ──────────────────────
  let linkPdf = null;
  let recibo_nro = null;

  try {
    const gsPayload = {
      token:       APPSCRIPT_TOKEN,
      cliente,
      monto:       Number(monto),
      fecha,
      ci:          ci,
      concepto:    concepto,
      metodo_pago: forma_pago || '',
      banco:       document.getElementById('frec-banco').value.trim()       || '',
      comprobante: document.getElementById('frec-comprobante').value.trim() || '',
      email:       correo,
      es_solidario, // Apps Script decide la plantilla del PDF/correo según este flag
    };

    const gsRes = await fetch(APPSCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain' }, // Apps Script requiere text/plain para evitar preflight CORS
      body:    JSON.stringify(gsPayload),
    });

    const gsData = await gsRes.json();

    if (!gsData.ok) throw new Error(gsData.error || 'Error en Apps Script');

    linkPdf   = gsData.data.url   || null;
    recibo_nro = gsData.data.recibo || null;

  } catch (e) {
    // Si falla el PDF, preguntamos si igual quiere guardar sin él
    const continuar = confirm(`⚠️ No se pudo generar el PDF del recibo:\n${e.message}\n\n¿Guardar el registro igualmente?`);
    if (!continuar) {
      btn.disabled = false;
      btn.textContent = 'Guardar recibo';
      return;
    }
  }

  // ── 2. Guardar en Supabase ───────────────────────────────────────────
  btn.textContent = 'Guardando…';

  const payload = {
    cliente,
    monto:               Number(monto),
    fecha,
    ci:                  ci                || null,
    correo_beneficiario: correo            || null,
    concepto:            concepto          || null,
    forma_pago,
    banco:               document.getElementById('frec-banco').value.trim()       || null,
    comprobante:         document.getElementById('frec-comprobante').value.trim() || null,
    abona_por:           abona_por,
    es_solidario,
    usuario:             currentUserName || null,
    link:                linkPdf || null,
    ...(recibo_nro && { recibo_nro }),
  };

  const { error } = await supabaseClient.from('recibos').insert([payload]);

  btn.disabled = false;
  btn.textContent = 'Guardar recibo';

  if (error) {
    errEl.textContent = 'Error al guardar: ' + error.message;
    return;
  }

  if (linkPdf) mostrarToastRecibo('✅ Recibo generado y guardado');
  navigateTo('recibos');
}

// ── Búsqueda / filtro ─────────────────────────
function filtrarRecibos() {
  const q = document.getElementById('recibos-search').value.trim().toLowerCase();
  if (!q) {
    recibosFiltrados = [...todosLosRecibos];
  } else {
    recibosFiltrados = todosLosRecibos.filter(r =>
      (r.cliente    || '').toLowerCase().includes(q) ||
      (r.ci         || '').toLowerCase().includes(q) ||
      (r.abona_por  || '').toLowerCase().includes(q) ||
      (r.concepto   || '').toLowerCase().includes(q) ||
      (r.recibo_nro || '').toString().includes(q)    ||
      (r.forma_pago || '').toLowerCase().includes(q)
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

// Devuelve la fecha de HOY como 'YYYY-MM-DD' usando los componentes
// locales del dispositivo (no UTC). new Date().toISOString() convierte
// a UTC internamente y puede devolver el día anterior o siguiente según
// la hora y el timezone configurado — por eso no se usa acá.
function fechaLocalISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatFechaRecibo(f) {
  if (!f) return '—';
  const d = new Date(f + 'T00:00:00');
  const hoy = new Date();
  const opciones = d.getFullYear() === hoy.getFullYear()
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  return d.toLocaleDateString('es-PY', opciones);
}

function inicialRecibo(nombre) {
  return (nombre || '?').charAt(0).toUpperCase();
}

function slugMetodo(m) {
  return (m || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

// ── Compartir comprobante ─────────────────────

// Convierte base64 → Blob por chunks, más eficiente para archivos grandes que atob() directo a un solo array
function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteArrays = [];

  for (let offset = 0; offset < byteChars.length; offset += 512) {
    const slice = byteChars.slice(offset, offset + 512);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: mimeType });
}

function extraerFileIdDrive(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function compartirComprobante(url, btn) {
  const esDrive = url.includes('drive.google.com') || url.includes('docs.google.com');
  const fileId  = esDrive ? extraerFileIdDrive(url) : null;

  const textoOriginal = btn ? btn.innerHTML : null;
  function ponerCargando() {
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('recibo-btn-compartir--cargando');
    btn.innerHTML = '<span class="recibo-spinner" aria-hidden="true"></span> Preparando…';
  }
  function restaurarBoton() {
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove('recibo-btn-compartir--cargando');
    btn.innerHTML = textoOriginal;
  }

  // Intentar compartir como archivo real (PDF/imagen) vía Web Share API
  if (fileId && navigator.share && navigator.canShare) {
    try {
      // Camino feliz: el archivo ya se precargó al abrir el detalle
      // (ver precargarComprobante), así que acá solo esperamos esa
      // promesa — que normalmente ya está resuelta. Esto es clave en
      // Samsung Internet: navigator.share() con archivos exige poco
      // o ningún await entre el click y el share, o descarta el
      // "user activation" y tira NotAllowedError.
      let archivo = null;
      const cacheado = _cacheArchivosCompartir.get(fileId);
      if (cacheado) archivo = await cacheado;

      if (!archivo) {
        // Respaldo: no hubo precarga a tiempo (recibo viejo abierto
        // hace rato, o la precarga falló). Pedimos el archivo ahora,
        // mostrando el estado de carga — en este caso puede fallar en
        // Samsung Internet por el mismo motivo, pero sigue funcionando
        // en Chrome y cae al fallback de link de forma segura en todos.
        ponerCargando();
        const gsRes = await fetch(APPSCRIPT_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'text/plain' },
          body:    JSON.stringify({ token: APPSCRIPT_TOKEN, action: 'download', fileId }),
        });
        const gsData = await gsRes.json();
        if (!gsData.ok) throw new Error(gsData.error || 'No se pudo obtener el archivo');
        const { base64, mimeType, nombre } = gsData.data;
        const blob = base64ToBlob(base64, mimeType || 'application/pdf');
        archivo = new File([blob], nombre || 'comprobante.pdf', { type: blob.type });
      }

      if (navigator.canShare({ files: [archivo] })) {
        restaurarBoton();
        await navigator.share({ files: [archivo], title: 'Comprobante' });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') { restaurarBoton(); return; } // usuario canceló el share sheet
      // Cualquier otro error (Apps Script caído, sin permiso, archivo muy grande, etc.): caer al fallback de link
    } finally {
      restaurarBoton();
    }
  }

  // Fallback 1: compartir el link (Drive sin fileId reconocible, u origen no-Drive)
  if (navigator.share) {
    try {
      await navigator.share({ url, title: 'Comprobante' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  // Fallback 2: copiar al portapapeles
  try {
    await navigator.clipboard.writeText(url);
    mostrarToastRecibo('Link copiado al portapapeles');
  } catch (e) {
    mostrarToastRecibo('No se pudo compartir');
  }
}

function mostrarToastRecibo(msg) {
  let t = document.getElementById('recibo-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'recibo-toast';
    t.className = 'recibo-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('recibo-toast--visible');
  setTimeout(() => t.classList.remove('recibo-toast--visible'), 2500);
}
