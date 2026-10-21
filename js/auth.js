// ── App nativa (Capacitor) ──
// Google bloquea OAuth dentro del WebView, así que en el APK el login se abre
// en el navegador del sistema (@capacitor/browser) y vuelve a la app por deep
// link. El esquema debe coincidir con el intent-filter de AndroidManifest.xml
// y estar en Supabase → Authentication → URL Configuration → Redirect URLs.
const NATIVE_REDIRECT_URL = "com.guaranitour.app://login-callback";

function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

async function loginWithGoogle() {
  const native = isNativeApp();
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      // location.origin nunca trae barra final (ej: "https://app.guaranitour.com").
      // Importante: esta URL debe coincidir EXACTO con una entrada de
      // Redirect URLs en Supabase (Authentication → URL Configuration),
      // o agregar la versión con wildcard (https://app.guaranitour.com/**)
      // para cubrir también la variante con barra — si no matchea,
      // Supabase cae en silencio a la Site URL configurada ahí.
      redirectTo: native ? NATIVE_REDIRECT_URL : window.location.origin,
      skipBrowserRedirect: native
    }
  });
  if (error) {
    showToast("Error al iniciar sesión", "error");
    console.error(error);
    return;
  }
  if (native && data && data.url) {
    await window.Capacitor.Plugins.Browser.open({ url: data.url });
  }
}

// Recibe el deep link del login (tokens en el hash o ?code=) y crea la sesión.
async function handleNativeAuthCallback(url) {
  if (!url || !url.startsWith(NATIVE_REDIRECT_URL)) return;
  try { await window.Capacitor.Plugins.Browser.close(); } catch (e) { /* ya cerrado */ }
  const parsed = new URL(url.replace("#", url.includes("?") ? "&" : "?"));
  const code = parsed.searchParams.get("code");
  const access_token = parsed.searchParams.get("access_token");
  const refresh_token = parsed.searchParams.get("refresh_token");
  let error = null;
  if (code) {
    ({ error } = await supabaseClient.auth.exchangeCodeForSession(code));
  } else if (access_token && refresh_token) {
    ({ error } = await supabaseClient.auth.setSession({ access_token, refresh_token }));
  } else {
    error = new Error(parsed.searchParams.get("error_description") || "Respuesta de login inválida");
  }
  if (error) {
    showToast("Error al iniciar sesión", "error");
    console.error(error);
  }
}

if (isNativeApp()) {
  window.Capacitor.Plugins.App.addListener("appUrlOpen", (e) => handleNativeAuthCallback(e.url));
}

async function logout() {
  await supabaseClient.auth.signOut();
  showLogin();
}