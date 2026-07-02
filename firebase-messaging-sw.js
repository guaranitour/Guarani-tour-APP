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
  self.registration.showNotification(
    payload.notification.title,
    {
      body: payload.notification.body,
      icon: "/Guarani-tour-APP/icons/guaranitour_192.png"
    }
  );
});
