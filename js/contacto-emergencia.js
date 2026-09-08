// ============================================================
// contacto-emergencia.js — Página pública standalone (sin sesión)
// ============================================================
// No forma parte del router.js del SPA principal: esta página vive
// aparte (contacto-emergencia.html) y solo es alcanzable con un link
// que incluya un token válido (?t=...), generado desde Base de Clientes
// vía el RPC reservas.generar_link_contacto_emergencia().
//
// Toda la comunicación con la base pasa por 2 funciones RPC
// (SECURITY DEFINER): esta página nunca hace SELECT/INSERT directo
// sobre las tablas — ver contacto_emergencia_links.sql para el porqué.

const PARENTESCO_OPCIONES = ['Madre', 'Padre', 'Hermano/a', 'Pareja', 'Hijo/a', 'Amigo/a', 'Otro'];

let _token = null;

function getToken() {
  const params = new URLSearchParams(location.search);
  return (params.get('t') || '').trim();
}

function showState(id) {
  ['stateLoading', 'stateInvalid', 'stateForm', 'stateDone'].forEach(stateId => {
    const el = document.getElementById(stateId);
    if (el) el.classList.toggle('hidden', stateId !== id);
  });
}

function toast(msg) {
  const bar = document.getElementById('snackbar');
  if (!bar) return;
  bar.textContent = msg;
  bar.classList.add('show');
  setTimeout(() => bar.classList.remove('show'), 2800);
}

function onlyDigits(el) {
  el.value = el.value.replace(/\D+/g, '');
}

function markField(el, isInvalid) {
  if (!el) return;
  if (isInvalid) {
    el.classList.add('field-error');
    el.addEventListener('input', function clearError() {
      el.classList.remove('field-error');
      el.removeEventListener('input', clearError);
    });
  } else {
    el.classList.remove('field-error');
  }
}

// ── Cumpleaños: día/mes con año fijo 2000 (bisiesto, cubre 29/02) ──
// Mismo criterio que el paso 2 de Bases y Condiciones: el año no importa,
// solo se usa para poder calcular cuántos días tiene cada mes.

function _populateBirthDays() {
  const daySel = document.getElementById('fBirthDay');
  const monthSel = document.getElementById('fBirthMonth');
  if (!daySel || !monthSel) return;

  const month = parseInt(monthSel.value, 10) || null;
  const daysInMonth = month ? new Date(2000, month, 0).getDate() : 31;
  const current = daySel.value;

  daySel.innerHTML = '<option value="">Día</option>' +
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
      .map(d => `<option value="${d}">${d}</option>`).join('');

  if (current && Number(current) <= daysInMonth) daySel.value = current;
}

/** Separa una fecha 'YYYY-MM-DD' guardada en cumpleanos y carga los
 *  selects de día/mes. El año se ignora (siempre es el fijo 2000). */
function _precargarCumpleanos(fechaIso) {
  if (!fechaIso) return;
  const partes = String(fechaIso).split('-'); // ['2000', 'MM', 'DD']
  if (partes.length !== 3) return;
  const mes = parseInt(partes[1], 10);
  const dia = parseInt(partes[2], 10);

  const monthSel = document.getElementById('fBirthMonth');
  if (monthSel && mes) monthSel.value = String(mes);
  _populateBirthDays();
  const daySel = document.getElementById('fBirthDay');
  if (daySel && dia) daySel.value = String(dia);
}

/** Arma 'YYYY-MM-DD' (año fijo 2000) a partir de los selects, o null si
 *  no se completó ninguno (el cumpleaños es opcional acá). */
function _getCumpleanosSeleccionado() {
  const dia = document.getElementById('fBirthDay').value;
  const mes = document.getElementById('fBirthMonth').value;
  if (!dia || !mes) return null;
  return `2000-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// ── Bottom-sheet: parentesco ──

function openParentescoSheet() {
  const sheet = document.getElementById('parentescoSheet');
  const optionsWrap = document.getElementById('parentescoOptions');
  if (!sheet || !optionsWrap) return;

  const current = document.getElementById('fParentesco').value;
  optionsWrap.innerHTML = '';
  PARENTESCO_OPCIONES.forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sheet-option' + (opt === current ? ' selected' : '');
    btn.textContent = opt;
    btn.addEventListener('click', () => selectParentesco(opt));
    optionsWrap.appendChild(btn);
  });

  sheet.classList.add('show');
}

function closeParentescoSheet() {
  const sheet = document.getElementById('parentescoSheet');
  if (sheet) sheet.classList.remove('show');
}

function selectParentesco(opt) {
  document.getElementById('fParentesco').value = opt;
  document.getElementById('parentescoLabel').textContent = opt;
  document.getElementById('parentescoTrigger').classList.remove('field-error');
  closeParentescoSheet();
}

// ── Precarga de datos existentes (si ya había un contacto cargado) ──

function _precargar(row) {
  if (!row) return;

  // Identidad: siempre se muestra si vino del link (nombre puede faltar
  // si el pasajero no estaba en public.pasajeros al generar el link).
  const nombreEl = document.getElementById('identityNombre');
  const ciEl = document.getElementById('identityCi');
  if (nombreEl) nombreEl.textContent = row.nombre || '—';
  if (ciEl) ciEl.textContent = row.ci || '—';

  _precargarCumpleanos(row.cumpleanos);

  if (row.contacto_emergencia_nombre) document.getElementById('fNombre').value = row.contacto_emergencia_nombre;
  if (row.contacto_emergencia_telefono) document.getElementById('fTelefono').value = row.contacto_emergencia_telefono;
  if (row.contacto_emergencia_parentesco) selectParentesco(row.contacto_emergencia_parentesco);
}

// ── Validación del formulario ──

function _validarForm() {
  const nombreEl = document.getElementById('fNombre');
  const telefonoEl = document.getElementById('fTelefono');
  const parentescoEl = document.getElementById('fParentesco');
  const parentescoTrigger = document.getElementById('parentescoTrigger');

  const nombre = nombreEl.value.trim();
  const telefono = telefonoEl.value.trim();
  const parentesco = parentescoEl.value.trim();

  let ok = true;
  if (!nombre) { markField(nombreEl, true); ok = false; } else { markField(nombreEl, false); }
  if (!telefono) { markField(telefonoEl, true); ok = false; } else { markField(telefonoEl, false); }
  if (!parentesco) { parentescoTrigger.classList.add('field-error'); ok = false; }
  else { parentescoTrigger.classList.remove('field-error'); }

  if (!ok) toast('Completá todos los campos para continuar');
  return ok;
}

// ── Envío ──

async function submitContacto(ev) {
  ev.preventDefault();
  if (!_validarForm()) return false;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const { data, error } = await supabase.rpc('guardar_contacto_emergencia_por_token', {
      p_token: _token,
      p_nombre: document.getElementById('fNombre').value.trim(),
      p_telefono: document.getElementById('fTelefono').value.trim(),
      p_parentesco: document.getElementById('fParentesco').value.trim(),
      p_cumpleanos: _getCumpleanosSeleccionado()
    });

    if (error) throw error;

    showState('stateDone');
  } catch (err) {
    console.error('[submitContacto]', err);
    toast('No se pudo guardar. Probá de nuevo en un momento.');
    btn.disabled = false;
    btn.textContent = 'Guardar contacto';
  }

  return false;
}

// ── Arranque: validar token y decidir qué mostrar ──

async function init() {
  _token = getToken();

  if (!_token) {
    showState('stateInvalid');
    return;
  }

  try {
    const { data, error } = await supabase.rpc('validar_token_contacto_emergencia', { p_token: _token });
    if (error) throw error;

    // El RPC devuelve una tabla (array); una sola fila siempre.
    const row = Array.isArray(data) ? data[0] : data;

    if (!row || !row.valido) {
      showState('stateInvalid');
      return;
    }

    _precargar(row);
    showState('stateForm');
  } catch (err) {
    console.error('[init]', err);
    showState('stateInvalid');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('contactoForm').addEventListener('submit', submitContacto);
  document.getElementById('fTelefono').addEventListener('input', function () { onlyDigits(this); });
  document.getElementById('parentescoTrigger').addEventListener('click', openParentescoSheet);
  document.getElementById('parentescoCancelBtn').addEventListener('click', closeParentescoSheet);
  document.getElementById('fBirthMonth').addEventListener('change', _populateBirthDays);
  _populateBirthDays();
  init();
});
