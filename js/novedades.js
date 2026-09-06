/* ─────────────────────────────────────────────
   novedades.js — Novedades Guaraní Tour App
   Slide narrativo con los últimos cambios de la app
───────────────────────────────────────────── */

// Subir esta versión cada vez que se cargan slides nuevos: cambia la key
// de localStorage, así que todos vuelven a ver el modal aunque ya hayan
// cerrado una tanda anterior.
const _NOV_VERSION = "lista-acordeon-v1";

// ── Roles habilitados para esta tanda de novedades ────────────────────
// Todos los ítems de esta versión son relevantes solo para quienes
// operan la app día a día: admin, worker y finanzas. "viewer" queda
// afuera de esta tanda completa.
const _NOV_ROLES_TANDA = ["admin", "worker", "finanzas"];

// ── Novedades ──────────────────────────────────────────────────────────
// "roles": opcional por ítem. Si no está presente, hereda _NOV_ROLES_TANDA.
// Si está, reemplaza esa lista para ese ítem puntual.
const _NOV_ITEMS = [
  {
    etiqueta: "Legales",
    titulo: "Documentos de índole legal",
    resumen: "Ya podés ver y cargar documentos legales y de asambleas.",
    texto: "Ya contás con la posibilidad de ver los documentos de índole legal y relacionados a las asambleas que se efectúan, así como la posibilidad de cargarlos.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
    </svg>`,
  },
  {
    etiqueta: "Facturas",
    titulo: "Carga de facturas y tickets",
    resumen: "Subí comprobantes para que contaduría los verifique.",
    texto: "Función complementaria para ordenar la carga de facturas por parte de la contadora: podés subir tus documentos y aguardar que sean verificados por esta en el sistema gubernamental.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
      <line x1="9" y1="11" x2="12" y2="11"/>
    </svg>`,
  },
  {
    etiqueta: "Informes",
    titulo: "Desempeño de la operación",
    resumen: "Mirá cómo va la Caja E.A.S. en un período — en beta.",
    texto: "Posibilidad de ver el desempeño de la operación y Caja E.A.S. dentro de un período determinado. Aún se encuentra en fase experimental, por lo que sus capacidades de mostrar información aún son limitadas. En caso de querer brindar tus sugerencias, hacenoslo llegar mediante el coordinador.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>
    </svg>`,
  },
  {
    etiqueta: "Asientos",
    titulo: "Selección de asientos en la nube",
    resumen: "Mejora interna de infraestructura, sin cambios visibles.",
    texto: "Se migró la página de selección de asientos al servidor de Cloudflare, a modo de expandir sus posibilidades a futuro. Es una mejora interna: el pasajero o staff no notará cambios actualmente en su comportamiento.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01"/>
    </svg>`,
  },
  {
    etiqueta: "Recibos",
    titulo: "Filtros de recibos mejorados",
    resumen: "Filtrá recibos por pagos comerciales o solidaridad.",
    texto: "Recibió una pequeña mejora en los filtros que muestran la info: podés ver solo aquellos que correspondan a pagos comerciales o solidaridad, para evitar confusiones.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
    </svg>`,
  },
  {
    etiqueta: "Almacenamiento",
    titulo: "Migración a almacenamiento R2",
    resumen: "Cambio gradual de proveedor: posibles fallos temporales.",
    texto: "Se hará la migración gradual del servicio de almacenamiento a R2 en vez de Storage, un paso más en la evolución de Guaraní Tour App. Agradecemos su paciencia ante fallos relacionados a documentos e imágenes.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h.79a4.5 4.5 0 1 1 0 9z"/>
    </svg>`,
  },
  {
    etiqueta: "Estabilidad",
    titulo: "Errores corregidos",
    resumen: "Se corrigieron errores y se mejoró la estabilidad general.",
    texto: "Se corrigieron errores y se mejoró la estabilidad general de la app.",
    icono: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>`,
  },
];

// ── Estado interno ─────────────────────────────────────────
let _novEmail = "";
let _novItemsVisibles = []; // subconjunto de _NOV_ITEMS ya filtrado por rol

function _novKey(email) {
  return `guarani_novedad_${_NOV_VERSION}_${email}`;
}

/** Un ítem sin "roles" propio hereda _NOV_ROLES_TANDA. Con "roles"
 *  propio, ese array reemplaza al de la tanda para ese ítem puntual. */
function _novItemVisibleParaRol(item, role) {
  const roles = item.roles || _NOV_ROLES_TANDA;
  return roles.includes(role);
}

// ── Punto de entrada ───────────────────────────────────────
function checkNovedades(email, role) {
  if (localStorage.getItem(_novKey(email)) === "1") return;

  _novItemsVisibles = _NOV_ITEMS.filter(it => _novItemVisibleParaRol(it, role));
  if (_novItemsVisibles.length === 0) {
    // Nada relevante para este rol: no hay modal que mostrar, pero igual
    // marcamos como visto para no re-evaluar en cada carga.
    localStorage.setItem(_novKey(email), "1");
    return;
  }

  _novEmail = email;
  _renderInaugModal();
}

// ── Renderizar modal ───────────────────────────────────────
function _renderInaugModal() {
  let overlay = document.getElementById("nov-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "nov-overlay";
    overlay.className = "nov-overlay";
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="nov-sheet" role="dialog" aria-modal="true" aria-label="Novedades">

      <div class="nov-header">
        <div class="nov-header-label">🎉 Novedades</div>
        <button class="nov-close" onclick="_cerrarNovedades()" aria-label="Cerrar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <p class="nov-intro">Estos son los últimos cambios que ya podés usar.</p>

      <div class="nov-lista" id="nov-lista"></div>

      <button class="nov-btn-cerrar" onclick="_cerrarNovedades()">Entendido</button>

    </div>`;

  _novRenderLista();

  requestAnimationFrame(() => overlay.classList.add("nov-visible"));
}

// ── Renderizar lista con acordeón ───────────────────────────
// Todos los ítems arrancan colapsados (solo ícono, categoría y título);
// tocar un ítem expande su texto completo sin afectar a los demás.
function _novRenderLista() {
  const wrap = document.getElementById("nov-lista");
  if (!wrap) return;

  wrap.innerHTML = _novItemsVisibles.map((it, i) => `
    <div class="nov-item" data-idx="${i}">
      <button type="button" class="nov-item-head" onclick="_novToggleItem(${i})" aria-expanded="false" aria-controls="nov-item-body-${i}">
        <span class="nov-item-icon">${it.icono}</span>
        <span class="nov-item-head-text">
          <span class="nov-item-etiqueta">${it.etiqueta}</span>
          <span class="nov-item-titulo">${it.titulo}</span>
        </span>
        <svg class="nov-item-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div class="nov-item-body" id="nov-item-body-${i}">
        <p class="nov-item-texto">${it.texto.replace(/\n/g, "<br>")}</p>
      </div>
    </div>
  `).join("");
}

// ── Acordeón: abrir/cerrar un ítem ──────────────────────────
// Los ítems son independientes entre sí (no es "solo uno abierto a la
// vez"): el usuario puede expandir varios en simultáneo si quiere
// comparar o leer más de un tema seguido.
//
// Se anima con max-height calculado desde scrollHeight (no con
// grid-template-rows: 1fr, que no resuelve de forma confiable al alto
// real del contenido en todos los navegadores/WebViews). Al terminar
// de abrir, además, se quita el límite (maxHeight: "none"): dejar el
// valor en px fijo es frágil ante redondeo de subpíxeles con texto de
// varias líneas, y cualquier cambio posterior (fuente del sistema,
// zoom, rotación) volvería a cortar la última línea.
function _novToggleItem(idx) {
  const item = document.querySelector(`.nov-item[data-idx="${idx}"]`);
  if (!item) return;

  const body = item.querySelector(".nov-item-body");
  const head = item.querySelector(".nov-item-head");
  const abrir = !item.classList.contains("abierto");

  item.classList.toggle("abierto", abrir);
  if (head) head.setAttribute("aria-expanded", String(abrir));
  if (!body) return;

  if (abrir) {
    body.style.maxHeight = `${body.scrollHeight}px`;
    // Tras la transición, se libera el límite para que el contenido
    // nunca quede a merced de un cálculo en píxeles.
    body.addEventListener("transitionend", function liberar(ev) {
      if (ev.propertyName !== "max-height") return;
      if (item.classList.contains("abierto")) body.style.maxHeight = "none";
      body.removeEventListener("transitionend", liberar);
    });
  } else {
    // Si estaba en "none" (ya totalmente abierto), hay que fijar antes
    // un valor numérico real o la transición de cierre no tiene de
    // dónde animar (no se puede transicionar desde "none").
    body.style.maxHeight = `${body.scrollHeight}px`;
    requestAnimationFrame(() => { body.style.maxHeight = "0px"; });
  }
}

// ── Cerrar ─────────────────────────────────────────────────
function _cerrarNovedades() {
  localStorage.setItem(_novKey(_novEmail), "1");
  const overlay = document.getElementById("nov-overlay");
  if (!overlay) return;
  overlay.classList.remove("nov-visible");
  overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
}
