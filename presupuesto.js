/* ─────────────────────────────────────────────
   presupuesto.js — Presupuesto por viaje
   Depende de: viajeActualId, currentUserRole,
   supabaseClient (global)
───────────────────────────────────────────── */

/* ── PRESUPUESTO ───────────────────────────── */

let _presupuestoCategorias = [];   // caché de categorías globales
let _presupuestoOriginal   = {};   // { categoria_id: monto } al cargar para detectar cambios
let _presupuestoModoEdicion = false;

async function loadPresupuesto(viajeId) {
  const listEl  = document.getElementById("presupuesto-list");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const formEl  = document.getElementById("form-presupuesto");
  if (!listEl) return;

  listEl.innerHTML = `<div class="viaje-pasajeros-empty">Cargando…</div>`;
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
  if (formEl)  formEl.style.display  = "none";

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  // Traer presupuesto guardado + categorías en paralelo
  const [{ data: filas, error }, { data: globales }, { data: locales }] = await Promise.all([
    supabaseClient
      .from("presupuesto_viaje")
      .select("id, categoria_id, monto_presupuestado")
      .eq("viaje_id", viajeId),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true }),
    supabaseClient
      .from("categorias")
      .select("id, nombre")
      .eq("scope", parseInt(viajeId))
      .order("nombre", { ascending: true })
  ]);

  if (error) {
    listEl.innerHTML = `<div class="viaje-pasajeros-empty">Error al cargar presupuesto.</div>`;
    return;
  }

  _presupuestoCategorias = [...(globales || []), ...(locales || [])];

  const hayPresupuesto = filas && filas.length > 0;

  if (!hayPresupuesto) {
    listEl.innerHTML = `
      <div class="viaje-pasajeros-empty">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Sin presupuesto registrado
      </div>`;
    if (btnReg && esWorkerOAdmin) btnReg.style.display = "";
    return;
  }

  // Hay presupuesto — construir mapa para renderizar
  const catMap = Object.fromEntries(_presupuestoCategorias.map(c => [c.id, c.nombre]));
  _presupuestoOriginal = {};
  filas.forEach(f => { _presupuestoOriginal[f.categoria_id] = f.monto_presupuestado; });

  const total = filas.reduce((s, f) => s + (f.monto_presupuestado || 0), 0);

  listEl.innerHTML = `
    <div class="egresos-total-row" style="margin-bottom:.85rem">
      <span class="egresos-total-label">Total presupuestado</span>
      <span class="egresos-total-valor">Gs. ${total.toLocaleString("es-PY")}</span>
    </div>
    ${filas.map(f => `
    <div class="egreso-row">
      <div class="egreso-info">
        <div class="egreso-concepto">${catMap[f.categoria_id] || "—"}</div>
      </div>
      <div class="egreso-monto" style="color:var(--accent)">
        Gs. ${(f.monto_presupuestado || 0).toLocaleString("es-PY")}
      </div>
    </div>`).join("")}
  `;

  if (btnEdit && esAdmin) btnEdit.style.display = "";
}

function confirmarEditarPresupuesto() {
  const advertencia = document.getElementById("presupuesto-advertencia");
  if (advertencia) {
    advertencia.remove();
    mostrarFormPresupuesto(true);
    return;
  }

  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const warn = document.createElement("div");
  warn.id = "presupuesto-advertencia";
  warn.className = "presupuesto-advertencia";
  warn.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    Estás por editar un presupuesto ya registrado. Los cambios reemplazarán los valores actuales.
    <div class="presupuesto-adv-actions">
      <button class="btn-cancel" onclick="this.closest('#presupuesto-advertencia').remove()">Cancelar</button>
      <button class="btn-save" onclick="this.closest('#presupuesto-advertencia').remove(); mostrarFormPresupuesto(true)">Continuar</button>
    </div>
  `;
  if (btnEdit) btnEdit.after(warn);
}

async function mostrarFormPresupuesto(esEdicion) {
  _presupuestoModoEdicion = esEdicion;

  const formEl    = document.getElementById("form-presupuesto");
  const fieldsEl  = document.getElementById("presupuesto-form-fields");
  const btnReg    = document.getElementById("btn-registrar-presupuesto");
  const btnEdit   = document.getElementById("btn-editar-presupuesto");
  if (!formEl || !fieldsEl) return;

  // Cargar categorías si no están en caché
  if (_presupuestoCategorias.length === 0) {
    const { data } = await supabaseClient
      .from("categorias")
      .select("id, nombre")
      .is("scope", null)
      .order("nombre", { ascending: true });
    _presupuestoCategorias = data || [];
  }

  fieldsEl.innerHTML = `
    <p class="presupuesto-form-hint">Completá los montos por categoría. Las categorías sin monto serán ignoradas.</p>
    <div class="detail-grid">
      ${_presupuestoCategorias.map(c => {
        const valorPrevio = _presupuestoOriginal[c.id] || "";
        return `
        <div class="form-field">
          <label class="form-label">${c.nombre}</label>
          <input type="number" class="form-input presupuesto-input"
                 data-cat-id="${c.id}" min="0" placeholder="0"
                 value="${valorPrevio}" />
        </div>`;
      }).join("")}
    </div>`;

  formEl.style.display = "";
  if (btnReg)  btnReg.style.display  = "none";
  if (btnEdit) btnEdit.style.display = "none";
}

function cerrarFormPresupuesto() {
  const formEl  = document.getElementById("form-presupuesto");
  const btnReg  = document.getElementById("btn-registrar-presupuesto");
  const btnEdit = document.getElementById("btn-editar-presupuesto");
  const advertencia = document.getElementById("presupuesto-advertencia");

  if (formEl)       formEl.style.display  = "none";
  if (advertencia)  advertencia.remove();

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";
  const esWorkerOAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.some(r => ["admin","worker"].includes(r))
    : ["admin","worker"].includes(currentUserRole);

  const hayPresupuesto = Object.keys(_presupuestoOriginal).length > 0;
  if (btnReg)  btnReg.style.display  = (!hayPresupuesto && esWorkerOAdmin) ? "" : "none";
  if (btnEdit) btnEdit.style.display = (hayPresupuesto && esAdmin) ? "" : "none";
}

async function guardarPresupuesto() {
  const inputs = document.querySelectorAll(".presupuesto-input");
  const btn    = document.getElementById("btn-guardar-presupuesto");

  // Construir filas a upsert: solo las que tienen monto > 0
  const filas = [];
  inputs.forEach(input => {
    const catId = parseInt(input.dataset.catId);
    const monto = parseInt(input.value) || 0;
    if (monto > 0) {
      filas.push({
        viaje_id:            viajeActualId,
        categoria_id:        catId,
        monto_presupuestado: monto
      });
    }
  });

  if (filas.length === 0) {
    inputs[0]?.classList.add("error");
    return;
  }

  // En modo edición: detectar cambios y solo upsert los que cambiaron
  let filasAGuardar = filas;
  if (_presupuestoModoEdicion) {
    filasAGuardar = filas.filter(f => {
      const original = _presupuestoOriginal[f.categoria_id];
      return !original || original !== f.monto_presupuestado;
    });

    // Categorías que tenían monto y ahora quedaron vacías → eliminar
    const catIdsNuevos = new Set(filas.map(f => f.categoria_id));
    const aEliminar = Object.keys(_presupuestoOriginal).filter(id => !catIdsNuevos.has(id));
    if (aEliminar.length > 0) {
      await supabaseClient
        .from("presupuesto_viaje")
        .delete()
        .eq("viaje_id", viajeActualId)
        .in("categoria_id", aEliminar);
    }

    if (filasAGuardar.length === 0) {
      cerrarFormPresupuesto();
      loadPresupuesto(viajeActualId);
      return;
    }
  }

  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { error } = await supabaseClient
    .from("presupuesto_viaje")
    .upsert(filasAGuardar, { onConflict: "viaje_id,categoria_id" });

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar`;
  }

  if (error) {
    console.error("Error guardando presupuesto:", error);
    alert("Error al guardar. Revisá los datos e intentá de nuevo.");
    return;
  }

  cerrarFormPresupuesto();
  loadPresupuesto(viajeActualId);
}

async function agregarCatExtra() {
  const input = document.getElementById("input-cat-extra");
  if (!input) return;

  const nombre = input.value.trim();
  if (!nombre) {
    input.classList.add("error");
    input.focus();
    return;
  }
  input.classList.remove("error");

  // Deshabilitar el botón mientras se guarda
  const btn = input.nextElementSibling;
  if (btn) { btn.disabled = true; btn.textContent = "Agregando…"; }

  // Insertar categoría local (scope = viajeActualId)
  const { data: nueva, error } = await supabaseClient
    .from("categorias")
    .insert([{ nombre, scope: viajeActualId }])
    .select("id, nombre")
    .single();

  if (btn) { btn.disabled = false; btn.textContent = "+ Agregar"; }

  if (error) {
    console.error("Error al crear categoría extra:", JSON.stringify(error));
    alert("Error: " + (error.message || error.details || JSON.stringify(error)));
    return;
  }

  // Agregar al caché local
  _presupuestoCategorias.push(nueva);

  // Agregar el campo al grid del formulario
  const grid = document.querySelector("#presupuesto-form-fields .detail-grid");
  if (grid) {
    const div = document.createElement("div");
    div.className = "form-field";
    div.innerHTML = `
      <label class="form-label">${nueva.nombre}</label>
      <input type="number" class="form-input presupuesto-input"
             data-cat-id="${nueva.id}" min="0" placeholder="0" value="" />`;
    grid.appendChild(div);
  }

  // Limpiar el input y enfocar el nuevo campo
  input.value = "";
  const nuevoInput = document.querySelector(`.presupuesto-input[data-cat-id="${nueva.id}"]`);
  if (nuevoInput) nuevoInput.focus();
}
