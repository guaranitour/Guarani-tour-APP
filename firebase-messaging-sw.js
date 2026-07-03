importScripts(
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/12.0.0/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyBrdh7b4Mkud0_FsCsn9OcPeiJoTjJAE1c",
  authDomain: "guarani-tour.firebaseapp.com",
  projectId: "guarani-tour",
  storageBucket: "guarani-tour.firebasestorage.app",
  messagingSenderId: "715907999724",
  appId: "1:715907999724:web:292ffc9c1cc5baa56d82c9"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};

  self.registration.showNotification(
    data.title || "Guaraní Tour",
    {
      body: data.body || "",
      icon: data.icon || "/Guarani-tour-APP/icons/guaranitour_192.png",
      image: data.image || undefined,
      data: { link: data.link || "/Guarani-tour-APP/#viajes" }
    }
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/Guarani-tour-APP/#viajes";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana/pestaña de la PWA abierta, la reutilizamos
      // y navegamos ahí directo a la vista de viajes.
      for (const client of windowClients) {
        if (client.url.includes("/Guarani-tour-APP/") && "focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      // Si no hay ninguna abierta, abrimos una nueva ya en esa vista.
      return clients.openWindow(link);
    })
  );
});
