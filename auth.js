async function loginWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google"
  });
  if (error) {
    alert("Error al iniciar sesión");
    console.error(error);
  }
}

async function logout() {
  await supabase.auth.signOut();
  showLogin();
}