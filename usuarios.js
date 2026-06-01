async function loadUsers() {
  const list = document.getElementById("users-list");
  if (!list) return;

  list.innerHTML = "Cargando...";

  const { data, error } = await supabaseClient
    .from("staff")
    .select("id, email, role, status")
    .order("email");

  if (error) {
    console.error(error);
    list.innerHTML = "Error al cargar usuarios";
    return;
  }

  if (!data || data.length === 0) {
    list.innerHTML = "<div class='list-state'>Sin usuarios</div>";
    return;
  }

  list.innerHTML = data.map(u => `
    <div class="passenger-row" style="flex-direction:column; align-items:flex-start;">
      
      <div style="font-weight:600; margin-bottom:4px;">${u.email}</div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">

        <!-- ROL -->
        <select onchange="updateUserRole('${u.id}', this.value)" class="form-input" style="min-width:120px;">
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="worker" ${u.role === 'worker' ? 'selected' : ''}>Worker</option>
          <option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>Viewer</option>
          <option value="facturacion" ${u.role === 'facturacion' ? 'selected' : ''}>Facturación</option>
        </select>

        <!-- ESTADO -->
        <select onchange="updateUserStatus('${u.id}', this.value)" class="form-input" style="min-width:120px;">
          <option value="enabled" ${u.status === 'enabled' ? 'selected' : ''}>Activo</option>
          <option value="disabled" ${u.status === 'disabled' ? 'selected' : ''}>Inactivo</option>
        </select>

      </div>
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


// ✅ CAMBIAR ROL
async function updateUserRole(id, newRole) {
  const { error } = await supabaseClient
    .from("staff")
    .update({ role: newRole })
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Error al actualizar rol");
  }
}


// ✅ CAMBIAR ESTADO
async function updateUserStatus(id, newStatus) {
  const { error } = await supabaseClient
    .from("staff")
    .update({ status: newStatus })
    .eq("id", id);

  if (error) {
    console.error(error);
    alert("Error al actualizar estado");
  }
}
