-- ============================================================
-- Notificaciones (recordatorios / consejos) → tablas + permisos por tareas
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
-- Tablas
--   notificaciones          : definición (qué, a quién, cuándo / cada cuánto)
--   notificaciones_bandeja  : una fila por destinatario cada vez que se envía
--                             (bandeja con leído / no leído). Solo la inserta
--                             la edge function send-notifications.
--
-- Tareas
--   notificaciones.ver       : ver la propia bandeja        (todos los roles)
--   notificaciones.crear     : crear notificaciones         (admin)
--   notificaciones.editar    : editar / pausar              (admin)
--   notificaciones.eliminar  : eliminar                     (admin)
--
-- Envío: la edge function send-notifications procesa las notificaciones
-- activas con proxima_ejecucion <= now(). La invoca pg_cron cada 5 minutos
-- y el cliente al crear una notificación "inmediata".
-- ============================================================

begin;

-- 1) Tablas ---------------------------------------------------------------
create table if not exists public.notificaciones (
  id                uuid primary key default gen_random_uuid(),
  tipo              text not null default 'recordatorio'
                      check (tipo in ('recordatorio', 'consejo')),
  titulo            text not null check (char_length(titulo) between 1 and 80),
  mensaje           text not null check (char_length(mensaje) between 1 and 400),
  destino           text not null default 'todos'
                      check (destino in ('todos', 'roles', 'usuarios')),
  roles             text[] not null default '{}',
  staff_ids         uuid[] not null default '{}',
  frecuencia        text not null default 'unica'
                      check (frecuencia in ('unica', 'diaria', 'semanal', 'mensual')),
  proxima_ejecucion timestamptz,
  termina_en        timestamptz,
  activa            boolean not null default true,
  ultimo_envio      timestamptz,
  creada_por        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists notificaciones_pendientes_idx
  on public.notificaciones (proxima_ejecucion) where activa;

create table if not exists public.notificaciones_bandeja (
  id              uuid primary key default gen_random_uuid(),
  notificacion_id uuid references public.notificaciones(id) on delete set null,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  tipo            text not null,
  titulo          text not null,
  mensaje         text not null,
  created_at      timestamptz not null default now(),
  leida_at        timestamptz
);

create index if not exists notificaciones_bandeja_staff_idx
  on public.notificaciones_bandeja (staff_id, created_at desc);

-- 2) Catálogo de tareas y paquetes por rol ---------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('notificaciones.ver',      'notificaciones', 'Ver la propia bandeja de notificaciones'),
  ('notificaciones.crear',    'notificaciones', 'Crear recordatorios y consejos para el staff'),
  ('notificaciones.editar',   'notificaciones', 'Editar, pausar o reactivar notificaciones'),
  ('notificaciones.eliminar', 'notificaciones', 'Eliminar notificaciones')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',    'notificaciones.ver'), ('admin',    'notificaciones.crear'),
  ('admin',    'notificaciones.editar'), ('admin', 'notificaciones.eliminar'),
  ('worker',   'notificaciones.ver'),
  ('finanzas', 'notificaciones.ver'),
  ('viewer',   'notificaciones.ver')
on conflict do nothing;

-- 3) RLS ---------------------------------------------------------------------
alter table public.notificaciones         enable row level security;
alter table public.notificaciones_bandeja enable row level security;

-- Definiciones: solo quien administra
drop policy if exists notificaciones_select on public.notificaciones;
create policy notificaciones_select on public.notificaciones
  for select to authenticated
  using (
    (select public.has_permission('notificaciones.crear'))
    or (select public.has_permission('notificaciones.editar'))
    or (select public.has_permission('notificaciones.eliminar'))
  );

drop policy if exists notificaciones_insert on public.notificaciones;
create policy notificaciones_insert on public.notificaciones
  for insert to authenticated
  with check ((select public.has_permission('notificaciones.crear')));

drop policy if exists notificaciones_update on public.notificaciones;
create policy notificaciones_update on public.notificaciones
  for update to authenticated
  using      ((select public.has_permission('notificaciones.editar')))
  with check ((select public.has_permission('notificaciones.editar')));

drop policy if exists notificaciones_delete on public.notificaciones;
create policy notificaciones_delete on public.notificaciones
  for delete to authenticated
  using ((select public.has_permission('notificaciones.eliminar')));

-- Bandeja: cada persona ve y marca como leídas solo las suyas
drop policy if exists bandeja_select on public.notificaciones_bandeja;
create policy bandeja_select on public.notificaciones_bandeja
  for select to authenticated
  using (
    (select public.has_permission('notificaciones.ver'))
    and staff_id in (select s.id from public.staff s
                     where s.email = auth.email() and s.status = 'enabled')
  );

drop policy if exists bandeja_update on public.notificaciones_bandeja;
create policy bandeja_update on public.notificaciones_bandeja
  for update to authenticated
  using (staff_id in (select s.id from public.staff s
                      where s.email = auth.email() and s.status = 'enabled'))
  with check (staff_id in (select s.id from public.staff s
                           where s.email = auth.email() and s.status = 'enabled'));

-- Solo se puede cambiar leida_at desde el cliente
revoke update on public.notificaciones_bandeja from authenticated, anon;
grant  update (leida_at) on public.notificaciones_bandeja to authenticated;

revoke all on public.notificaciones         from anon;
revoke all on public.notificaciones_bandeja from anon;

commit;

-- 4) Cron (correr una vez, aparte) -----------------------------------------
-- Reemplazar <SERVICE_ROLE_KEY> por la clave service_role del proyecto:
--
-- select cron.schedule(
--   'send-notifications-every-5-min', '*/5 * * * *',
--   $$ select net.http_post(
--        url := 'https://pmxwpmxiemhbeliywhpj.supabase.co/functions/v1/send-notifications',
--        headers := jsonb_build_object(
--          'Content-Type', 'application/json',
--          'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
--        body := '{}'::jsonb) $$
-- );
