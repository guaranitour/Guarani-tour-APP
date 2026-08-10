async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Antes apuntaba fijo al dominio viejo de GitHub Pages, así que
      // Google siempre devolvía ahí sin importar desde dónde se inició
      // el login. Con location.origin vuelve al dominio real actual
      // (app.guaranitour.com u otro, si vuelve a cambiar).
      redirectTo: window.location.origin + "/"
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