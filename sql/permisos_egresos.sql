-- ============================================================
-- Viajes activos > tab Egresos → permisos por tareas
-- Tabla migrada: egresos (+ bucket de Storage "egresos").
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : egresos.ver + registrar + editar + eliminar
--   worker   : egresos.ver + registrar
--   finanzas : egresos.ver (solo lectura)
-- Notas:
--  * Replica el acceso previo (lectura admin/worker/finanzas, alta
--    admin/worker, edición solo admin). Antes no había DELETE.
--  * La policy de INSERT anterior no verificaba status = 'enabled'; ahora
--    has_permission() ya lo cubre.
--  * Resumen, Informes y Dashboard leen egresos: sus roles coinciden con
--    los de egresos.ver.
--  * Storage: el bucket no tenía policy de DELETE/UPDATE. Editar un egreso
--    reemplaza el comprobante y borra el anterior, y eliminar un egreso
--    borra el suyo: DELETE con egresos.editar o egresos.eliminar, y se
--    amplía el INSERT a editar.
--  * categorias (categoría local creada desde Egresos) no se migra aquí.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('egresos.ver',       'egresos', 'Ver los egresos de un viaje (también alimenta Resumen, Informes y Dashboard)'),
  ('egresos.registrar', 'egresos', 'Registrar un egreso nuevo en un viaje'),
  ('egresos.editar',    'egresos', 'Modificar un egreso ya registrado (incluye reemplazar su comprobante)'),
  ('egresos.eliminar',  'egresos', 'Eliminar un egreso')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'egresos.ver'), ('admin',  'egresos.registrar'), ('admin', 'egresos.editar'), ('admin', 'egresos.eliminar'),
  ('worker',   'egresos.ver'), ('worker', 'egresos.registrar'),
  ('finanzas', 'egresos.ver')
on conflict do nothing;

-- 3) egresos ----------------------------------------------------------------
drop policy if exists lectura_egresos    on public.egresos;
drop policy if exists insert_egresos     on public.egresos;
drop policy if exists update_egresos     on public.egresos;
drop policy if exists egresos_leer       on public.egresos;
drop policy if exists egresos_insertar   on public.egresos;
drop policy if exists egresos_actualizar on public.egresos;
drop policy if exists egresos_eliminar   on public.egresos;

create policy egresos_leer on public.egresos for select to authenticated
using ((select public.has_permission('egresos.ver')));

create policy egresos_insertar on public.egresos for insert to authenticated
with check ((select public.has_permission('egresos.registrar')));

create policy egresos_actualizar on public.egresos for update to authenticated
using      ((select public.has_permission('egresos.editar')))
with check ((select public.has_permission('egresos.editar')));

create policy egresos_eliminar on public.egresos for delete to authenticated
using ((select public.has_permission('egresos.eliminar')));

-- 4) Trigger: columnas que no se pueden tocar al editar ------------------
--   id, viaje_id, creado_por y created_at quedan inmutables.
-- Sin JWT (SQL editor / service role) no se restringe.
create or replace function public._egresos_proteger_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.email() is null then
    return new;
  end if;

  if new.id         is distinct from old.id
  or new.viaje_id   is distinct from old.viaje_id
  or new.creado_por is distinct from old.creado_por
  or new.created_at is distinct from old.created_at
  then
    raise exception 'No se pueden modificar id, viaje, autor ni fecha de registro de un egreso';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_egresos_proteger_update on public.egresos;
create trigger trg_egresos_proteger_update
before update on public.egresos
for each row execute function public._egresos_proteger_update();

-- 5) Storage: bucket "egresos" ---------------------------------------------
drop policy if exists egresos_insert_staff  on storage.objects;
drop policy if exists egresos_delete_tareas on storage.objects;

create policy egresos_insert_staff on storage.objects for insert to authenticated
with check (
  bucket_id = 'egresos'
  and (
    (select public.has_permission('egresos.registrar'))
    or (select public.has_permission('egresos.editar'))
  )
);

create policy egresos_delete_tareas on storage.objects for delete to authenticated
using (
  bucket_id = 'egresos'
  and (
    (select public.has_permission('egresos.editar'))
    or (select public.has_permission('egresos.eliminar'))
  )
);

commit;
