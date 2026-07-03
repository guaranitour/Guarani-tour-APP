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
  try {
    if (!("Notification" in window)) return null;

    // Solo registramos push si la app está instalada como PWA.
    // Así evitamos tokens duplicados (uno del navegador, otro de la PWA)
    // que generaban notificaciones repetidas.
    if (!isRunningAsPWA()) {
      console.log("No es PWA instalada: se omite registro de push.");
      return null;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register(
      '/Guarani-tour-APP/firebase-messaging-sw.js',
      { scope: '/Guarani-tour-APP/firebase-cloud-messaging-push-scope' }
    );

    const token = await messaging.getToken({
      vapidKey: FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (token) await savePushToken(staffId, token);
    return token;
  } catch (err) {
    console.error("Error al inicializar notificaciones:", err);
    return null;
  }
}

async function savePushToken(staffId, token) {
  // Guarda/actualiza el token actual
  const { error } = await supabaseClient
    .from("push_tokens")
    .upsert(
      { staff_id: staffId, token, last_used_at: new Date().toISOString() },
      { onConflict: "token" }
    );
  if (error) {
    console.error("Error guardando push token:", error);
    return;
  }

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
  }
}

messaging.onMessage((payload) => {
  console.log("Mensaje en foreground:", payload);
  if (typeof showToast === "function") {
    showToast(payload.notification?.body || "Nueva notificación", "success");
  }
});
