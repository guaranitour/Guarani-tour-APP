// ota.js — actualizaciones por aire (OtaKit) solo para la app nativa (Capacitor).
// En la PWA no hace nada. Al abrir la app y al volver a primer plano consulta si
// hay una versión nueva; si la hay, muestra un aviso bloqueante con un único botón
// "Actualizar" (sin "más tarde") que descarga la versión y recarga la app.

(function () {
  const esNativa = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (!esNativa) return;

  const OtaKit = window.Capacitor.Plugins && window.Capacitor.Plugins.OtaKit;
  if (!OtaKit) return;

  // Sin esto OtaKit revierte la versión recién activada.
  window.addEventListener("load", () => {
    OtaKit.notifyAppReady().catch((e) => console.warn("[ota] notifyAppReady:", e));
  });

  let modal = null;
  let verificando = false;

  function mostrarAviso() {
    if (modal) return;
    modal = document.createElement("div");
    modal.id = "ota-aviso";
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <style>
        #ota-aviso { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center;
          justify-content: center; padding: 24px; background: rgba(10,31,80,.72); }
        #ota-aviso .ota-card { width: 100%; max-width: 340px; padding: 24px 22px; border-radius: 16px;
          background: var(--surface, #fff); color: var(--text, #1a1a1a); text-align: center;
          box-shadow: 0 12px 40px rgba(0,0,0,.35); }
        #ota-aviso h2 { margin: 0 0 8px; font-size: 1.1rem; }
        #ota-aviso p { margin: 0 0 18px; font-size: .9rem; color: var(--text-mid, #555); }
        #ota-aviso button { width: 100%; padding: 12px; border: 0; border-radius: 10px; font-size: 1rem;
          font-weight: 600; color: #fff; background: var(--accent, #2d6a4f); cursor: pointer; }
        #ota-aviso button:disabled { opacity: .7; cursor: progress; }
        #ota-aviso .ota-spin { display: inline-block; width: 14px; height: 14px; margin-right: 8px;
          vertical-align: -2px; border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
          border-radius: 50%; animation: otaGiro .7s linear infinite; }
        @keyframes otaGiro { to { rotate: 360deg; } }
      </style>
      <div class="ota-card">
        <h2>Hay una nueva versión</h2>
        <p id="ota-msg">Actualizá la app para seguir usándola.</p>
        <button type="button" id="ota-btn">Actualizar</button>
      </div>`;
    document.body.appendChild(modal);

    const btn = modal.querySelector("#ota-btn");
    const msg = modal.querySelector("#ota-msg");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="ota-spin"></span>Actualizando…';
      try {
        await OtaKit.update(); // descarga, activa y recarga la app
      } catch (e) {
        console.error("[ota] update:", e);
        msg.textContent = "No se pudo actualizar. Revisá tu conexión e intentá de nuevo.";
        btn.disabled = false;
        btn.textContent = "Reintentar";
      }
    });
  }

  async function verificar() {
    if (verificando || modal) return;
    verificando = true;
    try {
      const r = await OtaKit.check();
      if (r && (r.kind === "update_available" || r.kind === "already_staged")) mostrarAviso();
    } catch (e) {
      console.warn("[ota] check:", e); // sin conexión u otro error: se reintenta al reabrir
    } finally {
      verificando = false;
    }
  }

  window.addEventListener("load", () => setTimeout(verificar, 1500));
  const App = window.Capacitor.Plugins.App;
  if (App && App.addListener) {
    App.addListener("appStateChange", (s) => { if (s && s.isActive) verificar(); });
  }
})();
