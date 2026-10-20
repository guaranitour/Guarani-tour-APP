-- ============================================================
-- Histórico de viajes → permisos por tareas
-- Solo controla el acceso a la vista; los datos ya los protege la RLS de
-- viajes (viajes.ver, ver sql/permisos_viajes.sql).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
-- Una sola tarea: historico.ver
--   admin / worker / finanzas : historico.ver  (mismo acceso que antes por rol)
--   viewer : nada
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('historico.ver', 'historico', 'Ver el histórico de viajes (completados y cancelados)')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',    'historico.ver'),
  ('worker',   'historico.ver'),
  ('finanzas', 'historico.ver')
on conflict do nothing;

commit;
