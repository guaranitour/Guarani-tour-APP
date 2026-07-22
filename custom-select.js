/* ═══════════════════════════════════════════════════════════
   custom-select.js — Select con diseño propio
   • ≤ 6 opciones → Dropdown animado
   • >  6 opciones → Bottom sheet con buscador

   USO:
     initCustomSelect("mi-select-id")

   Compatible con:
     - select.value  (sigue funcionando igual)
     - onchange=     (se dispara el evento 'change' nativo)
     - .error        (se propaga al trigger visual)
     - Opciones dinámicas (llamar refreshCustomSelect("id") después de cambiar el <select>)
     - Dark mode (usa variables CSS del sistema)
   ═══════════════════════════════════════════════════════════ */

const CUSTOM_SELECT_THRESHOLD = 6; // ≤ este número → dropdown, > → bottom sheet

// Registro de instancias para poder refrescarlas
const _csInstances = {};

// Contador de sheets abiertos para manejar el historial del SPA
let _csSheetOpen = false;

/**
 * Inicializa el custom select para un <select> existente por su ID.
 * Puede llamarse múltiples veces en el mismo ID (idempotente).
 */
function initCustomSelect(selectId, opts = {}) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.tagName !== "SELECT") return;

  // Evitar doble inicialización
  if (sel._csInit) {
    refreshCustomSelect(selectId);
    return;
  }

  // Ocultar el select nativo
  sel.classList.add("cs-native-hidden");
  sel._csInit = true;

  // Crear trigger visual
  const trigger = document.createElement("div");
  trigger.className = "cs-trigger";
  trigger.setAttribute("tabindex", "0");
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const triggerText = document.createElement("span");
  triggerText.className = "cs-trigger-text";

  const chevron = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevron.setAttribute("class", "cs-chevron");
  chevron.setAttribute("width", "16");
  chevron.setAttribute("height", "16");
  chevron.setAttribute("viewBox", "0 0 24 24");
  chevron.setAttribute("fill", "none");
  chevron.setAttribute("stroke", "currentColor");
  chevron.setAttribute("stroke-width", "2");
  chevron.innerHTML = `<path d="m6 9 6 6 6-6"/>`;

  trigger.appendChild(triggerText);
  trigger.appendChild(chevron);

  // Insertar trigger justo antes del select en el DOM
  sel.parentNode.insertBefore(trigger, sel);

  // Sincronizar estado visual con el select
  function syncTrigger() {
    const selectedOpt = sel.options[sel.selectedIndex];
    if (selectedOpt && selectedOpt.value !== "") {
      triggerText.textContent = selectedOpt.text;
      triggerText.classList.remove("cs-placeholder");
    } else {
      triggerText.textContent = opts.placeholder || selectedOpt?.text || "Seleccionar…";
      triggerText.classList.add("cs-placeholder");
    }
    // Propagar clase .error si el select nativo la tiene
    trigger.classList.toggle("cs-error", sel.classList.contains("error"));
  }

  syncTrigger();

  // Observar cambios de clase .error en el select nativo
  const errorObserver = new MutationObserver(() => {
    trigger.classList.toggle("cs-error", sel.classList.contains("error"));
  });
  errorObserver.observe(sel, { attributes: true, attributeFilter: ["class"] });

  // Estado del popup abierto
  let activePopup = null;

  function openSelect() {
    if (sel.disabled) return;
    const options = Array.from(sel.options);
    const useSheet = options.length > CUSTOM_SELECT_THRESHOLD;
    activePopup = useSheet
      ? _openSheet(sel, trigger, options, onSelect, closeSelect)
      : _openDropdown(sel, trigger, options, onSelect);
    trigger.classList.add("cs-open");
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeSelect() {
    if (activePopup) {
      activePopup.close();
      activePopup = null;
    }
    trigger.classList.remove("cs-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  function onSelect(value) {
    sel.value = value;
    // Disparar evento change nativo para que onchange= y listeners funcionen
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    syncTrigger();
    closeSelect();
  }

  // Eventos del trigger
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activePopup) closeSelect();
    else openSelect();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSelect(); }
    if (e.key === "Escape") closeSelect();
  });

  // Sincronizar si el valor del select cambia desde JS externo
  sel.addEventListener("change", syncTrigger);

  // Guardar instancia (incluyendo closeSelect para popstate)
  _csInstances[selectId] = { sel, trigger, syncTrigger, closeSelect };
}

/**
 * Refresca el trigger de un custom select ya inicializado.
 * Usar después de cambiar las opciones dinámicamente (.innerHTML = ...).
 */
function refreshCustomSelect(selectId) {
  const inst = _csInstances[selectId];
  if (inst) inst.syncTrigger();
}

/* ── Dropdown (≤ 6 opciones) ─────────────────────────────── */
function _openDropdown(sel, trigger, options, onSelect) {
  const rect = trigger.getBoundingClientRect();

  const dropdown = document.createElement("div");
  dropdown.className = "cs-dropdown";
  dropdown.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
  `;

  // Si se sale de la pantalla por abajo, abrirlo hacia arriba
  const spaceBelow = window.innerHeight - rect.bottom;
  const estimatedHeight = options.length * 46;
  if (spaceBelow < estimatedHeight && rect.top > estimatedHeight) {
    dropdown.style.top = "";
    dropdown.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    dropdown.style.transformOrigin = "bottom center";
  }

  options.forEach(opt => {
    const item = document.createElement("div");
    item.className = "cs-dropdown-option" + (opt.value === sel.value ? " cs-selected" : "");
    item.dataset.value = opt.value;

    const label = document.createElement("span");
    label.textContent = opt.text;
    item.appendChild(label);

    if (opt.value === sel.value) {
      const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      check.setAttribute("class", "cs-option-check");
      check.setAttribute("width", "16");
      check.setAttribute("height", "16");
      check.setAttribute("viewBox", "0 0 24 24");
      check.setAttribute("fill", "none");
      check.setAttribute("stroke", "currentColor");
      check.setAttribute("stroke-width", "2.5");
      check.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
      item.appendChild(check);
    }

    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelect(opt.value);
    });

    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);

  function onOutsideClick(e) {
    if (!dropdown.contains(e.target) && e.target !== trigger) {
      close();
    }
  }
  setTimeout(() => document.addEventListener("click", onOutsideClick), 10);

  function close() {
    dropdown.remove();
    document.removeEventListener("click", onOutsideClick);
  }

  return { close };
}

/* ── Bottom Sheet (> 6 opciones) ─────────────────────────── */
function _openSheet(sel, trigger, options, onSelect, onClose) {
  // Label del campo para el título del sheet
  const label = trigger.closest(".form-field")?.querySelector(".form-label")?.textContent?.trim()
    || trigger.closest("div")?.previousElementSibling?.textContent?.trim()
    || "Seleccionar";

  // Overlay
  const overlay = document.createElement("div");
  overlay.className = "cs-overlay";

  // Sheet
  const sheet = document.createElement("div");
  sheet.className = "cs-sheet";
  sheet.innerHTML = `
    <div class="cs-sheet-handle"></div>
    <div class="cs-sheet-header">
      <span class="cs-sheet-title">${label}</span>
      <button class="cs-sheet-close" aria-label="Cerrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cs-sheet-search-wrap">
      <input class="cs-sheet-search" type="text" placeholder="Buscar…" autocomplete="off"
             readonly onfocus="this.removeAttribute('readonly')" />
    </div>
    <div class="cs-sheet-list"></div>
  `;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const listEl   = sheet.querySelector(".cs-sheet-list");
  const searchEl = sheet.querySelector(".cs-sheet-search");
  const closeBtn = sheet.querySelector(".cs-sheet-close");

  // FIX 2: Pushear estado falso al historial para interceptar el botón atrás
  _csSheetOpen = true;
  history.pushState({ csSheet: true }, "");

  // Render opciones filtradas
  function renderOptions(query = "") {
    const q = query.toLowerCase().trim();
    const filtered = options.filter(o => !q || o.text.toLowerCase().includes(q));

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="cs-sheet-empty">Sin resultados</div>`;
      return;
    }

    listEl.innerHTML = "";
    filtered.forEach(opt => {
      const item = document.createElement("div");
      item.className = "cs-sheet-option" + (opt.value === sel.value ? " cs-selected" : "");

      const labelEl = document.createElement("span");
      labelEl.className = "cs-sheet-option-label";
      labelEl.textContent = opt.text;
      item.appendChild(labelEl);

      if (opt.value === sel.value) {
        const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        check.setAttribute("class", "cs-sheet-option-check");
        check.setAttribute("width", "16");
        check.setAttribute("height", "16");
        check.setAttribute("viewBox", "0 0 24 24");
        check.setAttribute("fill", "none");
        check.setAttribute("stroke", "currentColor");
        check.setAttribute("stroke-width", "2.5");
        check.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
        item.appendChild(check);
      }

      item.addEventListener("click", () => onSelect(opt.value));
      listEl.appendChild(item);
    });
  }

  renderOptions();

  // FIX 1: NO hacer focus automático — el usuario toca el campo si quiere buscar
  // Solo quitar readonly al tocar, para que el teclado aparezca cuando el usuario lo pide

  searchEl.addEventListener("input", () => renderOptions(searchEl.value));

  // Scroll al elemento seleccionado
  requestAnimationFrame(() => {
    const selected = listEl.querySelector(".cs-selected");
    if (selected) selected.scrollIntoView({ block: "center" });
  });

  function close() {
    if (!overlay.isConnected) return;
    sheet.classList.add("cs-closing");
    overlay.classList.add("cs-closing");
    _csSheetOpen = false;
    setTimeout(() => overlay.remove(), 200);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPopState);
    if (onClose) onClose();
  }

  // FIX 2: Interceptar botón atrás del navegador/SPA
  function onPopState(e) {
    if (_csSheetOpen) {
      close();
      // No dejar que el popstate llegue al SPA — ya consumimos la entrada del historial
      e.stopImmediatePropagation();
    }
  }
  window.addEventListener("popstate", onPopState);

  closeBtn.addEventListener("click", () => {
    // Si cerramos con el botón, limpiar la entrada del historial que pusheamos
    if (_csSheetOpen) history.back();
    // El close real lo dispara onPopState
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      if (_csSheetOpen) history.back();
    }
  });

  function onKey(e) {
    if (e.key === "Escape") {
      if (_csSheetOpen) history.back();
    }
  }
  document.addEventListener("keydown", onKey);

  return { close };
}
