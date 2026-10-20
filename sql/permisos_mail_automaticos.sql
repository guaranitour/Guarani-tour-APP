-- ============================================================
-- Correos automáticos (Resend) → permiso para recibir los avisos
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   mail_automaticos.ver : admin, finanzas
-- Quienes lo tengan reciben push + bandeja cuando un correo automático
-- (recibos, BYC) rebota o es marcado como spam. La escritura la hace la
-- Edge Function resend-webhook (service role).
-- ============================================================

begin;

insert into public.permisos (codigo, modulo, descripcion) values
  ('mail_automaticos.ver', 'mail_automaticos', 'Recibir avisos de correos automáticos rebotados o marcados como spam')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',    'mail_automaticos.ver'),
  ('finanzas', 'mail_automaticos.ver')
on conflict do nothing;

commit;
