-- ============================================================
-- Registro de actividad (activity_log) → permisos por tareas
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   actividad.ver : admin
-- Los triggers fn_activity_log (SECURITY DEFINER) siguen escribiendo
-- igual: solo cambia quién puede LEER el log.
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('actividad.ver', 'actividad', 'Ver el registro de actividad (activity_log)')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin', 'actividad.ver')
on conflict do nothing;

drop policy if exists activity_log_select_admin on public.activity_log;
drop policy if exists activity_log_select on public.activity_log;

create policy activity_log_select on public.activity_log
  for select to authenticated
  using ((select public.has_permission('actividad.ver')));

commit;
