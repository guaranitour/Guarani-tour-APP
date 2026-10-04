// contacto-emergencia.js — FAB SOS + modal de contacto de emergencia del pasajero.
// Extraído de app.js; usa globals de app.js (allPassengers, currentUserRole, etc.).

// ── Contacto de emergencia (FAB SOS + modal) ─────────────────
let _contactoActual = null; // fila actual en memoria, o null si no existe
let _contactoCiActual = null; // CI (normalizado) del pasajero del modal abierto, o null sin CI
let _fabSosUltimoFoco = null; // elemento a devolver el foco al cerrar el modal

// Deja solo dígitos: mismo criterio con el que se guarda "ci" en
// reservas.bases_info_adicional. Se aplica siempre antes de comparar,
// porque "Documento de Identidad" en pasajeros puede venir con puntos,
// espacios o guiones según cómo lo haya tipeado quien cargó el registro.
function normalizeCI(ci) {
  return (ci || "").toString().replace(/\D+/g, "");
}

function _puedeEditarContacto() {
  return ["admin", "worker"].some(r =>
    Array.isArray(currentUserRole) ? currentUserRole.includes(r) : currentUserRole === r
  );
}

// Permiso para "Enviar link" de contacto de emergencia: más amplio que
// _puedeEditarContacto() (que solo cubre Editar/Guardar/Agregar), porque
// el RPC reservas.generar_link_contacto_emergencia también acepta
// 'viewer'. Generar y compartir un link no implica poder editar el
// contacto directamente, así que se mantiene como chequeo aparte.
function _puedeEnviarLinkContacto() {
  return ["admin", "worker", "viewer"].some(r =>
    Array.isArray(currentUserRole) ? currentUserRole.includes(r) : currentUserRole === r
  );
}

// Muestra u oculta el FAB SOS según la vista activa. Se llama al entrar
// y salir de "Detalle de pasajero".
function setFabSosVisible(visible) {
  const fab = document.getElementById("fab-sos");
  if (fab) fab.style.display = visible ? "" : "none";
}

function abrirModalContacto() {
  const modal = document.getElementById("modal-contacto");
  if (!modal) return;
  _fabSosUltimoFoco = document.activeElement;
  if (typeof modal.showModal === "function") {
    modal.showModal();
  } else {
    // Fallback para navegadores sin soporte de <dialog>
    modal.setAttribute("open", "");
  }
  // Foco inicial: primer control interactivo relevante visible.
  const focoInicial =
    modal.querySelector("#contacto-fields-edit:not([style*='display: none']) input, " +
                         "#contacto-empty:not([style*='display: none']) button, " +
                         ".modal-sos-close");
  if (focoInicial) focoInicial.focus();
}

function cerrarModalContacto() {
  const modal = document.getElementById("modal-contacto");
  if (!modal) return;
  if (typeof modal.close === "function" && modal.open) {
    modal.close();
  } else {
    modal.removeAttribute("open");
  }
  if (_fabSosUltimoFoco && typeof _fabSosUltimoFoco.focus === "function") {
    _fabSosUltimoFoco.focus();
  }
  _fabSosUltimoFoco = null;
}

// El cierre con tecla Esc dispara el evento "close" nativo del <dialog>
// sin pasar por cerrarModalContacto(): devolvemos el foco igual en ese caso.
document.addEventListener("DOMContentLoaded", () => {
  const modalSos = document.getElementById("modal-contacto");
  if (!modalSos) return;
  modalSos.addEventListener("close", () => {
    if (_fabSosUltimoFoco && typeof _fabSosUltimoFoco.focus === "function") {
      _fabSosUltimoFoco.focus();
    }
    _fabSosUltimoFoco = null;
  });
});

async function cargarContactoEmergencia(pasajero) {
  const puede = _puedeEditarContacto();
  const puedeLink = _puedeEnviarLinkContacto();

  document.getElementById("contacto-fields-view").style.display = "";
  document.getElementById("contacto-fields-edit").style.display = "none";
  document.getElementById("contacto-empty").style.display = "none";
  document.getElementById("contacto-edit-actions").style.display = "none";
  document.getElementById("contacto-edit-feedback").style.display = "none";

  const ci = normalizeCI(pasajero?.["Documento de Identidad"]);
  _contactoCiActual = ci || null; // usado por generarYCompartirLinkContacto()

  const btnLink = document.getElementById("btn-link-contacto");

  // Sin CI no hay forma de vincular con bases_info_adicional, ni de
  // generar un link (el RPC también lo necesita).
  if (!ci) {
    _contactoActual = null;
    document.getElementById("contacto-fields-view").style.display = "none";
    document.getElementById("contacto-empty").style.display = "";
    const btnEditar  = document.getElementById("btn-editar-contacto");
    const btnAgregar = document.getElementById("btn-agregar-contacto");
    if (btnEditar)  btnEditar.style.display  = "none";
    if (btnAgregar) btnAgregar.style.display = "none"; // sin CI tampoco se puede crear
    if (btnLink)    btnLink.style.display    = "none";
    return;
  }

  // Puede haber más de un formulario cargado para el mismo CI (se puede
  // completar el form varias veces): nos quedamos con el más reciente.
  const { data, error } = await supabaseClient
    .schema("reservas")
    .from("bases_info_adicional")
    .select("*")
    .eq("ci", ci)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Error al cargar contacto de emergencia:", error);
  }

  _contactoActual = data || null;

  const btnEditar  = document.getElementById("btn-editar-contacto");
  const btnAgregar = document.getElementById("btn-agregar-contacto");

  // "Enviar link" está disponible con CI presente, haya o no datos
  // cargados todavía (sirve tanto para completar por primera vez como
  // para reenviar y que actualice lo ya cargado).
  if (btnLink) btnLink.style.display = puedeLink ? "" : "none";

  if (_contactoActual) {
    setField("c-nombre",      _contactoActual.contacto_emergencia_nombre);
    setField("c-telefono",    _contactoActual.contacto_emergencia_telefono);
    setField("c-parentesco",  _contactoActual.contacto_emergencia_parentesco);

    const obsWrap = document.getElementById("c-observaciones-wrap");
    if (_contactoActual.observaciones) {
      setField("c-observaciones", _contactoActual.observaciones);
      obsWrap.style.display = "";
    } else {
      obsWrap.style.display = "none";
    }

    document.getElementById("contacto-fields-view").style.display = "";
    document.getElementById("contacto-empty").style.display = "none";
    if (btnEditar) btnEditar.style.display = puede ? "" : "none";
  } else {
    document.getElementById("contacto-fields-view").style.display = "none";
    document.getElementById("contacto-empty").style.display = "";
    if (btnEditar)  btnEditar.style.display  = "none";
    if (btnAgregar) btnAgregar.style.display = puede ? "" : "none";
  }
}

function activarEdicionContacto() {
  if (!_puedeEditarContacto()) return;

  document.getElementById("ce-nombre").value        = _contactoActual?.contacto_emergencia_nombre || "";
  document.getElementById("ce-telefono").value       = _contactoActual?.contacto_emergencia_telefono || "";
  document.getElementById("ce-parentesco").value     = _contactoActual?.contacto_emergencia_parentesco || "";
  document.getElementById("ce-observaciones").value  = _contactoActual?.observaciones || "";
  if (typeof initCustomSelect === "function") {
    initCustomSelect("ce-parentesco");
    refreshCustomSelect("ce-parentesco");
  }

  document.getElementById("contacto-fields-view").style.display  = "none";
  document.getElementById("contacto-empty").style.display        = "none";
  document.getElementById("contacto-fields-edit").style.display  = "";
  document.getElementById("contacto-view-actions").style.display = "none";
  document.getElementById("contacto-edit-actions").style.display = "";
  document.getElementById("contacto-edit-feedback").style.display = "none";

  document.getElementById("ce-nombre").focus();
}

function cancelarEdicionContacto() {
  document.getElementById("contacto-fields-edit").style.display  = "none";
  document.getElementById("contacto-edit-actions").style.display = "none";
  document.getElementById("contacto-edit-feedback").style.display = "none";
  document.getElementById("contacto-view-actions").style.display = "";

  const puede = _puedeEditarContacto();
  if (_contactoActual) {
    document.getElementById("contacto-fields-view").style.display = "";
    const btnEditar = document.getElementById("btn-editar-contacto");
    if (btnEditar) btnEditar.style.display = puede ? "" : "none";
  } else {
    document.getElementById("contacto-empty").style.display = "";
    const btnAgregar = document.getElementById("btn-agregar-contacto");
    if (btnAgregar) btnAgregar.style.display = puede ? "" : "none";
  }
}

async function guardarContactoEmergencia() {
  const p = allPassengers.find(x => x.id === selectedIdx);
  if (!p) return;

  const ci = normalizeCI(p["Documento de Identidad"]);
  if (!ci) {
    mostrarFeedbackContacto("Este pasajero no tiene CI cargado; no se puede vincular el contacto.", false);
    return;
  }

  const nombre   = document.getElementById("ce-nombre").value.trim();
  const telefono = document.getElementById("ce-telefono").value.trim();

  if (!nombre || !telefono) {
    mostrarFeedbackContacto("Completá nombre y celular.", false);
    return;
  }

  const btn = document.getElementById("btn-guardar-contacto");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const payload = {
    ci,
    contacto_emergencia_nombre:      nombre,
    contacto_emergencia_telefono:    telefono,
    contacto_emergencia_parentesco:  document.getElementById("ce-parentesco").value || null,
    observaciones:                   document.getElementById("ce-observaciones").value.trim() || null,
  };

  let error;
  if (_contactoActual) {
    ({ error } = await supabaseClient
      .schema("reservas")
      .from("bases_info_adicional")
      .update(payload)
      .eq("id", _contactoActual.id));
  } else {
    ({ error } = await supabaseClient
      .schema("reservas")
      .from("bases_info_adicional")
      .insert(payload));
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar contacto`;

  if (error) {
    console.error("Error al guardar contacto de emergencia:", error);
    mostrarFeedbackContacto("Error al guardar. Intentá de nuevo.", false);
    return;
  }

  await cargarContactoEmergencia(p);
  mostrarFeedbackContacto("Contacto guardado correctamente.", true);
}

/**
 * Genera un link personalizado (vía RPC reservas.generar_link_contacto_
 * emergencia) para que el pasajero complete/actualice su propio contacto
 * de emergencia desde contacto-emergencia.html, sin necesitar sesión.
 * El RPC vive en el schema "reservas" (igual que bases_info_adicional),
 * distinto del "public" que usa el resto de esta app por default.
 *
 * Al obtener el link, se intenta compartir directo con la Web Share API
 * (mismo patrón ya usado para compartir la imagen de ranking de Club
 * Destino) para que el usuario elija WhatsApp u otra app desde el
 * selector nativo, sin necesitar el celular del pasajero acá. Si el
 * navegador no soporta share(), se copia al portapapeles como respaldo.
 */
async function generarYCompartirLinkContacto() {
  if (!_contactoCiActual) {
    mostrarFeedbackContacto("Este pasajero no tiene CI cargado; no se puede generar el link.", false);
    return;
  }

  const btn = document.getElementById("btn-link-contacto");
  const textoOriginal = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "Generando…";
  }

  try {
    const { data, error } = await supabaseClient
      .schema("reservas")
      .rpc("generar_link_contacto_emergencia", { p_ci: _contactoCiActual });

    if (error) throw error;

    const link = data;
    const pasajero = allPassengers.find(x => x.id === selectedIdx);
    const nombreCompleto = pasajero?.["Pasajero"] || "";
    const primerNombre = nombreCompleto.trim().split(/\s+/)[0] || ""; // solo nombre de pila, sin apellido
    const mensaje = `Hola${primerNombre ? " " + primerNombre : ""}, te compartimos un link para completar o actualizar tu contacto de emergencia, que tendremos como referencia para acompañarte y cuidarte durante tus experiencias con Destino Guarani.\n\n👉 ${link}\n\n¡Gracias!`;

    if (navigator.share) {
      try {
        await navigator.share({ text: mensaje });
      } catch (shareErr) {
        // AbortError = el usuario cerró el selector sin elegir nada; no es un error real.
        if (shareErr && shareErr.name !== "AbortError") {
          console.error("Error al compartir:", shareErr);
        }
      }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(mensaje);
      mostrarFeedbackContacto("Link copiado al portapapeles.", true);
    } else {
      mostrarFeedbackContacto("No se pudo compartir automáticamente. Copiá este link: " + link, false);
    }
  } catch (err) {
    console.error("Error al generar link de contacto de emergencia:", err);
    mostrarFeedbackContacto("No se pudo generar el link. Intentá de nuevo.", false);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = textoOriginal;
    }
  }
}

function mostrarFeedbackContacto(msg, ok) {
  const el = document.getElementById("contacto-edit-feedback");
  el.textContent = msg;
  el.style.display = "";
  el.style.background = ok ? "#f0faf4" : "#fff0f0";
  el.style.color      = ok ? "#2d6a4f" : "#c0392b";
  el.style.border     = ok ? "1px solid rgba(45,106,79,.2)" : "1px solid rgba(192,57,43,.2)";
  if (ok) setTimeout(() => { el.style.display = "none"; }, 3000);
}
