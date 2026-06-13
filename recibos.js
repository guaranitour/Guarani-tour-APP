// ══════════════════════════════════════════════
//  MÓDULO RECIBOS
// ══════════════════════════════════════════════

let todosLosRecibos = [];
let recibosFiltrados = [];

// ── Cargar y renderizar lista ─────────────────
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

  document.getElementById('recibos-count').textContent =
    lista.length === 1 ? '1 recibo' : `${lista.length} recibos`;

  if (lista.length === 0) {
    cont.innerHTML = '<div class="recibos-empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg><p>No se encontraron recibos</p></div>';
    return;
  }

  const grupos = {};
  for (const r of lista) {
    const clave = r.abona_por || '(Sin vendedor)';
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(r);
  }

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
    <div class="recibo-card" onclick="navigateTo('recibo-detalle', ${r.id})">
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
            <button class="recibo-btn-compartir" onclick="compartirComprobante('${url}')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
              Compartir
            </button>
          </div>
        </div>`;
    } else if (esPdf || esDrive) {
      const embedUrl = esDrive
        ? url.replace('/view', '/preview').replace('/edit', '/preview')
        : url;
      previewHtml = `
        <div class="detalle-section">
          <div class="section-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Comprobante adjunto
          </div>
          <iframe src="${embedUrl}" class="recibo-preview-iframe" allowfullscreen></iframe>
          <div class="recibo-preview-acciones">
            <a href="${url}" target="_blank" class="recibo-preview-link">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Abrir
            </a>
            <button class="recibo-btn-compartir" onclick="compartirComprobante('${url}')">
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
  }

  cont.innerHTML = `
    <!-- Encabezado tipo documento -->
    <div class="recibo-doc">

      <div class="recibo-doc-header">
        <div class="recibo-doc-empresa">
          <span class="recibo-doc-logo-text">Guarani Tour</span>
          <span class="recibo-doc-subtitulo">Comprobante de pago</span>
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
function initReciboNuevoView() {
  const form = document.getElementById('form-recibo-nuevo');
  if (form) form.reset();
  const hoy = new Date().toISOString().split('T')[0];
  const campoFecha = document.getElementById('frec-fecha');
  if (campoFecha) campoFecha.value = hoy;
  const errEl = document.getElementById('form-recibo-error');
  if (errEl) errEl.textContent = '';
  actualizarPreviewLinkForm('');
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

async function guardarNuevoRecibo() {
  const btn = document.getElementById('btn-guardar-recibo');
  const errEl = document.getElementById('form-recibo-error');
  errEl.textContent = '';

  const cliente = document.getElementById('frec-cliente').value.trim();
  const monto   = document.getElementById('frec-monto').value.trim();
  const fecha   = document.getElementById('frec-fecha').value;

  if (!cliente) { errEl.textContent = 'El nombre del cliente es obligatorio.'; return; }
  if (!monto || isNaN(Number(monto))) { errEl.textContent = 'Ingresá un monto válido.'; return; }
  if (!fecha) { errEl.textContent = 'La fecha es obligatoria.'; return; }

  const payload = {
    cliente,
    monto:               Number(monto),
    fecha,
    ci:                  document.getElementById('frec-ci').value.trim()        || null,
    correo_beneficiario: document.getElementById('frec-correo').value.trim()    || null,
    concepto:            document.getElementById('frec-concepto').value.trim()  || null,
    forma_pago:          document.getElementById('frec-forma-pago').value       || null,
    banco:               document.getElementById('frec-banco').value.trim()     || null,
    comprobante:         document.getElementById('frec-comprobante').value.trim() || null,
    abona_por:           document.getElementById('frec-abona-por').value.trim() || null,
    link:                document.getElementById('frec-link').value.trim()      || null,
  };

  btn.disabled = true;
  btn.textContent = 'Guardando…';

  const { error } = await supabaseClient.from('recibos').insert([payload]);

  btn.disabled = false;
  btn.textContent = 'Guardar recibo';

  if (error) {
    errEl.textContent = 'Error al guardar: ' + error.message;
    return;
  }

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

// ── Compartir comprobante ─────────────────────
async function compartirComprobante(url) {
  const esDrive = url.includes('drive.google.com') || url.includes('docs.google.com');

  // Intentar compartir como archivo PDF
  if (navigator.share && navigator.canShare) {
    try {
      mostrarToastRecibo('Descargando archivo…');

      // Para Drive: convertir la URL a descarga directa
      let fetchUrl = url;
      if (esDrive) {
        const matchId = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        if (matchId) {
          fetchUrl = `https://drive.google.com/uc?export=download&id=${matchId[1]}`;
        }
      }

      const response = await fetch(fetchUrl);
      if (!response.ok) throw new Error('No se pudo descargar el archivo');

      const blob = await response.blob();
      const tipo = blob.type || 'application/pdf';
      const extension = tipo.includes('pdf') ? '.pdf' : tipo.includes('image') ? '.jpg' : '';
      const nombreArchivo = `comprobante${extension}`;
      const archivo = new File([blob], nombreArchivo, { type: tipo });

      if (navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: 'Comprobante' });
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') return; // usuario canceló
      // Si falla la descarga o canShare, caer al fallback de link
    }
  }

  // Fallback 1: compartir link
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
