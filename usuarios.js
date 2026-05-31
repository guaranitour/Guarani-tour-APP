async function loadUsers() {
  const list = document.getElementById("users-list");

  if (!list) return;

  list.innerHTML = "Cargando...";

  const { data, error } = await supabaseClient
    .from("staff")
    .select("email, role, status")
    .order("email");

  if (error) {
    console.error("Error Supabase:", error);
    list.innerHTML = "Error al cargar usuarios";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = '<div class="list-state">Sin usuarios</div>';
    return;
  }

  list.innerHTML = data.map(u => `
    <div class="passenger-row">
      <div class="p-name">${u.email}</div>
      <span class="p-pill">${u.role}</span>
      <span class="p-pill">${u.status}</span>
    </div>
  `).join("");
}


async function createUser() {
  const email = document.getElementById("u-email").value.trim();
  const role = document.getElementById("u-role").value;
  const status = document.getElementById("u-status").value;

  if (!email) {
    alert("Ingresá un correo");
    return;
  }

  const { error } = await supabaseClient
    .from("staff")
    .insert([{ email, role, status }]);

  if (error) {
    console.error(error);
    alert("Error al crear usuario");
    return;
  }

  document.getElementById("u-email").value = "";
  loadUsers();
  }