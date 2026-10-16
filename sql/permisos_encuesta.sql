-- ============================================================
-- Encuesta (encuesta_respuestas) → permisos por tareas
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   encuesta.ver : admin, finanzas  (el acceso real que daba la RLS)
-- Nota: el front mostraba el menú también a worker, pero la RLS ya le
-- devolvía 0 filas. Para dárselo: insert into rol_permisos ('worker','encuesta.ver').
-- La escritura la hace la Edge Function tally-webhook (service role).
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('encuesta.ver', 'encuesta', 'Ver las respuestas de la encuesta y sus estadísticas')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',    'encuesta.ver'),
  ('finanzas', 'encuesta.ver')
on conflict do nothing;

drop policy if exists encuesta_respuestas_select on public.encuesta_respuestas;

create policy encuesta_respuestas_select on public.encuesta_respuestas
  for select to authenticated
  using ((select public.has_permission('encuesta.ver')));

commit;
