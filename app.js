document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    showApp(session.user);
  } else {
    showLogin();
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) {
      showApp(session.user);
    } else {
      showLogin();
    }
  });
});

function showLogin() {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("app-view").classList.add("hidden");
}

function showApp(user) {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("app-view").classList.remove("hidden");
  document.getElementById("user-email").textContent = user.email;
}
