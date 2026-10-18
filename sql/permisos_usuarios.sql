-- ============================================================
-- Módulo Usuarios (tabla staff) → permisos por tareas
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
--   usuarios.ver       admin   módulo y lista (UI; el SELECT de staff sigue abierto
--                              porque la app lee su propio perfil al arrancar)
--   usuarios.crear     admin   INSERT en staff
--   usuarios.editar    admin   UPDATE en staff (nombre, estado)
--   usuarios.eliminar  admin   DELETE en staff
--   usuarios.permisos  admin   cambiar rol + conceder/quitar tareas por usuario
--
-- Antes: INSERT/UPDATE en staff estaban atados a UN email fijo.
-- rol_permisos y permisos siguen escribibles solo por rol admin (definen
-- los paquetes; evita quedarse sin acceso por una mala edición).
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('usuarios.ver',      'usuarios', 'Ver el módulo Usuarios: lista de staff y sus tareas'),
  ('usuarios.crear',    'usuarios', 'Agregar usuarios al staff'),
  ('usuarios.editar',   'usuarios', 'Editar nombre y estado (activo/inactivo) de un usuario'),
  ('usuarios.eliminar', 'usuarios', 'Eliminar usuarios del staff'),
  ('usuarios.permisos', 'usuarios', 'Cambiar el rol de un usuario y conceder/quitar tareas individuales')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin', 'usuarios.ver'),
  ('admin', 'usuarios.crear'),
  ('admin', 'usuarios.editar'),
  ('admin', 'usuarios.eliminar'),
  ('admin', 'usuarios.permisos')
on conflict do nothing;

-- staff: INSERT / UPDATE / DELETE por tarea (SELECT no se toca) ---------------
drop policy if exists "Solo admin inserta"   on public.staff;
drop policy if exists "Solo admin actualiza" on public.staff;
drop policy if exists staff_insert on public.staff;
drop policy if exists staff_update on public.staff;
drop policy if exists staff_delete on public.staff;

create policy staff_insert on public.staff for insert to authenticated
with check ((select public.has_permission('usuarios.crear')));

create policy staff_update on public.staff for update to authenticated
using      ((select public.has_permission('usuarios.editar')))
with check ((select public.has_permission('usuarios.editar')));

create policy staff_delete on public.staff for delete to authenticated
using ((select public.has_permission('usuarios.eliminar')));

-- Protecciones (solo para sesiones de usuario; service role / SQL editor no
-- tienen auth.uid()):
--   · nadie puede eliminarse a sí mismo ni cambiar su propio rol/estado
--   · cambiar el rol de alguien, o crear un usuario con rol distinto de
--     viewer, exige usuarios.permisos (evita escalar privilegios con
--     usuarios.editar / usuarios.crear)
--   · al eliminar, se borran sus push_tokens (FK sin cascade)
create or replace function public._staff_proteger_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if auth.uid() is not null and old.email = auth.email() then
      raise exception 'No podés eliminar tu propio usuario' using errcode = '42501';
    end if;
    delete from public.push_tokens where staff_id = old.id;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null
       and new.role <> 'viewer'
       and not public.has_permission('usuarios.permisos') then
      raise exception 'Crear un usuario con un rol distinto de viewer requiere la tarea usuarios.permisos' using errcode = '42501';
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    if old.email = auth.email()
       and (new.role is distinct from old.role or new.status is distinct from old.status) then
      raise exception 'No podés cambiar tu propio rol ni tu estado' using errcode = '42501';
    end if;
    if new.role is distinct from old.role
       and not public.has_permission('usuarios.permisos') then
      raise exception 'Cambiar el rol requiere la tarea usuarios.permisos' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_proteger_cambios on public.staff;
create trigger trg_staff_proteger_cambios
  before insert or update or delete on public.staff
  for each row execute function public._staff_proteger_cambios();

-- staff_permisos: tareas por usuario. Exige usuarios.permisos y nadie puede
-- tocar las suyas (evita auto-escalada y auto-bloqueo).
drop policy if exists staff_permisos_admin_write on public.staff_permisos;
drop policy if exists staff_permisos_write       on public.staff_permisos;

create policy staff_permisos_write on public.staff_permisos for all to authenticated
using (
  (select public.has_permission('usuarios.permisos'))
  and staff_id <> (select s.id from public.staff s where s.email = auth.email())
)
with check (
  (select public.has_permission('usuarios.permisos'))
  and staff_id <> (select s.id from public.staff s where s.email = auth.email())
);

commit;

-- ============================================================
-- Lectura de public.staff: se cierra la policy abierta
-- "Permitir lectura autenticados" (auth.role() = 'authenticated') dejaba
-- leer todos los usuarios, con email y rol, a cualquier usuario logueado.
-- Ojo: las policies "fila propia" que se ven en pg_policies para 'staff'
-- son de reservas.staff (otra tabla); en public.staff esta era la única de
-- lectura, así que no se podía borrar sin reemplazarla.
--   * Cada usuario lee su propia fila (por email): alcanza para entrar a la
--     app (enterApp consulta su rol y estado) aunque no tenga usuarios.ver.
--   * usuarios.ver lee todas (módulo Usuarios); actividad.ver también, para
--     traducir ids de usuario a email en el registro de actividad.
-- ============================================================

drop policy if exists "Permitir lectura autenticados" on public.staff;
drop policy if exists staff_select on public.staff;

create policy staff_select on public.staff for select to authenticated
using (
  email = auth.email()
  or (select public.has_permission('usuarios.ver'))
  or (select public.has_permission('actividad.ver'))
);
