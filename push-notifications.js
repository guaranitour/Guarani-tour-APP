// Requiere que en index.html ya estén cargados, en este orden:
//   1) firebase-app-compat.js
//   2) firebase-messaging-compat.js
//   3) firebase-config.js   (define firebaseConfig y FIREBASE_VAPID_KEY)
//   4) supabaseClient.js    (define supabaseClient)
// y luego este archivo.

const firebaseApp = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

async function initPushNotifications(staffId) {
  try {
    if (!("Notification" in window)) return null;

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
  const { error } = await supabaseClient
    .from("push_tokens")
    .upsert(
      { staff_id: staffId, token, last_used_at: new Date().toISOString() },
      { onConflict: "token" }
    );
  if (error) console.error("Error guardando push token:", error);
}

messaging.onMessage((payload) => {
  console.log("Mensaje en foreground:", payload);
  if (typeof showToast === "function") {
    showToast(payload.notification?.body || "Nueva notificación", "success");
  }
});
