async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "https://guaranitour.github.io/Guarani-tour-APP/"
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