-- ============================================================
-- Módulo Recibos → permisos 100% por tareas (sin modo híbrido)
-- Tablas: recibos, tipo_recibos, recibo_speeches
-- RPCs recibos_* (SECURITY INVOKER): heredan la RLS de `recibos`.
-- Edge Function `recibos`: valida las mismas tareas (ver supabase/functions/recibos).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : ver + crear + speeches + tipos
--   worker   : ver + crear
--   finanzas : ver
--   viewer   : nada (la UI ya mostraba "en construcción")
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('recibos.ver',      'recibos', 'Ver recibos, buscarlos y descargar/compartir el PDF'),
  ('recibos.crear',    'recibos', 'Generar un recibo nuevo (PDF + email)'),
  ('recibos.speeches', 'recibos', 'Gestionar frases rápidas (speeches) por viaje'),
  ('recibos.tipos',    'recibos', 'Gestionar tipos de recibo')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol -----------------------------------------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'recibos.ver'), ('admin', 'recibos.crear'),
  ('admin',    'recibos.speeches'), ('admin', 'recibos.tipos'),
  ('worker',   'recibos.ver'), ('worker', 'recibos.crear'),
  ('finanzas', 'recibos.ver')
on conflict do nothing;

-- 3) recibos ---------------------------------------------------------------
drop policy if exists recibos_select on public.recibos;
drop policy if exists recibos_insert on public.recibos;

create policy recibos_select on public.recibos for select to public
using ((select public.has_permission('recibos.ver')));

create policy recibos_insert on public.recibos for insert to public
with check ((select public.has_permission('recibos.crear')));

-- 4) tipo_recibos (antes: ALL para viewer/worker/admin) -----------------------
drop policy if exists tipo_recibos_select on public.tipo_recibos;
drop policy if exists tipo_recibos_write  on public.tipo_recibos;

create policy tipo_recibos_select on public.tipo_recibos for select to public
using ((select public.has_permission('recibos.ver')) or (select public.has_permission('recibos.crear')));

create policy tipo_recibos_write on public.tipo_recibos for all to public
using ((select public.has_permission('recibos.tipos')))
with check ((select public.has_permission('recibos.tipos')));

-- 5) recibo_speeches (antes: select a cualquier authenticated, write solo admin) --
drop policy if exists recibo_speeches_select_authenticated on public.recibo_speeches;
drop policy if exists recibo_speeches_write_admin          on public.recibo_speeches;
drop policy if exists recibo_speeches_select               on public.recibo_speeches;
drop policy if exists recibo_speeches_write                on public.recibo_speeches;

create policy recibo_speeches_select on public.recibo_speeches for select to authenticated
using ((select public.has_permission('recibos.ver')) or (select public.has_permission('recibos.crear')));

create policy recibo_speeches_write on public.recibo_speeches for all to authenticated
using ((select public.has_permission('recibos.speeches')))
with check ((select public.has_permission('recibos.speeches')));

commit;
