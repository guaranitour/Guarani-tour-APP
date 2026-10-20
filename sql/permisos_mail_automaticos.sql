-- ============================================================
-- Correos automáticos (Resend) → permiso para recibir los avisos
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   notificaciones.mails_automaticos : admin, finanzas
-- Vive en el módulo "notificaciones". Quienes lo tengan reciben push +
-- bandeja cuando un correo automático (recibos, BYC) rebota o es marcado
-- como spam. La escritura la hace la Edge Function resend-webhook
-- (service role).
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('notificaciones.mails_automaticos', 'notificaciones', 'Recibir avisos de correos automáticos (recibos, BYC) rebotados o marcados como spam')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',    'notificaciones.mails_automaticos'),
  ('finanzas', 'notificaciones.mails_automaticos')
on conflict do nothing;

commit;
