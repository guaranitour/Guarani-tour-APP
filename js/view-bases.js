// ============================================================
// view-bases.js — Bases y Condiciones: landing + wizard (3 pasos) + confirmación
// ============================================================
// Paso 1 inserta en "basesycondiciones" (nombre, ci, email) con
// estado_envio = null (pendiente de procesar). El PDF/email y el estado
// final ("aceptado" / "aceptado_sin_correo") los completa un proceso
// aparte más adelante.
// Paso 2 (cumpleaños + contacto de emergencia) va a la tabla nueva
// "bases_info_adicional", vinculada por CI — ver Api.guardarInfoAdicional.
// Ambos inserts se disparan juntos recién al confirmar el Paso 3, para no
// dejar registros a medio completar si la persona abandona el flujo.

const BASES_STEP_COUNT = 3;
const BASES_STEP_TITLES = {
  1: 'Datos personales',
  2: 'Información adicional',
  3: 'Bases y condiciones'
};

// Controla qué sub-pantalla de view-bases está activa, para que el botón
// "volver" del header y las guardas del router sepan a dónde ir sin
// depender de leer clases .hidden del DOM.
// 'landing' | 1 | 2 | 3 | 'confirmed'
let _basesStep = 'landing';

const PARENTESCO_OPCIONES = ['Madre', 'Padre', 'Hermano/a', 'Pareja', 'Hijo/a', 'Amigo/a', 'Otro'];

/** El wizard solo puede reabrirse directo por URL si ya se llegó a él en
 *  esta sesión (evita un GET directo mostrando un formulario "suelto"). */
function _canShowBasesForm() {
  return typeof _basesStep === 'number' || _basesStep === 'confirmed';
}

/** La confirmación nunca es bookmarkeable: solo existe justo después de
 *  un submit exitoso, nunca por recarga o link directo. */
function _canShowBasesConfirmed() {
  return _basesStep === 'confirmed';
}

function _showBasesCard(id) {
  ['basesLanding', 'basesFormCard', 'basesConfirmedCard'].forEach(cardId => {
    const el = document.getElementById(cardId);
    if (el) el.classList.toggle('hidden', cardId !== id);
  });
}

/** Muestra la pantalla 1 (landing) dentro de view-bases. */
function goBasesLanding() {
  _basesStep = 'landing';
  _showBasesCard('basesLanding');
}

/** Muestra un paso del wizard (1, 2 o 3), actualizando header de progreso,
 *  visibilidad de fieldsets y los botones de navegación inferiores. */
function goBasesStep(step) {
  _basesStep = step;
  _showBasesCard('basesFormCard');

  for (let i = 1; i <= BASES_STEP_COUNT; i++) {
    const fieldset = document.getElementById('basesStep' + i);
    if (fieldset) fieldset.classList.toggle('hidden', i !== step);
  }

  const titleEl = document.getElementById('basesStepTitle');
  const countEl = document.getElementById('basesStepCount');
  const fillEl = document.getElementById('basesProgressFill');
  if (titleEl) titleEl.textContent = BASES_STEP_TITLES[step] || '';
  if (countEl) countEl.textContent = `Paso ${step} de ${BASES_STEP_COUNT}`;
  if (fillEl) fillEl.style.width = ((step / BASES_STEP_COUNT) * 100) + '%';

  const nextBtn = document.getElementById('basesStepNextBtn');
  const submitBtn = document.getElementById('basesSubmitBtn');
  const isLastStep = step === BASES_STEP_COUNT;
  if (nextBtn) nextBtn.classList.toggle('hidden', isLastStep);
  if (submitBtn) submitBtn.classList.toggle('hidden', !isLastStep);

  if (step === 1) _populateBirthDays();
  setHash(['Bases y condiciones', 'Formulario']);
}

/** Muestra la pantalla de confirmación dentro de view-bases. */
function goBasesConfirmed() {
  _basesStep = 'confirmed';
  _showBasesCard('basesConfirmedCard');
  setHash(['Bases y condiciones', 'Confirmacion']);
}

// ── Paso 1: datos personales ──

/** Alterna el checkbox "No dispongo de correo electrónico": deshabilita
 *  y vacía el campo de email en vez de ocultarlo (el email pasó a ser
 *  siempre visible en el Paso 1, según el nuevo flujo). */
function toggleBasesNoEmail(checked) {
  const emailInput = document.getElementById('basesEmail');
  if (emailInput) {
    emailInput.disabled = checked;
    if (checked) {
      emailInput.value = '';
      markField(emailInput, false);
    }
  }
  // El aviso de "instrucciones sin correo" vive en el Paso 3, pero refleja
  // la elección hecha en el Paso 1 — se sincroniza acá mismo.
  const noCorreoNotice = document.getElementById('basesNoCorreoNotice');
  if (noCorreoNotice) noCorreoNotice.classList.toggle('hidden', !checked);
}

function _isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

/** Valida los campos del paso 1. Devuelve true si puede avanzar. */
function _validateBasesStep1() {
  const nombreEl = document.getElementById('basesNombre');
  const ciEl = document.getElementById('basesCi');
  const emailEl = document.getElementById('basesEmail');
  const noEmailEl = document.getElementById('basesNoEmail');

  const nombre = nombreEl.value.trim();
  const ci = ciEl.value.trim();
  const sinCorreo = noEmailEl.checked;
  const email = emailEl.value.trim();

  let ok = true;
  if (!nombre) { markField(nombreEl, true); ok = false; } else { markField(nombreEl, false); }
  if (!ci) { markField(ciEl, true); ok = false; } else { markField(ciEl, false); }

  // El email es obligatorio salvo que se haya marcado "no dispongo de correo".
  if (!sinCorreo) {
    if (!_isValidEmail(email)) { markField(emailEl, true); ok = false; }
    else { markField(emailEl, false); }
  }

  if (!ok) toast('Revisá los datos marcados en rojo');
  return ok;
}

// ── Paso 2: información adicional ──

/** Llena el <select> de día según el mes elegido (28-31 días); si no hay
 *  mes elegido aún, muestra 1-31 para no bloquear la selección de día
 *  primero. El año se fija en 2000 (bisiesto) al momento de guardar. */
function _populateBirthDays() {
  const daySel = document.getElementById('basesBirthDay');
  const monthSel = document.getElementById('basesBirthMonth');
  if (!daySel || !monthSel) return;

  const month = parseInt(monthSel.value, 10) || null;
  const daysInMonth = month ? new Date(2000, month, 0).getDate() : 31;
  const current = daySel.value;

  daySel.innerHTML = '<option value="">Día</option>' +
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
      .map(d => `<option value="${d}">${d}</option>`).join('');

  // Conserva el día elegido si sigue siendo válido para el nuevo mes.
  if (current && Number(current) <= daysInMonth) daySel.value = current;
}

/** Valida los campos del paso 2. Cumpleaños es opcional; contacto,
 *  teléfono y parentesco son obligatorios. */
function _validateBasesStep2() {
  const contactoEl = document.getElementById('basesContactoNombre');
  const telefonoEl = document.getElementById('basesContactoTelefono');
  const parentescoEl = document.getElementById('basesParentesco');
  const parentescoTrigger = document.getElementById('basesParentescoTrigger');

  const contacto = contactoEl.value.trim();
  const telefono = telefonoEl.value.trim();
  const parentesco = parentescoEl.value.trim();

  let ok = true;
  if (!contacto) { markField(contactoEl, true); ok = false; } else { markField(contactoEl, false); }
  if (!telefono) { markField(telefonoEl, true); ok = false; } else { markField(telefonoEl, false); }
  if (!parentesco) {
    parentescoTrigger.classList.add('field-error');
    ok = false;
  } else {
    parentescoTrigger.classList.remove('field-error');
  }

  if (!ok) toast('Completá el contacto de emergencia para continuar');
  return ok;
}

// ── Bottom-sheet: parentesco ──

function openParentescoSheet() {
  const sheet = document.getElementById('parentescoSheet');
  const optionsWrap = document.getElementById('parentescoSheetOptions');
  if (!sheet || !optionsWrap) return;

  const current = document.getElementById('basesParentesco').value;
  optionsWrap.innerHTML = PARENTESCO_OPCIONES.map(opt => `
    <button class="floor-sheet-option${opt === current ? ' selected' : ''}" onclick="selectParentesco('${opt}')" type="button">${opt}</button>
  `).join('');

  sheet.classList.add('show');
}

function closeParentescoSheet() {
  const sheet = document.getElementById('parentescoSheet');
  if (sheet) sheet.classList.remove('show');
}

function selectParentesco(opt) {
  const hiddenEl = document.getElementById('basesParentesco');
  const labelEl = document.getElementById('basesParentescoLabel');
  const triggerEl = document.getElementById('basesParentescoTrigger');
  if (hiddenEl) hiddenEl.value = opt;
  if (labelEl) labelEl.textContent = opt;
  if (triggerEl) triggerEl.classList.remove('field-error');
  closeParentescoSheet();
}

// ── Navegación del wizard ──

/** Botón "Continuar": valida el paso actual y, si es válido, avanza. */
function basesStepNext() {
  if (AppState.busy) return;
  if (_basesStep === 1 && !_validateBasesStep1()) return;
  if (_basesStep === 2 && !_validateBasesStep2()) return;
  goBasesStep(_basesStep + 1);
}

/** Botón "volver" del header: dentro del wizard retrocede un paso; en el
 *  paso 1 vuelve a la landing; en la landing o ya confirmado, sale a
 *  Reservas (no tiene sentido reabrir el flujo después de haber aceptado). */
function _basesGoBack() {
  if (typeof _basesStep === 'number' && _basesStep > 1) {
    basesStepBack();
  } else if (_basesStep === 1) {
    goBasesLanding();
    setHash(['Bases y condiciones']);
    _resetBasesForm();
  } else {
    backToChoose();
  }
}

/** Botón "Volver" inferior del wizard: retrocede un paso sin re-validar. */
function basesStepBack() {
  if (typeof _basesStep !== 'number') return;
  if (_basesStep === 1) {
    goBasesLanding();
    setHash(['Bases y condiciones']);
    _resetBasesForm();
    return;
  }
  goBasesStep(_basesStep - 1);
}

/** Valida y envía el formulario completo: insert en basesycondiciones +
 *  insert en bases_info_adicional. Se llama solo desde el Paso 3. */
async function submitBasesForm(ev) {
  ev.preventDefault();
  if (AppState.busy) return false;

  // Por seguridad, si por algún motivo se llega al submit sin pasar por
  // los pasos anteriores (ej. Enter en un campo), re-validamos todo.
  if (!_validateBasesStep1()) { goBasesStep(1); return false; }
  if (!_validateBasesStep2()) { goBasesStep(2); return false; }

  const confirmLeidoEl = document.getElementById('basesConfirmLeido');
  const confirmLeidoRow = document.getElementById('basesConfirmLeidoRow');
  const leyoBases = confirmLeidoEl.checked;

  if (!leyoBases) {
    confirmLeidoRow.classList.add('field-error-row');
    toast('Tenés que confirmar que leíste las Bases y Condiciones');
    return false;
  }
  confirmLeidoRow.classList.remove('field-error-row');

  const nombre = document.getElementById('basesNombre').value.trim();
  const ci = document.getElementById('basesCi').value.trim();
  const sinCorreo = document.getElementById('basesNoEmail').checked;
  const email = document.getElementById('basesEmail').value.trim();

  const birthDay = document.getElementById('basesBirthDay').value;
  const birthMonth = document.getElementById('basesBirthMonth').value;
  // Año fijo en 2000 (bisiesto, cubre 29/02) — solo importa día/mes.
  const cumpleanos = (birthDay && birthMonth)
    ? `2000-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}`
    : null;

  const contactoNombre = document.getElementById('basesContactoNombre').value.trim();
  const contactoTelefono = document.getElementById('basesContactoTelefono').value.trim();
  const parentesco = document.getElementById('basesParentesco').value.trim();

  const btn = document.getElementById('basesSubmitBtn');
  AppState.busy = true;
  if (btn) btn.disabled = true;
  showLoading('Enviando…');

  try {
    await Api.aceptarBasesYCondiciones({
      nombre,
      ci,
      email_disponible: sinCorreo ? 'NO' : 'SI',
      email: sinCorreo ? null : email
    });

    await Api.guardarInfoAdicional({
      ci,
      cumpleanos,
      contacto_emergencia_nombre: contactoNombre,
      contacto_emergencia_telefono: contactoTelefono,
      contacto_emergencia_parentesco: parentesco
    });

    _setBasesConfirmedEmailNotice(!sinCorreo);
    goBasesConfirmed();
  } catch (err) {
    console.error(err);
    toast('No se pudo enviar. Probá de nuevo en un momento.');
  } finally {
    AppState.busy = false;
    if (btn) btn.disabled = false;
    hideLoading();
  }

  return false;
}

/** Ajusta el texto del aviso de correo en la confirmación según si la
 *  persona cargó email o no (sin correo, no tiene sentido decirle que
 *  "revise su bandeja de entrada"). */
function _setBasesConfirmedEmailNotice(tieneCorreo) {
  const textEl = document.getElementById('basesConfirmedEmailText');
  if (!textEl) return;
  textEl.textContent = tieneCorreo
    ? 'Te enviamos un correo con la información registrada para que tengas una copia. Si no lo recibiste, o ingresaste un correo incorrecto, contactá a tu agente e indicale que completaste la aceptación, así podrá facilitarte el PDF por WhatsApp.'
    : 'Como no registraste un correo, contactá a tu agente e indicale que completaste la aceptación: así podrá facilitarte el PDF por WhatsApp.';
}

/** Resetea el formulario a su estado inicial (se llama al volver a la landing). */
function _resetBasesForm() {
  const form = document.getElementById('basesFormCard');
  if (!form) return;
  form.reset();

  ['basesNombre', 'basesCi', 'basesEmail', 'basesContactoNombre', 'basesContactoTelefono'].forEach(id => {
    const el = document.getElementById(id);
    if (el) markField(el, false);
  });

  const confirmLeidoRow = document.getElementById('basesConfirmLeidoRow');
  if (confirmLeidoRow) confirmLeidoRow.classList.remove('field-error-row');

  const emailInput = document.getElementById('basesEmail');
  if (emailInput) emailInput.disabled = false;

  const noCorreoNotice = document.getElementById('basesNoCorreoNotice');
  if (noCorreoNotice) noCorreoNotice.classList.add('hidden');

  const parentescoTrigger = document.getElementById('basesParentescoTrigger');
  if (parentescoTrigger) parentescoTrigger.classList.remove('field-error');
  const parentescoLabel = document.getElementById('basesParentescoLabel');
  if (parentescoLabel) parentescoLabel.textContent = 'Seleccionar…';
  const parentescoHidden = document.getElementById('basesParentesco');
  if (parentescoHidden) parentescoHidden.value = '';
}

function _clearBasesConfirmError() {
  const row = document.getElementById('basesConfirmLeidoRow');
  if (row) row.classList.remove('field-error-row');
}

window.goBasesLanding = goBasesLanding;
window.goBasesStep = goBasesStep;
window._populateBirthDays = _populateBirthDays;
window.goBasesConfirmed = goBasesConfirmed;
window.toggleBasesNoEmail = toggleBasesNoEmail;
window.basesStepNext = basesStepNext;
window.basesStepBack = basesStepBack;
window.openParentescoSheet = openParentescoSheet;
window.closeParentescoSheet = closeParentescoSheet;
window.selectParentesco = selectParentesco;
window._canShowBasesForm = _canShowBasesForm;
window._canShowBasesConfirmed = _canShowBasesConfirmed;
window.submitBasesForm = submitBasesForm;
window._basesGoBack = _basesGoBack;
window._clearBasesConfirmError = _clearBasesConfirmError;
window._resetBasesForm = _resetBasesForm;
