-- ============================================================
-- Viajes activos > tab Extra → permisos por tareas
-- Tablas migradas: servicios_extra (catálogo del viaje, tab Extra) y
-- servicio_extra_pasajeros (asignación a un pasajero, desde Pagos).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : todas
--   worker   : extras.ver + registrar + pasajero_ver/asignar/quitar
--   viewer   : extras.pasajero_ver/asignar/quitar
--   finanzas : extras.ver + extras.pasajero_ver (solo lectura)
-- Notas:
--  * editar / eliminar un servicio del catálogo quedan solo para admin.
--  * servicios_extra se lee con extras.ver o extras.pasajero_ver: quien
--    asigna extras necesita ver el catálogo para elegir.
--  * servicio_extra_pasajeros no tenía UI de edición: se elimina su
--    policy de UPDATE (para cambiar un precio se quita y se vuelve a asignar).
--  * servicio_extra_id tiene ON DELETE CASCADE: eliminar un servicio
--    asignado borra también sus asignaciones. El front avisa cuántos
--    pasajeros lo tienen y pide confirmación.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('extras.ver',              'extras', 'Ver el tab Extra y los servicios extra del viaje'),
  ('extras.registrar',        'extras', 'Crear un servicio extra en un viaje'),
  ('extras.editar',           'extras', 'Editar un servicio extra del viaje'),
  ('extras.eliminar',         'extras', 'Eliminar un servicio extra (también quita sus asignaciones a pasajeros)'),
  ('extras.pasajero_ver',     'extras', 'Ver los servicios extra asignados a un pasajero (Pagos, Resumen, PDF y totales)'),
  ('extras.pasajero_asignar', 'extras', 'Asignar un servicio extra a un pasajero'),
  ('extras.pasajero_quitar',  'extras', 'Quitar un servicio extra a un pasajero')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'extras.ver'), ('admin', 'extras.registrar'), ('admin', 'extras.editar'), ('admin', 'extras.eliminar'),
  ('admin',    'extras.pasajero_ver'), ('admin', 'extras.pasajero_asignar'), ('admin', 'extras.pasajero_quitar'),
  ('worker',   'extras.ver'), ('worker', 'extras.registrar'),
  ('worker',   'extras.pasajero_ver'), ('worker', 'extras.pasajero_asignar'), ('worker', 'extras.pasajero_quitar'),
  ('viewer',   'extras.pasajero_ver'), ('viewer', 'extras.pasajero_asignar'), ('viewer', 'extras.pasajero_quitar'),
  ('finanzas', 'extras.ver'), ('finanzas', 'extras.pasajero_ver')
on conflict do nothing;

-- 3) servicios_extra ----------------------------------------------------
drop policy if exists servicios_extra_select_staff_enabled on public.servicios_extra;
drop policy if exists servicios_extra_insert_admin_worker  on public.servicios_extra;
drop policy if exists servicios_extra_update_admin_worker  on public.servicios_extra;
drop policy if exists servicios_extra_delete_admin_worker  on public.servicios_extra;
drop policy if exists servicios_extra_leer       on public.servicios_extra;
drop policy if exists servicios_extra_insertar   on public.servicios_extra;
drop policy if exists servicios_extra_actualizar on public.servicios_extra;
drop policy if exists servicios_extra_eliminar   on public.servicios_extra;

create policy servicios_extra_leer on public.servicios_extra for select to authenticated
using (
  (select public.has_permission('extras.ver'))
  or (select public.has_permission('extras.pasajero_ver'))
);

create policy servicios_extra_insertar on public.servicios_extra for insert to authenticated
with check ((select public.has_permission('extras.registrar')));

create policy servicios_extra_actualizar on public.servicios_extra for update to authenticated
using      ((select public.has_permission('extras.editar')))
with check ((select public.has_permission('extras.editar')));

create policy servicios_extra_eliminar on public.servicios_extra for delete to authenticated
using ((select public.has_permission('extras.eliminar')));

-- 4) servicio_extra_pasajeros --------------------------------------------
drop policy if exists sep_select_staff_enabled on public.servicio_extra_pasajeros;
drop policy if exists sep_insert_admin_worker  on public.servicio_extra_pasajeros;
drop policy if exists sep_update_admin_worker  on public.servicio_extra_pasajeros;
drop policy if exists sep_delete_admin_worker  on public.servicio_extra_pasajeros;
drop policy if exists sep_leer     on public.servicio_extra_pasajeros;
drop policy if exists sep_asignar  on public.servicio_extra_pasajeros;
drop policy if exists sep_quitar   on public.servicio_extra_pasajeros;

create policy sep_leer on public.servicio_extra_pasajeros for select to authenticated
using ((select public.has_permission('extras.pasajero_ver')));

create policy sep_asignar on public.servicio_extra_pasajeros for insert to authenticated
with check ((select public.has_permission('extras.pasajero_asignar')));

create policy sep_quitar on public.servicio_extra_pasajeros for delete to authenticated
using ((select public.has_permission('extras.pasajero_quitar')));

commit;
