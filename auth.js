async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      // location.origin nunca trae barra final (ej: "https://app.guaranitour.com").
      // Importante: esta URL debe coincidir EXACTO con una entrada de
      // Redirect URLs en Supabase (Authentication → URL Configuration),
      // o agregar la versión con wildcard (https://app.guaranitour.com/**)
      // para cubrir también la variante con barra — si no matchea,
      // Supabase cae en silencio a la Site URL configurada ahí.
      redirectTo: window.location.origin
    }
  });
  if (error) {
    alert("Error al iniciar sesión");
    console.error(error);
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  showLogin();
}