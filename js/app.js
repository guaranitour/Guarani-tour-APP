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
  "activity-log","legales","informes"
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

  // Sincronizar foto de perfil de Google (si vino y cambió respecto a la guardada).
  // user.user_metadata puede venir stale: Supabase lo llena en el primer
  // signup y no lo refresca en logins posteriores a partir del objeto de
  // sesión guardado en localStorage. getUser() sí pega contra el servidor
  // y trae el metadata vigente del provider. Es una llamada de red extra,
  // pero solo se paga una vez por enterApp() y no bloquea el resto del
  // flujo (currentUserAvatar ya tiene un valor válido antes de que resuelva).
  let freshMetadata = user.user_metadata;
  try {
    const { data: fresh, error: userErr } = await supabaseClient.auth.getUser();
    if (!userErr && fresh?.user?.user_metadata) freshMetadata = fresh.user.user_metadata;
  } catch (e) {
    console.warn("No se pudo refrescar user_metadata, se usa el cacheado en sesión:", e);
  }

  const googleAvatar = freshMetadata?.avatar_url || freshMetadata?.picture || null;
  currentUserAvatar = data.avatar_url || googleAvatar || null;
  if (googleAvatar && googleAvatar !== data.avatar_url) {
    // UPDATE directo sobre "staff" fallaba en silencio para todo el mundo
    // salvo el admin hardcodeado en la policy de RLS. El RPC (security
    // definer) esquiva eso de forma acotada — solo toca avatar_url y solo
    // la fila del propio usuario autenticado (ver update_own_avatar.sql).
    supabaseClient
      .rpc("update_own_avatar", { new_avatar_url: googleAvatar })
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
    "byc","byc-vincular","informes"
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
// ── Toast del sistema ──────────────────────────────────────
// Único mecanismo de avisos de la app (estilos en css/native.css). Tipos:
// "success" | "error" | "warning" | "info". Si no se indica, se deduce del
// emoji inicial del mensaje (✅ ❌ ⚠️ 🕐 ℹ️) y, si no hay, es "success".
// Acepta también el booleano true como "error" (firma antigua de _appToast).
const _TOAST_ICONOS = {
  success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};
const _TOAST_EMOJI_RE = /^(✅|❌|⚠️?|🕐|ℹ️?)\s*/u;

function _appToast(msg, tipo, duracionMs = 3200) {
  let texto = String(msg ?? "");
  let t = tipo === true ? "error" : (typeof tipo === "string" ? tipo : "");
  if (!_TOAST_ICONOS[t]) {
    const m = texto.match(_TOAST_EMOJI_RE);
    if (!m) t = "success";
    else if (m[1] === "✅") t = "success";
    else if (m[1] === "❌") t = "error";
    else if (m[1].startsWith("⚠")) t = "warning";
    else t = "info";
  }
  texto = texto.replace(_TOAST_EMOJI_RE, ""); // el ícono ya lo pone el toast

  // Un solo toast a la vez; entra y sale con animación.
  document.querySelectorAll(".app-toast").forEach(x => x.remove());
  const el = document.createElement("div");
  el.className = "app-toast " + t;
  el.setAttribute("role", t === "error" ? "alert" : "status");
  const ico = document.createElement("span");
  ico.className = "app-toast-ico";
  ico.innerHTML = _TOAST_ICONOS[t];
  const txt = document.createElement("span");
  txt.textContent = texto;
  el.append(ico, txt);
  document.body.appendChild(el);
  if (t === "error" && typeof haptic === "function") haptic([30, 40, 30]);

  setTimeout(() => {
    el.classList.add("saliendo");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400); // por si la animación no corre (reduced motion)
  }, duracionMs);
}

// Usado por varios módulos; el segundo parámetro acepta true o el tipo.
function showToast(msg, tipo, duracionMs) {
  _appToast(msg, tipo, duracionMs);
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
  const objectIdxViews = ["egreso-detalle", "transferencia-detalle"];
  if (objectIdxViews.includes(view)) {
    navigateTo(_origenListaViajes().view, null, true);
    return;
  }
  if (view === "viaje-pasajero-pagos") {
    if (pagosCtx?.viajeId) {
      navigateTo("viaje-detalle", pagosCtx.viajeId, true);
    } else {
      navigateTo(_origenListaViajes().view, null, true);
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
      navigateTo(_origenListaViajes().view, null, true);
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
  "recibo-nuevo", "recibos", "seleccion-asiento", "transferencia-detalle",
  "usuarios", "viaje-detalle", "viaje-editar", "viaje-nuevo",
  "viaje-pasajero-nuevo", "viaje-pasajero-pagos", "viajes",
  "activity-log", "calendario", "facturas", "facturas-internas",
  "facturas-marangatu", "informes", "legales",
]);

// Profundidad de cada vista para elegir la dirección de la transición
// (ver css/native.css): 0 = inicio, 1 = lista/módulo, 2+ = detalle y
// subniveles. Las vistas no listadas cuentan como nivel 1.
const _NIVEL_VISTA = {
  "dashboard": 0,
  "detalle": 2, "nuevo": 2, "viaje-nuevo": 2, "viaje-detalle": 2,
  "historial-viajes": 2, "byc-vincular": 2, "recibo-detalle": 2,
  "recibo-nuevo": 2, "movimiento-nuevo": 2,
  "facturas-internas": 2, "facturas-marangatu": 2,
  "viaje-editar": 3, "viaje-pasajero-nuevo": 3, "viaje-pasajero-pagos": 3,
  "egreso-detalle": 3, "transferencia-detalle": 3,
  "pago-detalle": 4,
};

// "forward" (entra desde la derecha), "back" (sale hacia la derecha) o
// "fade" (mismo nivel, ej. entre módulos desde el menú).
function _direccionTransicion(desde, hacia) {
  const a = _NIVEL_VISTA[desde] ?? 1;
  const b = _NIVEL_VISTA[hacia] ?? 1;
  if (b > a) return "forward";
  if (b < a) return "back";
  return "fade";
}

function navigateTo(view, idx = null, _fromHash = false) {
  // Guard de acceso: finanzas no puede entrar a clientes, usuarios, byc
  // ni al detalle de un pasajero (tampoco desde Club Destino/ranking),
  // ni por menú ni por hash/URL directa ni por llamada programática.
  if (currentUserRole === "finanzas" && (view === "clientes" || view === "usuarios" || view === "byc" || view === "byc-vincular" || view === "detalle")) {
    view = "dashboard";
  }

  // Guard de acceso: viewer no puede entrar a clientes, byc/byc-vincular,
  // histórico ni Club Destino (incluye su vista de detalle y el ranking
  // de puntos), tampoco al alta de cliente, ni por menú ni por hash/URL
  // directa ni por llamada programática.
  if (currentUserRole === "viewer" && (view === "clientes" || view === "nuevo" || view === "byc" || view === "byc-vincular" || view === "historico" || view === "club-destino" || view === "ranking-puntos")) {
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
  // La dirección se publica en <html data-vt> mientras dura la transición;
  // css/native.css la usa para elegir la animación de "root".
  const _root = document.documentElement;
  _root.dataset.vt = _direccionTransicion(currentView, view);

  document.startViewTransition(() => {
    try {
      _navigateToImpl(view, idx, _fromHash);
    } catch (err) {
      console.error('[VT] EXCEPCIÓN dentro del callback:', err);
      throw err;
    }
  }).finished.catch((err) => {
    console.error('[VT] transición abortada:', err);
  }).finally(() => {
    delete _root.dataset.vt;
  });
}

// true cuando la vista se abre volviendo con "atrás"/adelante: los loaders
// lo usan para conservar filtros, búsqueda, pestaña y paginación.
let _navVolviendo = false;

function _navigateToImpl(view, idx = null, _fromHash = false) {

  _navVolviendo = !!_fromHash;
  currentView = view;
  selectedIdx = idx;

  // Actualizar hash (salvo que ya venga del popstate)
  if (!_fromHash) _setHash(view, idx);

  // Ocultar todas las vistas
  setFabSosVisible(false); // solo se re-muestra dentro de Detalle de pasajero
  const _modalSos = document.getElementById("modal-contacto");
  if (_modalSos && _modalSos.open) _modalSos.close();
  const _modalMarangatu = document.getElementById("marangatu-modal");
  if (_modalMarangatu && _modalMarangatu.open) _modalMarangatu.close();
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
  const _vtd = document.getElementById("view-transferencia-detalle");
  if (_vtd) _vtd.style.display = "none";
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
  const _vleg = document.getElementById("view-legales");
  if (_vleg) _vleg.style.display = "none";
  const _vfact = document.getElementById("view-facturas");
  if (_vfact) _vfact.style.display = "none";
  const _vfactint = document.getElementById("view-facturas-internas");
  if (_vfactint) _vfactint.style.display = "none";
  const _vfactmar = document.getElementById("view-facturas-marangatu");
  if (_vfactmar) _vfactmar.style.display = "none";
  const _vinf = document.getElementById("view-informes");
  if (_vinf) _vinf.style.display = "none";

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
    loadRankingPuntos({ conservarBusqueda: _navVolviendo });

  }

  else if (view === "club-destino") {

    showEl("view-club-destino");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Panel de control", action: () => navigateTo("dashboard") },
      { label: "Club Destino" }
    ]);
    loadClubDestino({ conservarBusqueda: _navVolviendo });

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

    // Al volver con "atrás" el buscador conserva su texto: la lista se
    // vuelve a filtrar con él en vez de mostrarse completa.
    const _searchEl = document.getElementById("search-input");
    // Entrando "de cero" (menú, botón) se limpia, para que el texto no
    // quede mostrado con la lista completa.
    if (_searchEl && !_navVolviendo) _searchEl.value = "";
    const _qBuscador = _navVolviendo ? (_searchEl?.value.trim() || "") : "";

    if (allPassengers.length === 0) {
      // loadPassengers es async: la fila no existe todavía cuando este
      // callback síncrono termine, así que el navegador tomaría el
      // snapshot "after" sin la fila y el morph no ocurriría. Por eso
      // esperamos a que termine de pintar antes de nombrar el elemento.
      loadPassengers().then(() => {
        _asignarNombreAvatar();
        if (_qBuscador) filterPassengers(true);
      });
    } else if (_qBuscador) {
      // Filtrado local inmediato (sin parpadeo) y luego se refina con la
      // búsqueda del servidor, igual que al tipear.
      const _ql = _qBuscador.toLowerCase();
      renderList(allPassengers.filter(p =>
        (p.Pasajero || "").toLowerCase().includes(_ql) ||
        String(p["Documento de Identidad"] || "").toLowerCase().includes(_ql)));
      _asignarNombreAvatar();
      filterPassengers(true);
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
    // Al volver con "atrás" se reabre la pestaña en la que estaba, sin
    // recargar su lista (switchUsuariosTab solo carga si no estaba cargada).
    switchUsuariosTab(_navVolviendo ? _usuariosTabActual : "app", { force: !_navVolviendo });
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
    loadActivityLog({ reset: true, restaurar: _navVolviendo });

  }

  else if (view === "legales") {

    if (!["admin", "worker"].includes(currentUserRole)) return;
    showEl("view-legales");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Legales" }
    ]);
    loadLegales();

  }

  else if (view === "informes") {

    if (!["admin", "worker", "finanzas"].includes(currentUserRole)) return;
    showEl("view-informes");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Informes" }
    ]);
    loadInformes();

  }

  else if (view === "facturas") {

    if (!["admin", "worker", "finanzas"].includes(currentUserRole)) return;
    showEl("view-facturas");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Facturas" }
    ]);

  }

  else if (view === "facturas-internas") {

    if (!["admin", "worker", "finanzas"].includes(currentUserRole)) return;
    showEl("view-facturas-internas");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Facturas", action: () => navigateTo("facturas") },
      { label: "Internas" }
    ]);
    loadFacturas();

  }

  else if (view === "facturas-marangatu") {

    if (!["admin", "worker", "finanzas"].includes(currentUserRole)) return;
    showEl("view-facturas-marangatu");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: "Facturas", action: () => navigateTo("facturas") },
      { label: "Marangatu" }
    ]);
    loadMarangatu();

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
    if (_navVolviendo && _historicoData.length > 0) {
      // Volviendo con "atrás": se conserva lo ya cargado (bloques de "Ver
      // más") y la búsqueda; solo se reaplica el filtro sobre el acumulado.
      allViajes = _historicoData;
      filtrarHistorico();
    } else {
      const _hs = document.getElementById("historico-search");
      if (_hs) _hs.value = "";
      loadViajes("historico");
    }

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
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Nuevo viaje" }
    ]);
    initCustomSelect("v-estado");

  }

  else if (view === "viaje-editar") {

    if (currentUserRole !== "admin") return;
    showEl("view-viaje-editar");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx) },
      { label: "Editar viaje" }
    ]);
    initFormEditarViaje(idx);

  }

  else if (view === "viaje-detalle") {

    showEl("view-viaje-detalle");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Detalle" }
    ]);
    loadViajeDetalle(idx);

  }

  else if (view === "viaje-pasajero-nuevo") {

    showEl("view-viaje-pasajero-nuevo");
    updateBreadcrumb([
      { label: "Inicio", action: () => navigateTo("dashboard") },
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
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
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", viajeId) },
      { label: nombrePasajero || "Pagos" }
    ]);
    initPagosView({ viajePasajeroId, viajeId, pasajeroId, nombrePasajero });

  }

  else if (view === "pago-detalle") {

    showEl("view-pago-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
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
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx?.viajeId) },
      { label: "Egreso" }
    ]);
    initEgresoDetalleView(idx);

  }

  else if (view === "transferencia-detalle") {

    showEl("view-transferencia-detalle");
    updateBreadcrumb([
      { label: "Inicio",  action: () => navigateTo("dashboard") },
      { label: _origenListaViajes().label, action: () => navigateTo(_origenListaViajes().view) },
      { label: "Detalle", action: () => navigateTo("viaje-detalle", idx?.viajeId) },
      { label: "Transferencia" }
    ]);
    initTransferenciaDetalleView(idx);

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


// Movimientos bancarios → ver movimientos.js


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
