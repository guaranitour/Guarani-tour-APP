// Requiere que en index.html ya estén cargados, en este orden:
//   1) firebase-app-compat.js
//   2) firebase-messaging-compat.js
//   3) firebase-config.js   (define firebaseConfig y FIREBASE_VAPID_KEY)
//   4) supabaseClient.js    (define supabaseClient)
// y luego este archivo.

alert("DEBUG: push-notifications.js CARGADO");

const firebaseApp = firebase.initializeApp(firebaseConfig);
alert("DEBUG: firebase.initializeApp OK");
const messaging = firebase.messaging();
alert("DEBUG: firebase.messaging() OK");

async function initPushNotifications(staffId) {
  try {
    if (!("Notification" in window)) { alert("DEBUG: Notification API no soportada"); return null; }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") { alert("DEBUG: permiso NO otorgado: " + permission); return null; }
    alert("DEBUG: permiso OK, registrando SW...");

    const registration = await navigator.serviceWorker.register(
      '/Guarani-tour-APP/firebase-messaging-sw.js',
      { scope: '/Guarani-tour-APP/firebase-cloud-messaging-push-scope' }
    );
    alert("DEBUG: SW registrado, pidiendo token...");

    const token = await messaging.getToken({
      vapidKey: FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration
    });
    alert("DEBUG: token = " + (token ? token.slice(0, 20) + "..." : "NULO/VACÍO"));

    if (token) await savePushToken(staffId, token);
    return token;
  } catch (err) {
    alert("DEBUG ERROR: " + err.message);
    console.error("Error al inicializar notificaciones:", err);
    return null;
  }
}

async function savePushToken(staffId, token) {
  alert("DEBUG: guardando en Supabase, staffId=" + staffId);
  const { error } = await supabaseClient
    .from("push_tokens")
    .upsert(
      { staff_id: staffId, token, last_used_at: new Date().toISOString() },
      { onConflict: "token" }
    );
  if (error) alert("DEBUG SUPABASE ERROR: " + JSON.stringify(error));
  else alert("DEBUG: guardado OK");
}

messaging.onMessage((payload) => {
  console.log("Mensaje en foreground:", payload);
  if (typeof showToast === "function") {
    showToast(payload.notification?.body || "Nueva notificación", "success");
  }
});
