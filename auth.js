async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: "app.guaranitour.com"
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
