// ── Estado global ──────────────────────────────────────────
let allPassengers = [];
let avatarCache = {};
let currentView = "dashboard";
let selectedIdx = null;
// Recuerda el idx del pasajero visto en "detalle", para poder re-nombrar
// su avatar en la lista al volver. No se puede usar selectedIdx para esto:
// _navigateToImpl lo pisa con el idx de la vista destino (null para
// "clientes") antes de que el bloque "clientes" llegue a leerlo.
let _ultimoDetalleIdx = null;
let appReady = false;
// Promesa de la carga de allPassengers en curso, si hay una. Permite que
// varias vistas que dependan de la lista (detalle, historial-viajes) esperen
// la misma carga en vez de disparar loadPassengers() por duplicado — por
// ejemplo al recargar la página directo en #detalle/17.
let _loadPassengersPromise = null;

// ── Caches de tablas estáticas ─────────────────────────────
// Se cargan una sola vez por sesión y se reutilizan en todos los módulos
let _vendedoresCache  = [];   // [{ Nombre_del_vendedor }]
let _metodosCache     = [];   // [{ id, metodo_de_pago }]
let _bancosCache      = [];   // [{ id, banco_id }]

async function getVendedores() {
  if (_vendedoresCache.length === 0) {
    const { data } = await supabaseClient
      .from("vendedores")
      .select("Nombre_del_vendedor")
      .order("Nombre_del_vendedor", { ascending: true });
    _vendedoresCache = data || [];
  }
  return _vendedoresCache;
}

async function getMetodosPago() {
  if (_metodosCache.length === 0) {
    const { data } = await supabaseClient
      .from("metodos_de_pago")
      .select("id, metodo_de_pago")
      .order("metodo_de_pago", { ascending: true });
    _metodosCache = data || [];
  }
  return _metodosCache;
}

async function getBancos() {
  if (_bancosCache.length === 0) {
    const { data } = await supabaseClient
      .from("bancos")
      .select("id, banco_id")
      .order("banco_id", { ascending: true });
    _bancosCache = data || [];
  }
  return _bancosCache;
}

// ── Visibilidad ────────────────────────────────────────────
function showEl(id) {
  document.getElementById(id).style.display = "";
  // El bottom navbar vive fuera de #app-view a propósito (ver comentario
  // en el HTML), así que su visibilidad se sincroniza a mano acá.
  if (id === "app-view") {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.display = "";
    // body tiene `align-items:center` para centrar verticalmente la card
    // de login. Una vez logueado, #app-view puede crecer más alto que el
    // viewport (ej. formularios largos como "recibo nuevo"): con el body
    // todavía centrando ese contenido, la parte de arriba (topbar) queda
    // recortada por encima del viewport hasta que el usuario scrollea.
    // Esta clase anula el centrado apenas se muestra la app.
    document.body.classList.add("app-activa");
  }
}
function hideEl(id) {
  document.getElementById(id).style.display = "none";
  if (id === "app-view") {
    const nav = document.getElementById("bottom-nav");
    if (nav) nav.style.display = "none";
    if (typeof closeModulosSheet === "function") closeModulosSheet();
    document.body.classList.remove("app-activa");
  }
}

function showLogin() {
  appReady = false;
  showEl("login-view");
  hideEl("app-view");
}

let currentUserRole = null;
let currentUserName = null;
let currentUserAvatar = null;
let currentStaffId = null;

function renderTopbarProfile() {
  const btn = document.querySelector(".topbar-profile");
  if (!btn) return;
  if (currentUserAvatar) {
    btn.innerHTML = `<img src="${currentUserAvatar}" alt="${currentUserName || "Perfil"}" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<span>${getInitials(currentUserName)}</span>'" />`;
  } else {
    btn.innerHTML = `<span>${getInitials(currentUserName)}</span>`;
  }
}

// ── Caché de perfil de staff (arranque optimista) ────────────
// Guarda en localStorage lo mínimo necesario para pintar la app (topbar,
// nav, permisos por rol) SIN esperar la consulta de red a "staff". Se
// namespacea por email porque a esta altura del arranque todavía no hay
// staff.id resuelto (es lo que estamos por buscar).
//
// Esto es solo para el primer pintado — enterApp() igual corre la
// consulta real siempre y corrige la UI (o desloguea) si algo no
// coincide. Un dato desactualizado acá nunca se traduce en acceso
// real a datos: RLS del lado de Supabase sigue siendo la autoridad.
const _STAFF_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 horas

function _staffCacheKey(email) {
  return `staffCache_v1_${(email || "").toLowerCase()}`;
}

function _staffCacheGet(email) {
  try {
    const raw = localStorage.getItem(_staffCacheKey(email));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.ts || (Date.now() - parsed.ts) > _STAFF_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(_staffCacheKey(email));
      return null;
    }
    return parsed.data || null;
  } catch (e) {
    console.warn("Caché de staff corrupto, se descarta:", e);
    return null;
  }
}

function _staffCacheSet(email, data) {
  try {
    localStorage.setItem(_staffCacheKey(email), JSON.stringify({ ts: Date.now(), data }));
  } catch (e) {
    console.warn("No se pudo persistir el caché de staff:", e);
  }
}

function _staffCacheClear(email) {
  try { localStorage.removeItem(_staffCacheKey(email)); } catch (e) {}
}

// Vistas que pueden restaurarse directamente al arrancar (por ?goto=,
// por hash de la URL, o para decidir si el destino por defecto ya es
// conocido en _pintarShellOptimista). Vive a nivel de módulo porque
// enterApp() y _pintarShellOptimista() necesitan exactamente la misma
// lista — tenerla duplicada es lo que hacía fácil que quedaran
// desincronizadas.
const RESTORABLE_VIEWS_ARRANQUE = [
  "dashboard","clientes","nuevo","usuarios","viajes","viaje-nuevo",
  "detalle","historial-viajes","viaje-detalle","viaje-pasajero-nuevo","historico",
  "activity-log"
];

// Pinta el "shell" de la app (topbar, nav, permisos por rol) de forma
// optimista con datos cacheados, SIN tocar appReady. La navegación REAL
// (respetando ?goto=, hash profundo, notificación push, etc.) la sigue
// resolviendo enterApp() como siempre — así no hay dos lugares decidiendo
// a qué vista entrar.
//
// Excepción puntual: si la URL no pide una vista concreta (sin ?goto=
// y sin hash restaurable), el destino por defecto YA se sabe que va a
// ser "dashboard" sin necesidad de esperar a enterApp() — es el mismo
// valor al que cae el propio enterApp() más abajo cuando no hay nada
// que restaurar. Pintarlo acá mismo evita el hueco en blanco entre que
// se oculta el splash (shell visible) y que la consulta de red a
// "staff" resuelve: antes, en ese hueco, loadDashboard() todavía no se
// había llamado ni una vez, así que #dashboard-content quedaba vacío
// (ni skeleton ni datos) hasta que enterApp() terminaba. Ahora, con
// caché de dashboard vigente (dashCache_v1_*), loadDashboard() pinta
// contenido real al instante; sin ese caché, pinta su propio skeleton
// al instante — cualquiera de los dos es mejor que la pantalla vacía.
// enterApp() vuelve a llamar navigateTo("dashboard") cuando confirma
// por red, pero eso es barato: loadDashboard() dispara sus queries de
// nuevo (revalidación), no hay estado que se pise.
//
// Devuelve true si pudo pintar algo, false si no había caché usable.
function _pintarShellOptimista(user) {
  const cached = _staffCacheGet(user.email);
  if (!cached || cached.status !== "enabled") return false;

  currentUserRole   = cached.role;
  currentUserName   = cached.nombre || user.email.split("@")[0];
  currentUserAvatar = cached.avatar_url || user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  currentStaffId    = cached.id;

  hideEl("login-view");
  showEl("app-view");
  document.getElementById("user-email").textContent = user.email;
  renderTopbarProfile();
  const card = document.getElementById("card-usuarios");
  if (card) card.style.display = cached.role === "admin" ? "" : "none";
  const cardMov = document.getElementById("card-movimientos");
  if (cardMov) cardMov.style.display = ["admin", "worker", "finanzas"].includes(cached.role) ? "" : "none";
  const menuActivityLog = document.getElementById("menu-activity-log-btn");
  if (menuActivityLog) menuActivityLog.style.display = cached.role === "admin" ? "" : "none";
  const menuEmail = document.getElementById("menu-user-email");
  if (menuEmail) menuEmail.textContent = user.email;
  _precargarIconosModulos();

  const params = new URLSearchParams(location.search);
  const hayGoto = RESTORABLE_VIEWS_ARRANQUE.includes(params.get("goto"));
  const { view: hashView } = _parseHash(location.hash);
  const hayHashRestaurable = hashView && RESTORABLE_VIEWS_ARRANQUE.includes(hashView) && hashView !== "dashboard";

  if (!hayGoto && !hayHashRestaurable) {
    navigateTo("dashboard");
  }

  return true;
}

// Evita que dos llamadas a enterApp() para el MISMO usuario corran en
// paralelo. Antes esta carrera (getSession() + onAuthStateChange()
// disparando casi al mismo tiempo en el arranque) era inofensiva
// porque el splash tapaba todo hasta que ambas resolvían; ahora que
// el splash se oculta apenas hay caché, dos ejecuciones simultáneas
// pueden pisarse el estado global (currentUserRole, appReady, etc.)
// a mitad de camino y disparar un showLogin() espurio.
let _enterAppInFlightEmail = null;
let _enterAppInFlightPromise = null;

async function enterApp(user) {
  if (_enterAppInFlightEmail === user.email && _enterAppInFlightPromise) {
    // Ya hay una llamada en curso para este mismo usuario: no la
    // dupliquemos, solo esperamos a que termine esa.
    return _enterAppInFlightPromise;
  }
  _enterAppInFlightEmail = user.email;
  _enterAppInFlightPromise = _enterAppImpl(user).finally(() => {
    _enterAppInFlightEmail = null;
    _enterAppInFlightPromise = null;
  });
  return _enterAppInFlightPromise;
}

async function _enterAppImpl(user) {
  // Verificar si el usuario está en la tabla staff y habilitado
  let { data, error } = await supabaseClient
    .from("staff")
    .select("id, role, status, nombre, avatar_url")
    .eq("email", user.email)
    .single();

  if (error && error.code !== "PGRST116") {
    // Fallo transitorio (red, timeout, 5xx de Supabase): NO cerrar sesión
    // NI mostrar el login. La sesión de Supabase sigue siendo válida acá
    // (esto no es un error de auth, es un error de red/consulta); mandar
    // a showLogin() de todos modos es, para el usuario, un deslogueo
    // igual de molesto aunque técnicamente no se haya llamado signOut().
    // Un reintento único con backoff corto resuelve la enorme mayoría de
    // estos casos (corte de red de un instante, cold start de la
    // conexión al volver la PWA de background, etc.) sin que el usuario
    // vea nada. Si el reintento también falla, ahí sí se informa el
    // problema sin tirar al usuario a login.
    console.warn("enterApp: error consultando staff, reintentando…", error);
    await new Promise((r) => setTimeout(r, 1500));
    const retry = await supabaseClient
      .from("staff")
      .select("id, role, status, nombre, avatar_url")
      .eq("email", user.email)
      .single();

    if (retry.error && retry.error.code !== "PGRST116") {
      console.error("enterApp: reintento también falló, se mantiene la vista actual", retry.error);
      _mostrarErrorConexionEnterApp();
      return;
    }
    data = retry.data;
    error = retry.error;
  }

  if (!data) {
    // PGRST116 = "0 rows": acá sí, el email realmente no está en staff
    _staffCacheClear(user.email);
    await supabaseClient.auth.signOut();
    showLogin();
    showAccessDenied("not_staff");
    return;
  }

  if (data.status !== "enabled") {
    // Está en staff pero deshabilitado
    _staffCacheClear(user.email);
    await supabaseClient.auth.signOut();
    showLogin();
    showAccessDenied("disabled");
    return;
  }

  currentUserRole = data.role;
  currentUserName = data.nombre || user.email.split("@")[0];
  currentStaffId  = data.id;

  // Sincronizar foto de perfil de Google (si vino y cambió respecto a la guardada)
  const googleAvatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || null;
  currentUserAvatar = data.avatar_url || googleAvatar || null;
  if (googleAvatar && googleAvatar !== data.avatar_url) {
    supabaseClient
      .from("staff")
      .update({ avatar_url: googleAvatar })
      .eq("id", data.id)
      .then(({ error: updErr }) => {
        if (updErr) console.warn("No se pudo actualizar avatar_url:", updErr);
      });
  }

  // Persistir el perfil confirmado para el próximo arranque optimista.
  // Se guarda SIEMPRE con los datos recién confirmados por el servidor
  // (nunca los del caché anterior), así un cambio de rol/estado hecho
  // por un admin se refleja acá apenas este usuario vuelve a entrar.
  _staffCacheSet(user.email, {
    id: data.id,
    role: data.role,
    status: data.status,
    nombre: data.nombre,
    avatar_url: currentUserAvatar
  });

  // Registrar última conexión (no bloqueante: si falla, no debe afectar el login)
  touchLastSeen(data.id);

  // Pedir permiso de notificaciones y registrar el token (no bloqueante)
  if (typeof initPushNotifications === "function") {
    initPushNotifications(data.id).then((result) => {
      console.log("Resultado registro push:", result);
      const btnActivarPush = document.getElementById("btn-activar-notificaciones");
      if (btnActivarPush) {
        // Solo mostramos el botón si no quedó activo y tiene sentido
        // ofrecer reintentar (no en "not_pwa", ahí no aplica).
        btnActivarPush.style.display =
          !result.ok && result.reason !== "not_pwa" ? "" : "none";
      }
    });
  }

  hideEl("login-view");
  showEl("app-view");
  document.getElementById("user-email").textContent = user.email;
  renderTopbarProfile();
 // 👇 OCULTAR USUARIOS SI NO ES ADMIN
const card = document.getElementById("card-usuarios");
if (card) card.style.display = data.role === "admin" ? "" : "none";
  // 👇 MOVIMIENTOS BANCARIOS: admin, worker y finanzas (finanzas solo lectura, ver movimientos.js)
  const cardMov = document.getElementById("card-movimientos");
  if (cardMov) cardMov.style.display = ["admin", "worker", "finanzas"].includes(data.role) ? "" : "none";
  const menuActivityLog = document.getElementById("menu-activity-log-btn");
  if (menuActivityLog) menuActivityLog.style.display = data.role === "admin" ? "" : "none";
  const menuEmail = document.getElementById("menu-user-email");
  if (menuEmail) menuEmail.textContent = user.email;
  _precargarIconosModulos();
  if (!appReady) {
    appReady = true;
    // Si venimos de una notificación push, Android suele ignorar el hash
    // del link y abre por el start_url del manifest. Por eso usamos un
    // query param (?goto=viajes) como respaldo más confiable.
    const params = new URLSearchParams(location.search);
    const gotoParam = params.get("goto");
    const idxParam = params.get("idx");

    // Nota: si _pintarShellOptimista() ya pintó "dashboard" como destino
    // por defecto (arranque optimista, sin ?goto= ni hash), este bloque
    // vuelve a llamar navigateTo() acá. Es intencional y barato: confirma
    // el destino con datos ya frescos por red y, cuando SÍ hay ?goto= o
    // hash, es la primera vez que se navega (el shell optimista no lo
    // hizo). No hay estado que se pise entre ambas llamadas.
    if (gotoParam && RESTORABLE_VIEWS_ARRANQUE.includes(gotoParam)) {
      // Limpiar el query param de la URL para que no quede pegado
      history.replaceState({}, "", location.pathname + location.hash);
      const idxValue = idxParam === null ? null
        : (isNaN(idxParam) ? idxParam : parseInt(idxParam, 10));
      navigateTo(gotoParam, idxValue);
    } else {
      // Si hay un hash en la URL al cargar, intentar restaurar esa vista
      // (hash vacío se parsea como "dashboard", que ya es el destino por defecto)
      const { view: hashView, idx: hashIdx } = _parseHash(location.hash);
      if (hashView && RESTORABLE_VIEWS_ARRANQUE.includes(hashView)) {
        navigateTo(hashView, hashIdx);
      } else {
        navigateTo("dashboard");
      }
    }
    // Mostrar novedades si el usuario no las vio aún
    checkNovedades(user.email, currentUserRole);
  }
}

// Reacciona cuando el hash cambia estando la app ya abierta (por ejemplo,
// al tocar una notificación push que navega a #viajes con la PWA en
// segundo plano). Sin esto, la SPA solo lee el hash una vez al cargar.
window.addEventListener("hashchange", () => {
  const { view: hashView, idx: hashIdx } = _parseHash(location.hash);
  const restorableViews = [
    "dashboard","clientes","nuevo","usuarios","viajes","viaje-nuevo",
    "detalle","historial-viajes","viaje-detalle","viaje-pasajero-nuevo","historico",
    "byc","byc-vincular"
  ];
  if (hashView && restorableViews.includes(hashView)) {
    navigateTo(hashView, hashIdx, true);
  }
});

// Se llama cuando enterApp() no logra confirmar el staff ni siquiera
// tras reintentar (problema de red persistente, no de autorización).
// Clave: si la app YA estaba visible (appReady === true, navegación
// confirmada; o el shell se pintó optimista desde caché al arrancar),
// esto ocurrió en un refresh silencioso en background — NO tocamos la
// UI ni mostramos login, solo un toast, para no expulsar a alguien que
// está activamente usando la app por un corte de red de un instante.
// Solo si nunca hubo nada que mostrar (arranque en frío sin caché de
// staff) corresponde mostrar login con un aviso.
function _mostrarErrorConexionEnterApp() {
  const appYaVisible = appReady || document.getElementById("app-view")?.style.display !== "none";
  if (appYaVisible) {
    _appToast("Problema de conexión al verificar tu sesión. Reintentando…", true);
    return;
  }
  showLogin();
  showAccessDenied("connection");
}

// Toast mínimo, sin dependencias de otros módulos (calendario.js define
// uno similar para su propio uso; este es el genérico de app.js).
function _appToast(msg, esError = false) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.setAttribute("role", "status");
  el.style.cssText = `
    position:fixed; left:50%; bottom:calc(6rem + env(safe-area-inset-bottom,0px));
    transform:translateX(-50%); z-index:400;
    background:${esError ? "var(--danger)" : "var(--accent)"}; color:#fff;
    padding:.65rem 1.1rem; border-radius:10px; font-size:.85rem;
    box-shadow:var(--shadow-md); max-width:calc(100vw - 2rem); text-align:center;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function showAccessDenied(reason) {
  const card = document.querySelector(".login-card");
  const existing = document.getElementById("access-denied-msg");
  if (existing) existing.remove();

  const msg = document.createElement("div");
  msg.id = "access-denied-msg";
  msg.style.cssText = "margin-top:1rem; padding:.75rem 1rem; background:#fff0f0; border:1px solid rgba(192,57,43,.2); border-radius:10px; font-size:.85rem; color:#c0392b; text-align:center;";
  msg.textContent = reason === "disabled"
    ? "Tu acceso está deshabilitado. Contactá al administrador."
    : reason === "connection"
    ? "No pudimos verificar tu sesión por un problema de conexión. Volvé a intentar en unos segundos."
    : "Tu cuenta no pertenece al staff. Contactá al administrador si creés que es un error.";
  card.appendChild(msg);
}

// ── Auth ───────────────────────────────────────────────────
// Arranque optimista: getSession() de Supabase JS v2 resuelve del
// storage local (no golpea la red salvo que el token esté vencido),
// así que normalmente es rápido. El cuello de botella real era
// enterApp(), que espera la consulta a "staff" por red antes de
// mostrar la app. Ahora, si hay un perfil de staff cacheado y
// vigente para ese email, pintamos app-view (topbar, nav, dashboard
// desde su propio caché) DE INMEDIATO con esos datos, y enterApp()
// sigue corriendo en paralelo para confirmar o corregir — RLS en
// Supabase es la autoridad real en todo momento, esto solo evita la
// espera visual cuando ya sabemos, con buena confianza, qué se va a
// mostrar.
document.addEventListener("DOMContentLoaded", () => {
  hideEl("login-view");
  hideEl("app-view");

  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (!session?.user) {
      hideEl("splash-view");
      showLogin();
      return;
    }

    // Si hay un perfil de staff cacheado y vigente, pintamos el shell
    // (topbar, nav, permisos) de inmediato y ocultamos el splash ANTES
    // de que la consulta de red resuelva. enterApp() sigue corriendo
    // igual que siempre — navega a la vista correcta, confirma/corrige
    // los datos, y dispara checkNovedades — solo que ahora lo hace con
    // la app ya visible en vez de con el splash tapando todo.
    if (_pintarShellOptimista(session.user)) {
      hideEl("splash-view");
      enterApp(session.user);
    } else {
      // Sin caché usable (primera vez en este dispositivo, o venció):
      // mismo comportamiento que antes, splash hasta confirmar por red.
      enterApp(session.user).then(() => hideEl("splash-view"));
    }
  });

  supabaseClient.auth.onAuthStateChange((event, session) => {
    hideEl("splash-view");

    // TOKEN_REFRESHED se dispara solo, en background, aprox. cada hora
    // (y al volver el tab a foreground). No hace falta reconstruir toda
    // la app en ese caso: la sesión sigue siendo la misma, solo cambió
    // el token. Relanzar enterApp() acá era el origen de los cierres de
    // sesión intermitentes (un simple timeout de red al reconsultar
    // "staff" terminaba ejecutando signOut()).
    if (event === "TOKEN_REFRESHED") return;

    if (session?.user) enterApp(session.user);
    else showLogin();
  });
});

// ── Navegación por hash ────────────────────────────────────
// Vistas simples (sin idx o idx numérico): hash = #vista o #vista/idx
// Vistas con idx objeto: hash = #vista (el contexto vive en memoria)
const _hashSimpleViews = ["dashboard","clientes","nuevo","usuarios","viajes","viaje-nuevo","historico","ranking-puntos","club-destino","byc","byc-vincular"];
const _hashNumericViews = ["detalle","historial-viajes","viaje-detalle","viaje-pasajero-nuevo","viaje-editar"];
// Vistas con idx objeto, pero que SÍ necesitan un hash distinto por
// instancia (si no, dos pantallas distintas comparten el mismo hash
// plano, _setHash no pushea una entrada nueva, y "atrás" se salta un
// nivel). Se identifican con un campo puntual del objeto idx.
const _hashObjectViews = {
  "viaje-pasajero-pagos": (idx) => idx?.viajePasajeroId,
  "pago-detalle"        : (idx) => idx?.id,
};

function _buildHash(view, idx) {
  if (_hashNumericViews.includes(view) && idx !== null && typeof idx === "number") {
    return `#${view}/${idx}`;
  }
  if (_hashObjectViews[view]) {
    const key = _hashObjectViews[view](idx);
    if (key !== null && key !== undefined) return `#${view}/${key}`;
  }
  return `#${view}`;
}

function _setHash(view, idx) {
  const hash = _buildHash(view, idx);
  if (location.hash !== hash) {
    // Antes de avanzar, guardamos el scroll de la vista que dejamos atrás
    // en su propia entrada del historial, para poder restaurarlo al volver.
    history.replaceState({ scrollY: window.scrollY }, "", location.hash);
    history.pushState({ scrollY: 0 }, "", hash);
  }
}

function _parseHash(hash) {
  const raw = (hash || "").replace(/^#/, "");
  if (!raw) return { view: "dashboard", idx: null };
  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) return { view: raw, idx: null };
  const view = raw.slice(0, slashIdx);
  const idxStr = raw.slice(slashIdx + 1);
  const idx = isNaN(idxStr) ? idxStr : parseInt(idxStr, 10);
  return { view, idx };
}

window.addEventListener("popstate", (event) => {
  if (!appReady) return;
  // Si el sheet de módulos está abierto, "atrás" lo cierra en vez de
  // navegar en el SPA: consumimos esta entrada del historial (la que
  // agregamos al abrirlo en toggleModulosSheet) y listo.
  if (_modulosSheetHistoryEntryOpen) {
    _modulosSheetHistoryEntryOpen = false;
    _closeModulosSheetUI();
    return;
  }
  // Mismo caso para el bottom sheet de un custom select (categoría, caja,
  // etc. — ver custom-select.js). Ese componente pushea su propia entrada
  // de historial al abrirse y la consume al cerrarse (clic afuera, X, o
  // atrás), pero su propio listener de popstate se registra recién cuando
  // el usuario abre el sheet — es decir, DESPUÉS de este listener global,
  // que ya está activo desde que carga la página. Por orden de registro,
  // este código corre primero en cada popstate, así que sin este chequeo
  // se dispara una navegación real del SPA antes de que custom-select.js
  // llegue a frenarla con stopImmediatePropagation().
  if (window._csSheetOpen) return;
  const { view, idx } = _parseHash(location.hash);
  // Scroll guardado para esta entrada del historial (si existe)
  _pendingScrollY = (event.state && typeof event.state.scrollY === "number") ? event.state.scrollY : null;
  // Vistas con idx objeto no se pueden restaurar solo desde el hash (no
  // guarda datos); egreso-detalle no tiene contexto en memoria para
  // reconstruirse, así que va al padre. viaje-pasajero-pagos sí lo tiene
  // (pagosCtx), así que se resuelve más abajo, junto con pago-detalle.
  const objectIdxViews = ["egreso-detalle"];
  if (objectIdxViews.includes(view)) {
    navigateTo("viajes", null, true);
    return;
  }
  if (view === "viaje-pasajero-pagos") {
    if (pagosCtx?.viajeId) {
      navigateTo("viaje-detalle", pagosCtx.viajeId, true);
    } else {
      navigateTo("viajes", null, true);
    }
    return;
  }
  if (view === "pago-detalle") {
    if (pagosCtx?.viajePasajeroId) {
      navigateTo("viaje-pasajero-pagos", {
        viajePasajeroId : pagosCtx.viajePasajeroId,
        viajeId         : pagosCtx.viajeId,
        pasajeroId      : pagosCtx.pasajeroId,
        nombrePasajero  : pagosCtx.nombrePasajero,
      }, true);
    } else {
      navigateTo("viajes", null, true);
    }
    return;
  }
  navigateTo(view, idx, true); // true = viniendo del hash, no volver a setear
});

// ── Navegación ─────────────────────────────────────────────
// Scroll pendiente de restaurar al volver con "atrás" (popstate).
let _pendingScrollY = null;

// Reintenta restaurar el scroll mientras el contenido async (Supabase)
// todavía está pintándose y la página no alcanza esa altura todavía.
function _restoreScroll(targetY, intentos = 20) {
  if (targetY == null) return;
  if (document.body.scrollHeight >= targetY + window.innerHeight || intentos <= 0) {
    window.scrollTo(0, targetY);
    // Un segundo ajuste por si el contenido siguió creciendo justo después
    requestAnimationFrame(() => window.scrollTo(0, targetY));
    return;
  }
  window.scrollTo(0, targetY);
  setTimeout(() => _restoreScroll(targetY, intentos - 1), 60);
}

function getSaludo() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

// Transición global: aplica a todas las vistas de la SPA. El navegador la
// soporta o no según el caso; si no existe, cae al comportamiento normal
// sin romper nada (ver soportaVT en navigateTo).
const _vistasConTransicion = new Set([
  "byc", "byc-vincular", "clientes", "club-destino", "dashboard", "detalle",
  "egreso-detalle", "historial-viajes", "historico", "movimiento-nuevo",
  "movimientos", "nuevo", "pago-detalle", "ranking-puntos", "recibo-detalle",
  "recibo-nuevo", "recibos", "seleccion-asiento", "usuarios", "viaje-detalle",
  "viaje-editar", "viaje-nuevo", "viaje-pasajero-nuevo", "viaje-pasajero-pagos",
  "viajes",
]);

function navigateTo(view, idx = null, _fromHash = false) {
  // Guard de acceso: finanzas no puede entrar a clientes, usuarios, byc
  // ni al detalle de un pasajero (tampoco desde Club Destino/ranking),
  // ni por menú ni por hash/URL directa ni por llamada programática.
  if (currentUserRole === "finanzas" && (view === "clientes" || view === "usuarios" || view === "byc" || view === "byc-vincular" || view === "detalle")) {
    view = "dashboard";
  }

  const soportaVT = typeof document.startViewTransition === "function";
  const aplicaTransicion =
    soportaVT &&
    _vistasConTransicion.has(view) &&
    _vistasConTransicion.has(currentView) &&
    view !== currentView; // no disparar transición si no cambia la vista real

  if (!aplicaTransicion) {
    _navigateToImpl(view, idx, _fromHash);
    return;
  }

  // La asignación de view-transition-name vive dentro de _navigateToImpl
  // (renderDetalle al entrar, el bloque "clientes" al volver), siempre
  // en el mismo callback síncrono en que se quita del elemento anterior.
  // Así nunca hay dos elementos con el mismo nombre vivos a la vez
  // (eso hace que el navegador aborte la transición con AbortError).
  document.startViewTransition(() => {
    try {
      _navigateToImpl(view, idx, _fromHash);
    } catch (err) {
      console.error('[VT] EXCEPCIÓN dentro del callback:', err);
      throw err;
    }
  }).finished.catch((err) => {
    console.error('[VT] transición abortada:', err);
  });
}

function _navigateToImpl(view, idx = null, _fromHash = false) {

  currentView = view;
  selectedIdx = idx;

  // Actualizar hash (salvo que ya venga del popstate)
  if (!_fromHash) _setHash(view, idx);

  // Ocultar todas las vistas
  setFabSosVisible(false); // solo se re-muestra dentro de Detalle de pasajero
  const _modalSos = document.getElementById("modal-contacto");
  if (_modalSos && _modalSos.open) _modalSos.close();
  hideEl("view-clientes");
  hideEl("view-detalle");
  hideEl("view-nuevo");
  hideEl("view-usuarios");
  hideEl("view-viajes");
  const _hvp = document.getElementById("view-historial-viajes");
  if (_hvp) _hvp.style.display = "none";
  const _vpn = document.getElementById("view-viaje-pasajero-nuevo");
  if (_vpn) _vpn.style.display = "none";
  const _vvn = document.getElementById("view-viaje-nuevo");
  if (_vvn) _vvn.style.display = "none";
  const _vvd = document.getElementById("view-viaje-detalle");
  if (_vvd) _vvd.style.display = "none";
  const _vhi = document.getElementById("view-historico");
  if (_vhi) _vhi.style.display = "none";
  const _vpp = document.getElementById("view-viaje-pasajero-pagos");
  if (_vpp) _vpp.style.display = "none";
  const _vpd = document.getElementById("view-pago-detalle");
  if (_vpd) _vpd.style.display = "none";
  const _ved = document.getElementById("view-egreso-detalle");
  if (_ved) _ved.style.display = "none";
  const _vve = document.getElementById("view-viaje-editar");
  if (_vve) _vve.style.display = "none";
  const _vrec = document.getElementById("view-recibos");
  if (_vrec) _vrec.style.display = "none";
  const _vrecdet = document.getElementById("view-recibo-detalle");
  if (_vrecdet) _vrecdet.style.display = "none";
  const _vrecnew = document.getElementById("view-recibo-nuevo");
  if (_vrecnew) _vrecnew.style.display = "none";
  const _vdash = document.getElementById("view-dashboard");
  if (_vdash) _vdash.style.display = "none";
  const _vrank = document.getElementById("view-ranking-puntos");
  if (_vrank) _vrank.style.display = "none";
  const _vclub = document.getElementById("view-club-destino");
  if (_vclub) _vclub.style.display = "none";
  const _vbyc = document.getElementById("view-byc");
  if (_vbyc) _vbyc.style.display = "none";
  const _vbycv = document.getElementById("view-byc-vincular");
  if (_vbycv) _vbycv.style.display = "none";
  const _fotoWrap = document.getElementById("pd-foto-wrap");
  if (_fotoWrap) _fotoWrap.style.display = "none";
  const _vsa = document.getElementById("view-seleccion-asiento");
  if (_vsa) _vsa.style.display = "none";
  const _vmov = document.getElementById("view-movimientos");
  if (_vmov) _vmov.style.display = "none";
  const _vmovn = document.getElementById("view-movimiento-nuevo");
  if (_vmovn) _vmovn.style.display = "none";
  const _vcal = document.getElementById("view-calendario");
  if (_vcal) _vcal.style.display = "none";
  const _val = document.getElementById("view-activity-log");
  if (_val) _val.style.display = "none";

  const fab = document.getElementById("fab-nuevo");
  if (fab) {
    fab.style.display = (view === "clientes" && ["admin", "worker"].includes(currentUserRole)) ? "" : "none";
  }

  const fabViaje = document.getElementById("fab-viaje-nuevo");
  if (fabViaje) {
    fabViaje.style.display = (view === "viajes" && currentUserRole === "admin") ? "" : "none";
  }

  _updateBottomNavActiveState(view);
  closeModulosSheet();

  if (view === "dashboard") {

    showEl("view-dashboard");
    updateBreadcrumb([
      { label: "Panel de control" }
    ]);
    loadDashboard();

  }

  else if (view === "ranking-puntos") {

    showEl("view-ranking-puntos");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Panel de control", action: () => navigateTo("dashboard") },
      { label: "Ranking de puntos" }
    ]);
    loadRankingPuntos();

  }

  else if (view === "club-destino") {

    showEl("view-club-destino");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Panel de control", action: () => navigateTo("dashboard") },
      { label: "Club Destino" }
    ]);
    loadClubDestino();

  }

  else if (view === "clientes") {

    // Al volver: el detalle (origen) tiene el nombre puesto desde que
    // se abrió — lo quitamos de ahí y lo ponemos en la row de destino
    // en la lista, en el mismo tick, para que el navegador arme el par.
    const _detAv = document.getElementById("detalle-avatar");
    if (_detAv) _detAv.style.viewTransitionName = "";

    showEl("view-clientes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes" }
    ]);

    const _asignarNombreAvatar = () => {
      if (_ultimoDetalleIdx !== null) {
        const rowEl = document.querySelector(`.passenger-row[data-idx="${_ultimoDetalleIdx}"] .p-avatar`);
        if (rowEl) rowEl.style.viewTransitionName = `avatar-${_ultimoDetalleIdx}`;
        _ultimoDetalleIdx = null;
      }
    };

    if (allPassengers.length === 0) {
      // loadPassengers es async: la fila no existe todavía cuando este
      // callback síncrono termine, así que el navegador tomaría el
      // snapshot "after" sin la fila y el morph no ocurriría. Por eso
      // esperamos a que termine de pintar antes de nombrar el elemento.
      loadPassengers().then(_asignarNombreAvatar);
    } else {
      renderList(allPassengers);
      _asignarNombreAvatar();
    }

  }

  else if (view === "nuevo") {

    showEl("view-nuevo");
    limpiarFormulario();
    cargarVendedores("f-vendedor");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: "Nuevo cliente" }
    ]);
    initCustomSelect("f-sexo");
    initCustomSelect("f-vendedor");

  }

  else if (view === "detalle") {

    showEl("view-detalle");
    renderDetalle(idx);
    const p = allPassengers.find(x => x.id === idx);
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: p?.Pasajero || "Detalle" }
    ]);

  }

  // ESTE ES EL BLOQUE CLAVE
  else if (view === "usuarios") {
    // ver switchUsuariosTab() más abajo para el manejo de tabs

    if (currentUserRole !== "admin") return;
    showEl("view-usuarios");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Usuarios" }
    ]);
    switchUsuariosTab("app", { force: true });
    initCustomSelect("u-role");
    initCustomSelect("u-status");
    initCustomSelect("ur-role");

  }

  else if (view === "activity-log") {

    if (currentUserRole !== "admin") return;
    showEl("view-activity-log");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Registro de actividad" }
    ]);
    loadActivityLog({ reset: true });

  }

  else if (view === "viajes") {

    showEl("view-viajes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Viajes activos" }
    ]);
    loadViajes("activos");

  }

  else if (view === "seleccion-asiento") {

    showEl("view-seleccion-asiento");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Selección de asiento" }
    ]);
    // Abrir automáticamente en nueva pestaña
    window.open("https://www.guaranitour.com/#/Reservas", "_blank", "noopener,noreferrer");

  }

  else if (view === "historico") {

    showEl("view-historico");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Histórico de viajes" }
    ]);
    const _hs = document.getElementById("historico-search");
    if (_hs) _hs.value = "";
    loadViajes("historico");

  }

  else if (view === "byc") {

    showEl("view-byc");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Estado ByC" }
    ]);
    initBycView();

  }

  else if (view === "byc-vincular") {

    showEl("view-byc-vincular");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Estado ByC", action: () => navigateTo("byc") },
      { label: "Pendientes de vincular" }
    ]);
    mostrarPaso1();
    cargarPendientes();

  }

  else if (view === "historial-viajes") {

    showEl("view-historial-viajes");
    document.getElementById("historial-titulo").textContent = "Pasajero";
    document.getElementById("historial-subtitulo").textContent = "Viajes asistidos como protagonista";
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: "Historial de viajes" }
    ]);
    loadHistorialViajes(idx);

  }

  else if (view === "viaje-nuevo") {

    if (currentUserRole !== "admin") return;
    showEl("view-viaje-nuevo");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Nuevo viaje" }
    ]);
    initCustomSelect("v-estado");

  }

  else if (view === "viaje-editar") {

    if (currentUserRole !== "admin") return;
    showEl("view-viaje-editar");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx) },
      { label: "Editar viaje" }
    ]);
    initFormEditarViaje(idx);

  }

  else if (view === "viaje-detalle") {

    showEl("view-viaje-detalle");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Detalle" }
    ]);
    loadViajeDetalle(idx);

  }

  else if (view === "viaje-pasajero-nuevo") {

    showEl("view-viaje-pasajero-nuevo");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Viajes", action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx) },
      { label: "Agregar pasajero" }
    ]);
    initFormPasajero(idx);

  }

  else if (view === "viaje-pasajero-pagos") {

    const { viajePasajeroId, viajeId, pasajeroId, nombrePasajero } = idx || {};
    showEl("view-viaje-pasajero-pagos");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", viajeId) },
      { label: nombrePasajero || "Pagos" }
    ]);
    initPagosView({ viajePasajeroId, viajeId, pasajeroId, nombrePasajero });

  }

  else if (view === "pago-detalle") {

    showEl("view-pago-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", pagosCtx?.viajeId) },
      { label: pagosCtx?.nombrePasajero || "Pagos", action: () => navigateTo("viaje-pasajero-pagos", pagosCtx) },
      { label: "Detalle pago" }
    ]);
    initPagoDetalleView(idx);

  }

  else if (view === "egreso-detalle") {

    showEl("view-egreso-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: "Viajes",  action: () => navigateTo("viajes") },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx?.viajeId) },
      { label: "Egreso" }
    ]);
    initEgresoDetalleView(idx);

  }

  else if (view === "recibos") {

    showEl("view-recibos");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Recibos" }
    ]);
    // Ocultar botón "Nuevo" para viewer
    const btnNuevoRecibo = document.querySelector(".btn-nuevo-recibo");
    if (btnNuevoRecibo) {
      btnNuevoRecibo.style.display = ["admin", "worker"].includes(currentUserRole) ? "" : "none";
    }
    cargarRecibos();

  }

  else if (view === "recibo-detalle") {

    showEl("view-recibo-detalle");
    updateBreadcrumb([
      { label: "Inicio",   action: () => navigateTo("dashboard") },
      { label: "Recibos", action: () => navigateTo("recibos") },
      { label: "Detalle" }
    ]);
    initReciboDetalleView(idx);

  }

  else if (view === "recibo-nuevo") {

    if (!["admin", "worker"].includes(currentUserRole)) {
      navigateTo("recibos");
      return;
    }
    showEl("view-recibo-nuevo");
    updateBreadcrumb([
      { label: "Inicio",   action: () => navigateTo("dashboard") },
      { label: "Recibos", action: () => navigateTo("recibos") },
      { label: "Nuevo recibo" }
    ]);
    initReciboNuevoView();

  }

  else if (view === "movimientos") {

    if (!["admin", "worker", "finanzas"].includes(currentUserRole)) {
      navigateTo("dashboard");
      return;
    }
    showEl("view-movimientos");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Movimientos bancarios" }
    ]);
    cargarMovimientos();
    initCustomSelect("mov-filtro-tipo");

  }

  else if (view === "movimiento-nuevo") {

    if (!["admin", "worker"].includes(currentUserRole)) {
      navigateTo("movimientos");
      return;
    }
    showEl("view-movimiento-nuevo");
    updateBreadcrumb([
      { label: "Inicio",                  action: () => navigateTo("dashboard") },
      { label: "Movimientos bancarios",   action: () => navigateTo("movimientos") },
      { label: "Nuevo movimiento" }
    ]);
    iniciarFormMovimiento();

  }

  else if (view === "calendario") {

    showEl("view-calendario");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Calendario" }
    ]);
    initCalendario();

  }

  // Restaurar scroll (volviendo con "atrás") o arrancar arriba (navegación nueva)
  if (_fromHash && _pendingScrollY != null) {
    _restoreScroll(_pendingScrollY);
    // Se limpia con demora: si una vista termina de cargar contenido async
    // (ej. el panel reabriendo secciones colapsables) puede reajustar el
    // scroll una vez más antes de que se descarte el valor guardado.
    setTimeout(() => { _pendingScrollY = null; }, 1500);
  } else if (!_fromHash) {
    _pendingScrollY = null;
    window.scrollTo(0, 0);
  }
}

function updateBreadcrumb(items) {
  const container = document.getElementById("breadcrumb");
  container.innerHTML = "";
  items.forEach((item, i) => {
    const isLast = i === items.length - 1;
    if (isLast) {
      const span = document.createElement("span");
      span.className = "bc-current";
      span.textContent = item.label;
      container.appendChild(span);
    } else {
      const link = document.createElement("span");
      link.className = "bc-link";
      link.textContent = item.label;
      if (item.action) link.addEventListener("click", item.action);
      container.appendChild(link);
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "›";
      container.appendChild(sep);
    }
  });
}

// ── Carga ──────────────────────────────────────────────────
async function loadPassengers() {
  if (_loadPassengersPromise) return _loadPassengersPromise;
  _loadPassengersPromise = _loadPassengersImpl().finally(() => {
    _loadPassengersPromise = null;
  });
  return _loadPassengersPromise;
}

// Garantiza que allPassengers esté poblado antes de continuar. Necesario
// cuando se entra directo a una vista que depende de la lista (detalle,
// historial-viajes) sin haber pasado antes por "clientes" — típicamente
// al recargar la página con ese hash en la URL.
async function garantizarPassengersCargados() {
  if (allPassengers.length > 0) return;
  await loadPassengers();
}

async function _loadPassengersImpl() {
  setListState("loading");
  const { data, error } = await supabaseClient
    .from("pasajeros")
    .select(`id, Pasajero, "Documento de Identidad", Vendedor, "Fecha de nacimiento", Sexo, "E-mail", avatar_path`)
    .order("Pasajero", { ascending: true });

  if (error) { console.error(error); setListState("error"); return; }
  allPassengers = data.map((p, i) => ({ ...p, _idx: i }));

  // Cargar URLs públicas de avatars que existan
  allPassengers.forEach(p => {
    if (p.avatar_path) {
      const { data: urlData } = supabaseClient.storage
        .from("avatars")
        .getPublicUrl(p.avatar_path);
      if (urlData?.publicUrl) avatarCache[p._idx] = urlData.publicUrl;
    }
  });

  renderList(allPassengers);
}

// ── Render lista ───────────────────────────────────────────
function renderList(passengers) {
  const listEl  = document.getElementById("passenger-list");
  const countEl = document.getElementById("passenger-count");
  countEl.textContent = `${passengers.length} pasajero${passengers.length !== 1 ? "s" : ""}`;

  if (passengers.length === 0) { setListState("empty"); return; }

  const existing = {};
  listEl.querySelectorAll(".passenger-row[data-idx]").forEach(el => {
    existing[el.dataset.idx] = el;
  });

  const fragment = document.createDocumentFragment();
  passengers.forEach((p, i) => {
    let row = existing[p._idx];
    if (!row) row = createRow(p, i);
    fragment.appendChild(row);
  });

  const stateEl = listEl.querySelector(".list-state");
  if (stateEl) stateEl.remove();
  listEl.replaceChildren(fragment);
}

function createRow(p, i) {
  const name = p.Pasajero || "Sin nombre";
  const ci   = p["Documento de Identidad"] || "—";
  const row  = document.createElement("div");
  row.className = "passenger-row";
  row.dataset.idx = p._idx;

  row.onclick = () => {
    // El nombre puesto al *entrar* a la vista "clientes" no alcanza:
    // si hubo scroll, filtro, o un refresh de renderList de por medio,
    // esta fila es un nodo DOM distinto al de aquella vez. Lo asignamos
    // acá, en el click mismo, que es el momento real en que arranca
    // la transición hacia el detalle.
    const avatarEl = row.querySelector(".p-avatar");
    if (avatarEl) avatarEl.style.viewTransitionName = `avatar-${p._idx}`;
    // navigateTo recibe el id real (estable en la URL), no _idx (posición
    // en el array, que puede cambiar de sesión a sesión).
    navigateTo("detalle", p.id);
  };

  const avatarInner = avatarCache[p._idx]
    ? `<img src="${avatarCache[p._idx]}" alt="${name}" />`
    : `<span>${getInitials(name)}</span>`;

  row.innerHTML = `
    <div class="p-avatar">${avatarInner}</div>
    <div class="p-name">${name}</div>
    <span class="p-pill">CI ${ci}</span>
    <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>`;
  return row;
}

function setListState(type) {
  const states = {
    loading: `<div class="list-state"><div class="icon">⏳</div>Cargando pasajeros…</div>`,
    error:   `<div class="list-state"><div class="icon">⚠️</div>Error al cargar los datos.</div>`,
    empty:   `<div class="list-state"><div class="icon">🔍</div>Sin resultados.</div>`,
  };
  document.getElementById("passenger-list").innerHTML = states[type] || "";
}

// ── Buscador ───────────────────────────────────────────────
let searchTimer = null;
let searchToken = 0; // evita que una respuesta vieja pise a una más nueva

function filterPassengers() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = document.getElementById("search-input").value.trim();

    // Caja vacía: se mantiene el comportamiento actual (lista completa local)
    if (!q) {
      renderList(allPassengers);
      return;
    }

    const myToken = ++searchToken;
    setListState("loading");

    const { data, error } = await supabaseClient
      .rpc("buscar_pasajeros", { busqueda: q });

    if (myToken !== searchToken) return; // llegó tarde, se descarta

    if (error) { console.error(error); setListState("error"); return; }

    // Se fusionan los resultados dentro de allPassengers para conservar
    // _idx estable (usado por navigateTo("detalle", ...) y avatarCache)
    const results = (data || []).map(p => {
      let existing = allPassengers.find(x =>
        x.id != null && x.id === p.id);
      if (existing) return Object.assign(existing, p);

      const withIdx = { ...p, _idx: allPassengers.length };
      allPassengers.push(withIdx);

      if (withIdx.avatar_path && avatarCache[withIdx._idx] === undefined) {
        const { data: urlData } = supabaseClient.storage
          .from("avatars")
          .getPublicUrl(withIdx.avatar_path);
        if (urlData?.publicUrl) avatarCache[withIdx._idx] = urlData.publicUrl;
      }
      return withIdx;
    });

    renderList(results);
  }, 160);
}

// Se muestra cuando renderDetalle no logra resolver el pasajero (id
// inexistente, o un enlace/hash inválido). Evita dejar la pantalla en
// blanco con los campos de la última vista renderizada.
function mostrarDetalleNoEncontrado() {
  const contenidoEl = document.getElementById("detalle-contenido");
  const noEncontradoEl = document.getElementById("detalle-no-encontrado");
  if (contenidoEl) contenidoEl.style.display = "none";
  if (noEncontradoEl) noEncontradoEl.style.display = "";
}

// ── Detalle ────────────────────────────────────────────────
// pasajeroId es el id real de la tabla "pasajeros" (estable en la URL).
// Internamente seguimos usando p._idx para todo lo que ya dependía de él
// (avatar cache, dataset del DOM, view-transition-name).
async function renderDetalle(pasajeroId) {
  await garantizarPassengersCargados();

  const p = allPassengers.find(x => x.id === pasajeroId);
  if (!p) {
    mostrarDetalleNoEncontrado();
    return;
  }

  // Encontrado: asegurar que el contenido normal esté visible (por si
  // quedó oculto de un intento previo con un id inválido).
  const contenidoEl = document.getElementById("detalle-contenido");
  const noEncontradoEl = document.getElementById("detalle-no-encontrado");
  if (contenidoEl) contenidoEl.style.display = "";
  if (noEncontradoEl) noEncontradoEl.style.display = "none";

  const idx = p._idx;
  const name = p.Pasajero || "Sin nombre";

  _ultimoDetalleIdx = idx;

  const avatarEl = document.getElementById("detalle-avatar");
  const wrapEl   = avatarEl.closest(".detalle-avatar-wrap") || avatarEl.parentElement;
  const imgEl    = avatarEl.querySelector("img");
  const initEl   = avatarEl.querySelector(".d-initials");

  // El avatar de origen (row en la lista) trae el nombre puesto por
  // navigateTo. Lo retiramos de ahí en el mismo instante en que lo
  // ponemos acá, para que nunca haya dos elementos con el mismo
  // view-transition-name vivos a la vez (eso aborta la transición).
  const rowOrigenEl = document.querySelector(`.passenger-row[data-idx="${idx}"] .p-avatar`);
  if (rowOrigenEl) rowOrigenEl.style.viewTransitionName = "";
  avatarEl.style.viewTransitionName = `avatar-${idx}`;
  wrapEl.dataset.idx   = idx;
  avatarEl.dataset.idx = idx;

  if (avatarCache[idx]) {
    imgEl.src = avatarCache[idx];
    imgEl.style.display = "block";
    initEl.style.display = "none";
  } else {
    imgEl.style.display = "none";
    initEl.style.display = "block";
    initEl.textContent = getInitials(name);
  }

  document.getElementById("detalle-name").textContent = name;
  if (currentView === "detalle" && selectedIdx === pasajeroId) {
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: name }
    ]);
  }
  setField("d-nombre-full", p.Pasajero);
  setField("d-ci",          p["Documento de Identidad"]);
  setField("d-fecha",       formatDate(p["Fecha de nacimiento"]));
  setField("d-sexo",        p.Sexo);
  setField("d-email",       p["E-mail"]);
  setField("d-vendedor",    p.Vendedor);

  // Mostrar botón editar solo para admin y worker
  const btnEditar = document.getElementById("btn-editar-detalle");
  if (btnEditar) {
    btnEditar.style.display = ["admin", "worker"].some(r =>
      Array.isArray(currentUserRole) ? currentUserRole.includes(r) : currentUserRole === r
    ) ? "" : "none";
  }

  // Asegurar modo lectura al renderizar
  cancelarEdicionDetalle(true);

  // ── Contacto de emergencia (FAB SOS) ───────────────
  setFabSosVisible(true);
  cargarContactoEmergencia(p.id);

  // ── Datos de viajes del pasajero ──────────────────
  document.getElementById("d-club-destino").textContent  = "…";
  document.getElementById("d-total-viajes").textContent  = "…";
  document.getElementById("d-ultimo-viaje").textContent  = "…";

  const { data: vps } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      asistencia,
      viajes ( nombre, fecha_salida )
    `)
    .eq("pasajero_id", p.id)
    .eq("asistencia", "Asiste");

  if (!vps || vps.length === 0) {
    document.getElementById("d-club-destino").innerHTML = `<span style="color:var(--text-muted)">No miembro</span>`;
    document.getElementById("d-total-viajes").textContent = "0";
    document.getElementById("d-ultimo-viaje").textContent = "Sin viajes";
    return;
  }

  const totalViajes = vps.length;
  const esmiembro   = totalViajes >= 3;

  // Último viaje por fecha_salida
  const conFecha = vps.filter(v => v.viajes?.fecha_salida);
  conFecha.sort((a, b) => b.viajes.fecha_salida.localeCompare(a.viajes.fecha_salida));
  const ultimoNombre = conFecha.length > 0
    ? conFecha[0].viajes.nombre
    : (vps[0].viajes?.nombre || "—");

  document.getElementById("d-club-destino").innerHTML = esmiembro
    ? `<span style="color:var(--accent);font-weight:600">⭐ Miembro</span>`
    : `<span style="color:var(--text-muted)">No miembro</span>`;
  document.getElementById("d-total-viajes").textContent = totalViajes;
  const cardViajes = document.getElementById("card-total-viajes");
  if (cardViajes) cardViajes.onclick = () => irAHistorialViajes(p.id);
  document.getElementById("d-ultimo-viaje").textContent = ultimoNombre;
}

async function activarEdicionDetalle() {
  const p = allPassengers.find(x => x.id === selectedIdx);
  if (!p) return;

  const esAdmin = Array.isArray(currentUserRole)
    ? currentUserRole.includes("admin")
    : currentUserRole === "admin";

  // Poblar inputs con valores actuales
  document.getElementById("e-nombre").value  = p.Pasajero || "";
  document.getElementById("e-ci").value      = p["Documento de Identidad"] || "";
  document.getElementById("e-sexo").value    = p.Sexo || "";
  document.getElementById("e-fecha").value   = p["Fecha de nacimiento"] || "";
  document.getElementById("e-email").value   = p["E-mail"] || "";
  initCustomSelect("e-sexo");
  refreshCustomSelect("e-sexo");

  // Deshabilitar guardado mientras se carga el select de vendedor,
  // para evitar guardar con el campo vacío si se hace click antes de tiempo.
  const btnGuardar = document.getElementById("btn-guardar-detalle");
  if (btnGuardar) btnGuardar.disabled = true;

  // Cargar select vendedores y marcar el actual — esperar a que termine antes de continuar
  await cargarVendedores("e-vendedor", p.Vendedor || "");
  const selVend = document.getElementById("e-vendedor");
  if (selVend) {
    selVend.disabled = !esAdmin;
    selVend.style.opacity = esAdmin ? "" : "0.5";
    selVend.title = esAdmin ? "" : "Solo admin puede cambiar el vendedor";
  }

  if (btnGuardar) btnGuardar.disabled = false;

  // Alternar vistas
  document.getElementById("detalle-fields-view").style.display  = "none";
  document.getElementById("detalle-fields-edit").style.display  = "";
  document.getElementById("detalle-empresa-view").style.display = "none";
  document.getElementById("detalle-empresa-edit").style.display = "";
  document.getElementById("detalle-edit-actions").style.display = "";
  document.getElementById("btn-editar-detalle").style.display   = "none";
  document.getElementById("detalle-edit-feedback").style.display = "none";
}

function cancelarEdicionDetalle(silencioso = false) {
  document.getElementById("detalle-fields-view").style.display  = "";
  document.getElementById("detalle-fields-edit").style.display  = "none";
  document.getElementById("detalle-empresa-view").style.display = "";
  document.getElementById("detalle-empresa-edit").style.display = "none";
  document.getElementById("detalle-edit-actions").style.display = "none";
  document.getElementById("detalle-edit-feedback").style.display = "none";
  const btnEditar = document.getElementById("btn-editar-detalle");
  if (btnEditar && !silencioso) btnEditar.style.display = "";
}

async function guardarEdicionDetalle() {
  const p = allPassengers.find(x => x.id === selectedIdx);
  if (!p) return;

  const nombre = document.getElementById("e-nombre").value.trim();
  const ci     = document.getElementById("e-ci").value.trim();
  const sexo   = document.getElementById("e-sexo").value;

  if (!nombre || !ci || !sexo) {
    mostrarFeedbackDetalle("Completá los campos obligatorios.", false);
    return;
  }

  const btn = document.getElementById("btn-guardar-detalle");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const selVend = document.getElementById("e-vendedor");
  const vendedor = (selVend && !selVend.disabled)
    ? (selVend.value || null)
    : (p.Vendedor || null);

  const updates = {
    "Pasajero":               nombre,
    "Documento de Identidad": ci,
    "Sexo":                   sexo,
    "Fecha de nacimiento":    document.getElementById("e-fecha").value || null,
    "E-mail":                 document.getElementById("e-email").value.trim() || null,
    "Vendedor":               vendedor,
  };

  const { error } = await supabaseClient
    .from("pasajeros")
    .update(updates)
    .eq("id", p.id);

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cambios`;

  if (error) {
    mostrarFeedbackDetalle(
      error.code === "23505" ? "Ya existe un cliente con ese CI." : "Error al guardar. Intentá de nuevo.",
      false
    );
    return;
  }

  // Actualizar en memoria
  Object.assign(p, updates);
  cancelarEdicionDetalle();
  renderDetalle(selectedIdx);
  mostrarFeedbackDetalle("Cambios guardados correctamente.", true);
}

function mostrarFeedbackDetalle(msg, ok) {
  const el = document.getElementById("detalle-edit-feedback");
  el.textContent = msg;
  el.style.display = "";
  el.style.background = ok ? "#f0faf4" : "#fff0f0";
  el.style.color      = ok ? "#2d6a4f" : "#c0392b";
  el.style.border     = ok ? "1px solid rgba(45,106,79,.2)" : "1px solid rgba(192,57,43,.2)";
  if (ok) setTimeout(() => { el.style.display = "none"; }, 3000);
}

// ── Contacto de emergencia (FAB SOS + modal) ─────────────────
let _contactoActual = null; // fila actual en memoria, o null si no existe
let _fabSosUltimoFoco = null; // elemento a devolver el foco al cerrar el modal

function _puedeEditarContacto() {
  return ["admin", "worker"].some(r =>
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

async function cargarContactoEmergencia(pasajeroId) {
  const puede = _puedeEditarContacto();

  document.getElementById("contacto-fields-view").style.display = "";
  document.getElementById("contacto-fields-edit").style.display = "none";
  document.getElementById("contacto-empty").style.display = "none";
  document.getElementById("contacto-edit-actions").style.display = "none";
  document.getElementById("contacto-edit-feedback").style.display = "none";

  const { data, error } = await supabaseClient
    .from("contactos_emergencia")
    .select("*")
    .eq("pasajero_id", pasajeroId)
    .eq("es_principal", true)
    .maybeSingle();

  if (error) {
    console.error("Error al cargar contacto de emergencia:", error);
  }

  _contactoActual = data || null;

  const btnEditar  = document.getElementById("btn-editar-contacto");
  const btnAgregar = document.getElementById("btn-agregar-contacto");

  if (_contactoActual) {
    setField("c-nombre",      _contactoActual.nombre);
    setField("c-telefono",    _contactoActual.telefono);
    setField("c-parentesco",  _contactoActual.parentesco);

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

  document.getElementById("ce-nombre").value        = _contactoActual?.nombre || "";
  document.getElementById("ce-telefono").value       = _contactoActual?.telefono || "";
  document.getElementById("ce-parentesco").value     = _contactoActual?.parentesco || "";
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
    pasajero_id:    p.id,
    nombre,
    telefono,
    parentesco:     document.getElementById("ce-parentesco").value || null,
    observaciones:  document.getElementById("ce-observaciones").value.trim() || null,
    es_principal:   true,
  };

  let error;
  if (_contactoActual) {
    ({ error } = await supabaseClient
      .from("contactos_emergencia")
      .update(payload)
      .eq("id", _contactoActual.id));
  } else {
    ({ error } = await supabaseClient
      .from("contactos_emergencia")
      .insert(payload));
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar contacto`;

  if (error) {
    console.error("Error al guardar contacto de emergencia:", error);
    mostrarFeedbackContacto("Error al guardar. Intentá de nuevo.", false);
    return;
  }

  await cargarContactoEmergencia(p.id);
  mostrarFeedbackContacto("Contacto guardado correctamente.", true);
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

// ── Avatar ─────────────────────────────────────────────────
function triggerAvatarUpload() {
  document.getElementById("avatar-file-input").click();
}

async function handleAvatarUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const idx = parseInt(document.getElementById("detalle-avatar").dataset.idx);
  const p   = allPassengers.find(x => x._idx === idx);
  if (!p) return;
  event.target.value = "";

  // Mostrar preview inmediato mientras sube
  const reader = new FileReader();
  reader.onload = e => {
    avatarCache[idx] = e.target.result;
    renderDetalle(p.id);
    const row = document.querySelector(`.passenger-row[data-idx="${idx}"]`);
    if (row) row.querySelector(".p-avatar").innerHTML = `<img src="${avatarCache[idx]}" alt="" />`;
  };
  reader.readAsDataURL(file);

  // Subir a Supabase Storage
  const ext      = file.name.split(".").pop();
  const filePath = `${p.id}.${ext}`;

  const { error: upError } = await supabaseClient.storage
    .from("avatars")
    .upload(filePath, file, { upsert: true, contentType: file.type });

  if (upError) {
    console.error("Error subiendo avatar:", upError);
    mostrarFeedbackDetalle("Error al subir la foto. Intentá de nuevo.", false);
    return;
  }

  // Guardar la ruta en la tabla pasajeros
  const { error: dbError } = await supabaseClient
    .from("pasajeros")
    .update({ avatar_path: filePath })
    .eq("id", p.id);

  if (dbError) {
    console.error("Error guardando avatar_path:", dbError);
    mostrarFeedbackDetalle("Foto subida pero no se pudo registrar en la base de datos.", false);
    return;
  }

  p.avatar_path = filePath;
  mostrarFeedbackDetalle("Foto actualizada correctamente.", true);
}

// ── Helpers ────────────────────────────────────────────────
function getInitials(name) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
}

function formatDate(val) {
  if (!val) return null;
  const [year, month, day] = val.split("-");
  if (!day) return val;
  return `${day}/${month}/${year}`;
}

function setField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value) { el.textContent = value; el.classList.remove("empty"); }
  else       { el.textContent = "No registrado"; el.classList.add("empty"); }
}

// ══════════════════════════════════════════════════════════
// BOTTOM NAVBAR — Inicio / Módulos / Más
// El sheet de "Módulos" es el inventario de accesos a los módulos
// de la app (mismos slugs, íconos y reglas de visibilidad por rol
// que antes tenía la vista de inicio, ya eliminada), con nombres
// cortos, sin descripción y en grid de 3.
// ══════════════════════════════════════════════════════════
const MODULOS_MENU = [
  { slug: "clientes",           label: "Clientes",   img: "cliente.png",   bg: "rgba(45,106,79,.12)", roles: ["admin", "worker", "viewer"] },
  { slug: "viajes",             label: "Viajes",      img: "viajes.png",    bg: "rgba(45,106,79,.12)" },
  { slug: "recibos",            label: "Recibos",     img: "recibo.png",    bg: "rgba(201,168,76,.18)" },
  { slug: "movimientos",        label: "Movimientos", img: "bancario.png",  bg: "rgba(45,106,79,.16)", roles: ["admin", "worker", "finanzas"] },
  { slug: "byc",                label: "Estado ByC",  img: "byc.png",       bg: "rgba(70,130,180,.15)", roles: ["admin", "worker", "viewer"] },
  { slug: "historico",          label: "Histórico",   img: "historial.png", bg: "rgba(120,120,140,.15)" },
  { slug: "seleccion-asiento",  label: "Asientos",    img: "asiento.png",   bg: "rgba(45,106,79,.12)" },
  { slug: "usuarios",           label: "Usuarios",    img: "staff.png",     bg: "rgba(124,92,196,.15)", roles: ["admin"] },
];

// Precarga en memoria del navegador (no solo en el cache del SW) de los
// íconos del sheet de módulos. El SW ya los responde rápido desde disco,
// pero el <img> del sheet solo se crea cuando el usuario lo abre, y ese
// primer fetch sigue siendo asíncrono. Creando un objeto Image() por
// adelantado, el navegador ya tiene el bitmap decodificado en su propia
// caché de memoria para cuando el sheet realmente se renderiza —
// eliminando el parpadeo/lag de la primera apertura.
// Se llama una sola vez, apenas se confirma el rol (ver enterApp()),
// para no precargar íconos de módulos a los que el usuario no tiene acceso.
let _modulosIconosPrecargados = false;
function _precargarIconosModulos() {
  if (_modulosIconosPrecargados) return;
  _modulosIconosPrecargados = true;
  MODULOS_MENU
    .filter(m => !m.roles || m.roles.includes(currentUserRole))
    .forEach(m => { new Image().src = `/img/${m.img}`; });
}

function _renderModulosSheet() {
  const grid = document.getElementById("modulos-sheet-grid");
  if (!grid) return;
  const visibles = MODULOS_MENU.filter(m => !m.roles || m.roles.includes(currentUserRole));
  grid.innerHTML = visibles.map(m => `
    <button type="button" class="modulo-item" style="--modulo-icon-bg:${m.bg}" onclick="navigateTo('${m.slug}'); closeModulosSheet();">
      <span class="modulo-item-icon">
        <img src="/img/${m.img}" alt="" width="24" height="24">
      </span>
      <span class="modulo-item-label">${m.label}</span>
    </button>
  `).join("");
}

// Marca si hay una entrada de historial "de más" agregada al abrir el
// sheet, específicamente para que el botón/gesto atrás lo cierre en vez
// de navegar en el SPA. La consume el listener de popstate de arriba.
let _modulosSheetHistoryEntryOpen = false;

function _closeModulosSheetUI() {
  const sheet = document.getElementById("modulos-sheet");
  const overlay = document.getElementById("modulos-overlay");
  const btn = document.getElementById("bn-modulos");
  if (sheet) sheet.classList.remove("open");
  if (overlay) overlay.classList.remove("open");
  if (btn) { btn.classList.remove("active"); btn.setAttribute("aria-expanded", "false"); }
  document.body.style.overflow = "";
}

function toggleModulosSheet() {
  const sheet = document.getElementById("modulos-sheet");
  const overlay = document.getElementById("modulos-overlay");
  const btn = document.getElementById("bn-modulos");
  if (!sheet || !overlay) return;
  const abrir = !sheet.classList.contains("open");
  if (abrir) {
    _renderModulosSheet();
    // Entrada extra en el historial: así "atrás" cierra el sheet en vez
    // de navegar a la vista anterior del SPA (ver popstate más arriba).
    history.pushState({ modulosSheet: true }, "", location.hash);
    _modulosSheetHistoryEntryOpen = true;
  }
  sheet.classList.toggle("open", abrir);
  overlay.classList.toggle("open", abrir);
  if (btn) { btn.classList.toggle("active", abrir); btn.setAttribute("aria-expanded", String(abrir)); }
  document.body.style.overflow = abrir ? "hidden" : "";
}

function closeModulosSheet() {
  // Si el cierre viene de tocar la X, el overlay, o elegir un módulo (no
  // del botón atrás), todavía queda pendiente la entrada de historial
  // que agregamos al abrir. La colapsamos con replaceState (en vez de
  // history.back()) para no competir con una navegación que pueda
  // haber ocurrido en el mismo gesto (ej. elegir un módulo hace
  // navigateTo(slug) justo antes de este cierre, lo que ya empujó el
  // hash del destino): replaceState toma el hash actual tal cual esté
  // en ese momento y solo descarta la entrada extra, sin retroceder.
  if (_modulosSheetHistoryEntryOpen) {
    _modulosSheetHistoryEntryOpen = false;
    history.replaceState({ scrollY: window.scrollY }, "", location.hash);
  }
  _closeModulosSheetUI();
}

// Resalta "Inicio" cuando la vista activa es el dashboard (que ahora
// hace las veces de pantalla principal de la app), y "Calendario"
// (acceso directo fijo) cuando la vista activa es esa.
function _updateBottomNavActiveState(view) {
  const btnInicio = document.getElementById("bn-inicio");
  if (btnInicio) btnInicio.classList.toggle("active", view === "dashboard");

  const btnShortcut = document.getElementById("bn-shortcut");
  if (btnShortcut) btnShortcut.classList.toggle("active", view === "calendario");
}

// ══════════════════════════════════════════════════════════
// ACCESO DIRECTO (3er botón del navbar) — fijo a Calendario
// Antes era configurable (el usuario elegía el módulo); ahora apunta
// siempre a Calendario. Se deja como función (en vez de solo el
// onclick inline del HTML) por si en el futuro se quiere resaltar
// el botón según la vista activa, igual que antes.
// ══════════════════════════════════════════════════════════
function onShortcutTap() {
  navigateTo("calendario");
}

// ── Menú hamburguesa ───────────────────────────────────────
function toggleMenu() {
  document.getElementById("hamburger-menu").classList.toggle("open");
}

function closeMenu() {
  document.getElementById("hamburger-menu").classList.remove("open");
}

// ── Tema claro/oscuro ──────────────────────────────────────
const THEME_KEY = "gt-theme";
const THEME_COLOR_LIGHT = "#1a3a2a";
const THEME_COLOR_DARK = "#15171a";

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);

  const metaColorScheme = document.getElementById("meta-color-scheme");
  if (metaColorScheme) metaColorScheme.setAttribute("content", theme === "dark" ? "dark" : "light");

  const iconDark = document.getElementById("theme-icon-dark");
  const iconLight = document.getElementById("theme-icon-light");
  const label = document.getElementById("theme-toggle-label");
  if (iconDark && iconLight && label) {
    if (theme === "dark") {
      iconDark.style.display = "none";
      iconLight.style.display = "";
      label.textContent = "Modo claro";
    } else {
      iconDark.style.display = "";
      iconLight.style.display = "none";
      label.textContent = "Modo oscuro";
    }
  }
}

function toggleTheme() {
  const next = getCurrentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
}

// Sincronizar el botón del menú con el tema ya aplicado (definido inline en <head>)
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(getCurrentTheme());
});

// Si el usuario no eligió tema manualmente, seguir la preferencia del sistema en vivo
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    if (!getStoredTheme()) applyTheme(e.matches ? "dark" : "light");
  });
}

// ── Modal Acerca de ────────────────────────────────────────
function abrirAcercaDe() {
  const modal = document.getElementById("modal-acerca");
  if (!modal) return;
  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
}

function cerrarAcercaDe(e) {
  // Si se pasa un evento, solo cerrar si el click fue en el overlay (no en el sheet)
  if (e && e.target !== document.getElementById("modal-acerca")) return;
  const modal = document.getElementById("modal-acerca");
  if (!modal) return;
  modal.style.display = "none";
  document.body.style.overflow = "";
}

// Cerrar al hacer click fuera
document.addEventListener("click", (e) => {
  const wrap = document.getElementById("hamburger-wrap") || e.target.closest(".hamburger-wrap");
  if (!e.target.closest(".hamburger-wrap")) closeMenu();
});

// ── Vendedores ─────────────────────────────────────────────
async function cargarVendedores(selectId, valorActual = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const lista = await getVendedores();
  const val = (valorActual || "").trim();
  sel.innerHTML = `<option value="">— Sin vendedor —</option>` +
    lista.map(n =>
      `<option value="${n.Nombre_del_vendedor}">${n.Nombre_del_vendedor}</option>`
    ).join("");
  // Asignar con sel.value es más robusto que confiar solo en el atributo "selected"
  // (evita fallos por display:none, encoding de acentos u orden del DOM)
  if (val) sel.value = val;
  // Sincronizar el trigger visual si este select ya fue inicializado como custom select
  refreshCustomSelect(selectId);
}

// ── Formulario nuevo cliente ───────────────────────────────
function limpiarFormulario() {
  ["f-nombre","f-ci","f-sexo","f-email","f-fecha"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = "";
    el.classList.remove("error");
  });
  // El select de vendedor se resetea por separado
  const selVend = document.getElementById("f-vendedor");
  if (selVend) { selVend.value = ""; selVend.classList.remove("error"); }
  const errEl = document.getElementById("form-error");
  if (errEl) errEl.textContent = "";
  const btn = document.getElementById("btn-guardar");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cliente`;
  }
}

async function guardarNuevoCliente() {
  ["f-nombre","f-ci","f-sexo"].forEach(id =>
    document.getElementById(id)?.classList.remove("error"));
  const errEl = document.getElementById("form-error");
  if (errEl) errEl.textContent = "";

  const nombre = document.getElementById("f-nombre").value.trim();
  const ci     = document.getElementById("f-ci").value.trim();
  const sexo   = document.getElementById("f-sexo").value;

  let valid = true;
  if (!nombre) { document.getElementById("f-nombre").classList.add("error"); valid = false; }
  if (!ci)     { document.getElementById("f-ci").classList.add("error");     valid = false; }
  if (!sexo)   { document.getElementById("f-sexo").classList.add("error");   valid = false; }

  if (!valid) {
    if (errEl) errEl.textContent = "Completá los campos obligatorios.";
    return;
  }

  const nuevo = {
    "Pasajero":               nombre,
    "Documento de Identidad": ci,
    "Sexo":                   sexo,
    "E-mail":                 document.getElementById("f-email").value.trim() || null,
    "Fecha de nacimiento":    document.getElementById("f-fecha").value || null,
    "Vendedor":               document.getElementById("f-vendedor").value.trim() || null,
  };

  const btn = document.getElementById("btn-guardar");
  if (btn) { btn.disabled = true; btn.textContent = "Guardando…"; }

  const { data, error } = await supabaseClient
    .from("pasajeros")
    .insert([nuevo])
    .select();

  if (error) {
    if (errEl) errEl.textContent = error.code === "23505"
      ? "Ya existe un cliente con ese CI."
      : "Error al guardar. Intentá de nuevo.";
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Guardar cliente`;
    }
    return;
  }

  // Agregar a memoria y volver a la lista
  const newIdx = allPassengers.length;
  allPassengers.push({ ...data[0], _idx: newIdx });
  allPassengers.sort((a, b) => (a.Pasajero || "").localeCompare(b.Pasajero || ""));
  allPassengers.forEach((p, i) => p._idx = i);

  navigateTo("clientes");
}

// ── Historial de viajes del pasajero ───────────────────────
// pasajeroId es el id real de la tabla "pasajeros" (mismo criterio que
// navigateTo("detalle", id)), para que el hash resultante sea estable.
function irAHistorialViajes(pasajeroId) {
  const idToUse = (pasajeroId !== undefined) ? pasajeroId : selectedIdx;
  const p = allPassengers.find(x => x.id === idToUse);
  if (!p) return;
  const total = document.getElementById("d-total-viajes")?.textContent;
  if (total === "0" || total === "…" || total === "—") return;
  navigateTo("historial-viajes", idToUse);
}

async function loadHistorialViajes(pasajeroId) {
  const listEl = document.getElementById("historial-list");
  listEl.innerHTML = `<div class="list-state"><div class="icon">⏳</div>Cargando viajes…</div>`;

  await garantizarPassengersCargados();
  const p = allPassengers.find(x => x.id === pasajeroId);
  if (!p) { listEl.innerHTML = `<div class="list-state"><div class="icon">⚠️</div>Pasajero no encontrado.</div>`; return; }

  const nombre = p.Pasajero || "Pasajero";
  document.getElementById("historial-titulo").textContent = nombre;
  if (currentView === "historial-viajes" && selectedIdx === pasajeroId) {
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Base de clientes", action: () => navigateTo("clientes") },
      { label: nombre, action: () => navigateTo("detalle", pasajeroId) },
      { label: "Historial de viajes" }
    ]);
  }

  const { data, error } = await supabaseClient
    .from("viaje_pasajeros")
    .select(`
      viaje_id,
      viajes ( nombre, fecha_salida, puntos_destino )
    `)
    .eq("pasajero_id", p.id)
    .eq("asistencia", "Asiste");

  if (error || !data || data.length === 0) {
    listEl.innerHTML = `<div class="list-state"><div class="icon">🔍</div>Sin viajes registrados.</div>`;
    return;
  }

  // Ordenar por fecha descendente
  data.sort((a, b) => {
    const fa = a.viajes?.fecha_salida || "";
    const fb = b.viajes?.fecha_salida || "";
    return fb.localeCompare(fa);
  });

  listEl.innerHTML = data.map((vp, i) => {
    const nombre  = vp.viajes?.nombre || "Viaje sin nombre";
    const fecha   = formatDate(vp.viajes?.fecha_salida) || "Fecha no registrada";
    const puntos  = vp.viajes?.puntos_destino != null ? vp.viajes.puntos_destino : "—";
    return `
      <div class="historial-viaje-row">
        <div class="hvr-num">${i + 1}</div>
        <div class="hvr-body">
          <div class="hvr-nombre">${nombre}</div>
          <div class="hvr-meta">
            <span class="hvr-fecha">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              ${fecha}
            </span>
            <span class="hvr-puntos">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${puntos} pts
            </span>
          </div>
        </div>
      </div>`;
  }).join("");
}

// Movimientos bancarios → ver movimientos.js

// ── Tabs de la vista Usuarios (App / Selección de asientos) ────────────────
// Carga perezosa: cada tab sólo pide sus datos a Supabase la primera vez
// que se abre, para no pegarle a ambos backends si el admin sólo usa uno.
const _usuariosTabsLoaded = { app: false, reservas: false };

function switchUsuariosTab(tab, opts = {}) {
  const isApp = tab === "app";

  document.getElementById("tab-panel-app").style.display = isApp ? "" : "none";
  document.getElementById("tab-panel-reservas").style.display = isApp ? "none" : "";

  document.getElementById("tab-btn-app").classList.toggle("active", isApp);
  document.getElementById("tab-btn-reservas").classList.toggle("active", !isApp);
  document.getElementById("tab-btn-app").setAttribute("aria-selected", String(isApp));
  document.getElementById("tab-btn-reservas").setAttribute("aria-selected", String(!isApp));

  if (opts.force || !_usuariosTabsLoaded[tab]) {
    if (isApp) {
      loadUsers();
    } else {
      loadUsersReservas();
    }
    _usuariosTabsLoaded[tab] = true;
  }
}

// ── Última conexión (staff.last_seen) ───────────────────────
// Se llama una vez por sesión al resolver enterApp(). Fire-and-forget:
// un fallo acá nunca debe bloquear ni afectar el flujo de login.
// Usa un RPC (security definer) en vez de UPDATE directo porque la policy
// RLS de UPDATE sobre "staff" solo permite escribir al admin — el RPC
// esquiva esa restricción de forma acotada, tocando solo last_seen y
// solo la fila del propio usuario autenticado (ver last_seen.sql).
async function touchLastSeen(_staffId) {
  const { error } = await supabaseClient.rpc("touch_last_seen");
  if (error) console.warn("No se pudo registrar last_seen:", error);
}
