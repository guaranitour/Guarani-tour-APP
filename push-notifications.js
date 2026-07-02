import { initializeApp } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging.js";

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

export async function initPushNotifications(staffId) {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const registration = await navigator.serviceWorker.register(
      '/Guarani-tour-APP/firebase-messaging-sw.js',
      { scope: '/Guarani-tour-APP/firebase-cloud-messaging-push-scope' }
    );

    const token = await getToken(messaging, {
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
  const { error } = await supabase
    .from("push_tokens")
    .upsert(
      { staff_id: staffId, token, last_used_at: new Date().toISOString() },
      { onConflict: "token" }
    );
  if (error) console.error("Error guardando push token:", error);
}

onMessage(messaging, (payload) => {
  console.log("Mensaje en foreground:", payload);
  // acá podés mostrar un toast propio de tu app
});
