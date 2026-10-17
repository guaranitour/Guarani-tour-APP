-- ============================================================
-- Viajes activos > tab Presupuesto → permisos por tareas
-- Tabla migrada: presupuesto_viaje (solo la escribe este tab).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : presupuesto.ver + registrar + editar
--   worker   : presupuesto.ver + registrar
--   finanzas : presupuesto.ver (solo lectura)
-- Notas:
--  * Egresos, Resumen e Informes leen presupuesto_viaje; sus roles
--    (admin/worker/finanzas) coinciden con los de presupuesto.ver.
--  * presupuesto_viaje no tenía policy de DELETE: el borrado de categorías
--    vaciadas en modo edición no surtía efecto. Ahora lo cubre .editar.
--  * categorias NO se migra aquí: también la escribe Egresos (categoría
--    local) y la leen Resumen/Informes. Se migra junto con Egresos. Solo se
--    corrige status 'active' → 'enabled' (ningún staff tiene 'active', así
--    que esas policies nunca se cumplían).
--  * viajes (pasajeros_estimados / precio_estimado_pasajero) no se toca.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('presupuesto.ver',       'presupuesto', 'Ver el presupuesto del viaje (también alimenta Egresos, Resumen e Informes)'),
  ('presupuesto.registrar', 'presupuesto', 'Registrar el presupuesto de un viaje (y crear categorías extra)'),
  ('presupuesto.editar',    'presupuesto', 'Editar o borrar montos de un presupuesto ya registrado')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'presupuesto.ver'), ('admin',  'presupuesto.registrar'), ('admin', 'presupuesto.editar'),
  ('worker',   'presupuesto.ver'), ('worker', 'presupuesto.registrar'),
  ('finanzas', 'presupuesto.ver')
on conflict do nothing;

-- 3) presupuesto_viaje --------------------------------------------------
drop policy if exists presupuesto_leer       on public.presupuesto_viaje;
drop policy if exists presupuesto_insertar   on public.presupuesto_viaje;
drop policy if exists presupuesto_actualizar on public.presupuesto_viaje;
drop policy if exists presupuesto_eliminar   on public.presupuesto_viaje;

create policy presupuesto_leer on public.presupuesto_viaje for select to public
using ((select public.has_permission('presupuesto.ver')));

create policy presupuesto_insertar on public.presupuesto_viaje for insert to public
with check (
  (select public.has_permission('presupuesto.registrar'))
  or (select public.has_permission('presupuesto.editar'))
);

create policy presupuesto_actualizar on public.presupuesto_viaje for update to public
using      ((select public.has_permission('presupuesto.editar')))
with check ((select public.has_permission('presupuesto.editar')));

create policy presupuesto_eliminar on public.presupuesto_viaje for delete to public
using ((select public.has_permission('presupuesto.editar')));

-- 4) categorias: solo corrige status 'active' → 'enabled' ---------------
alter policy categorias_insert_admin on public.categorias
with check (exists (
  select 1 from staff
  where staff.email = auth.email() and staff.status = 'enabled' and staff.role = 'admin'
));

alter policy categorias_update_admin on public.categorias
using (exists (
  select 1 from staff
  where staff.email = auth.email() and staff.status = 'enabled' and staff.role = 'admin'
))
with check (exists (
  select 1 from staff
  where staff.email = auth.email() and staff.status = 'enabled' and staff.role = 'admin'
));

alter policy categorias_read on public.categorias
using (exists (
  select 1 from staff
  where staff.email = auth.email() and staff.status = 'enabled'
    and staff.role = any (array['admin','worker','viewer'])
));

commit;
