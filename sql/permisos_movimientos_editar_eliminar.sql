-- ============================================================
-- Movimientos bancarios: tareas de editar y eliminar
-- Sucede a sql/permisos_movimientos.sql.
-- IMPORTANTE: NO se asocian a ningún rol (sin filas en rol_permisos).
-- Se conceden por usuario desde staff_permisos (módulo Usuarios).
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('movimientos.editar',   'movimientos', 'Modificar un movimiento bancario existente'),
  ('movimientos.eliminar', 'movimientos', 'Eliminar un movimiento bancario')
on conflict (codigo) do nothing;

-- 2) Políticas -----------------------------------------------------------
drop policy if exists movimientos_update on public.movimientos_bancarios;
create policy movimientos_update on public.movimientos_bancarios for update to public
using ((select public.has_permission('movimientos.editar')))
with check ((select public.has_permission('movimientos.editar')));

drop policy if exists movimientos_delete on public.movimientos_bancarios;
create policy movimientos_delete on public.movimientos_bancarios for delete to public
using ((select public.has_permission('movimientos.eliminar')));

-- 3) Trigger: columnas que no se pueden tocar al editar ------------------
--   id, created_at y usuario (quién lo registró) quedan inmutables.
-- Sin JWT (SQL editor / service role) no se restringe.
create or replace function public._movimientos_bancarios_proteger_update()
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
  or new.created_at is distinct from old.created_at
  or new.usuario    is distinct from old.usuario
  then
    raise exception 'No se pueden modificar id, fecha de registro ni usuario de un movimiento';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_movimientos_bancarios_proteger_update on public.movimientos_bancarios;
create trigger trg_movimientos_bancarios_proteger_update
before update on public.movimientos_bancarios
for each row execute function public._movimientos_bancarios_proteger_update();

commit;
