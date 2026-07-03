// Requiere que en index.html ya estén cargados, en este orden:
//   1) firebase-app-compat.js
//   2) firebase-messaging-compat.js
//   3) firebase-config.js   (define firebaseConfig y FIREBASE_VAPID_KEY)
//   4) supabaseClient.js    (define supabaseClient)
// y luego este archivo.

const firebaseApp = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Detecta si la app corre instalada como PWA (standalone),
// y no como pestaña normal del navegador.
function isRunningAsPWA() {
  const isStandaloneDisplay = window.matchMedia(
    "(display-mode: standalone)"
  ).matches;
  const isIosStandalone = window.navigator.standalone === true; // Safari/iOS
  return isStandaloneDisplay || isIosStandalone;
}

async function initPushNotifications(staffId) {
  alert("DEBUG 1: inicio initPushNotifications, staffId=" + staffId);

  if (!("Notification" in window)) {
    alert("DEBUG: navegador no soporta Notification API");
    return { ok: false, reason: "unsupported" };
  }

  // Solo registramos push si la app está instalada como PWA.
  // Así evitamos tokens duplicados (uno del navegador, otro de la PWA)
  // que generaban notificaciones repetidas.
  if (!isRunningAsPWA()) {
    alert("DEBUG: no está corriendo como PWA instalada, se corta acá");
    return { ok: false, reason: "not_pwa" };
  }

  alert("DEBUG 2: sí es PWA. Notification.permission actual = " + Notification.permission);

  // Si ya está bloqueado a nivel navegador, ni intentamos pedir permiso:
  // el navegador no muestra el popup y solo devolvería "denied" de nuevo.
  if (Notification.permission === "denied") {
    alert("DEBUG: permiso ya está en 'denied' a nivel navegador. Bloqueado.");
    return { ok: false, reason: "blocked" };
  }

  let permission;
  try {
    permission = await Notification.requestPermission();
    alert("DEBUG 3: requestPermission devolvió = " + permission);
  } catch (err) {
    alert("DEBUG ERROR pidiendo permiso: " + err.message);
    return { ok: false, reason: "error", error: err };
  }

  if (permission !== "granted") {
    alert("DEBUG: permiso no fue 'granted', fue '" + permission + "'. Se corta acá.");
    return { ok: false, reason: "denied" };
  }

  try {
    alert("DEBUG 4: registrando service worker...");
    const registration = await navigator.serviceWorker.register(
      '/Guarani-tour-APP/firebase-messaging-sw.js',
      { scope: '/Guarani-tour-APP/firebase-cloud-messaging-push-scope' }
    );
    alert("DEBUG 5: service worker registrado OK. Pidiendo token FCM...");

    const token = await messaging.getToken({
      vapidKey: FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      alert("DEBUG: getToken devolvió vacío/null");
      return { ok: false, reason: "no_token" };
    }

    alert("DEBUG 6: token obtenido (primeros 20 caracteres): " + token.substring(0, 20) + "...");

    const saveResult = await savePushToken(staffId, token);
    if (!saveResult.ok) {
      alert("DEBUG 7: FALLÓ savePushToken. Error: " + JSON.stringify(saveResult.error));
      return { ok: false, reason: "save_failed", error: saveResult.error };
    }

    alert("DEBUG 8: ¡token guardado en Supabase con éxito!");
    return { ok: true, token };
  } catch (err) {
    alert("DEBUG ERROR en el bloque de registro/token: " + err.message);
    return { ok: false, reason: "error", error: err };
  }
}

// Función para colgar de un botón "Activar notificaciones" en la UI.
// Sirve para reintentar el registro (ej. si el primer intento falló
// en silencio) y para darle feedback real al usuario del motivo.
async function retryPushPermission(staffId) {
  const result = await initPushNotifications(staffId);

  if (result.ok) {
    if (typeof showToast === "function") {
      showToast("Notificaciones activadas ✅", "success");
    }
    return result;
  }

  let mensaje;
  switch (result.reason) {
    case "blocked":
      mensaje =
        "Las notificaciones están bloqueadas en tu navegador. " +
        "Entrá a Configuración del sitio (ícono de candado junto a la URL) " +
        "y activá los permisos de Notificaciones manualmente.";
      break;
    case "denied":
      mensaje = "No se activaron las notificaciones. Podés intentarlo de nuevo cuando quieras.";
      break;
    case "not_pwa":
      mensaje = "Instalá la app en tu pantalla de inicio para poder recibir notificaciones.";
      break;
    case "save_failed":
      mensaje = "El permiso se activó pero hubo un error guardando tu registro. Probá de nuevo.";
      console.error("Detalle save_failed:", result.error);
      break;
    default:
      mensaje = "No se pudieron activar las notificaciones. Probá de nuevo más tarde.";
      console.error("Detalle:", result.error);
  }

  if (typeof showToast === "function") {
    showToast(mensaje, "error");
  } else {
    alert(mensaje);
  }
  return result;
}

async function savePushToken(staffId, token) {
  alert("DEBUG savePushToken: staffId=" + staffId + " | token(20)=" + token.substring(0, 20));

  // Guarda/actualiza el token actual
  const { error } = await supabaseClient
    .from("push_tokens")
    .upsert(
      { staff_id: staffId, token, last_used_at: new Date().toISOString() },
      { onConflict: "token" }
    );
  if (error) {
    alert("DEBUG upsert FALLÓ: " + error.message + " | code=" + error.code + " | details=" + error.details);
    return { ok: false, error };
  }

  alert("DEBUG upsert OK, limpiando tokens viejos...");

  // Limpia tokens viejos del mismo staff (ej. de una pestaña de
  // navegador registrada antes de este cambio) para que no queden
  // notificaciones duplicadas.
  const { error: cleanupError } = await supabaseClient
    .from("push_tokens")
    .delete()
    .eq("staff_id", staffId)
    .neq("token", token);

  if (cleanupError) {
    console.error("Error limpiando tokens viejos:", cleanupError);
    // No es crítico: el token nuevo ya se guardó bien.
  }

  return { ok: true };
}

messaging.onMessage((payload) => {
  console.log("Mensaje en foreground:", payload);
  if (typeof showToast === "function") {
    showToast(payload.notification?.body || "Nueva notificación", "success");
  }
});
