-- ============================================================
-- Estado ByC → permisos por tareas
-- Tabla: basesycondiciones (solo lectura desde el staff; el INSERT lo
-- hace el formulario público con rol anon y NO se toca acá).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
-- Una sola tarea: byc.ver
--   admin  : byc.ver
--   worker : byc.ver
--   finanzas / viewer : nada
--
-- Consumidores:
--   · Módulo Estado ByC (byc.js)        → RPC byc_buscar      (byc.ver)
--   · Dashboard (KPIs ByC)              → SELECT directo      (byc.ver)
--   · Recibos (autocomplete de cliente) → SELECT directo      (byc.ver)
--   · Viajes activos (marcar pendientes)→ RPC byc_cis, solo CI,
--     para todo staff habilitado (no expone nombre/email/link).
--     Cuando el módulo viajes migre, cambiar el chequeo por su tarea.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('byc.ver', 'byc', 'Ver Estado ByC: listado, KPIs del dashboard y autocomplete de clientes en recibos')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol -----------------------------------------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',  'byc.ver'),
  ('worker', 'byc.ver')
on conflict do nothing;

-- 3) basesycondiciones: SELECT por tarea (antes: cualquier staff habilitado)
--    La policy de INSERT para anon se mantiene.
drop policy if exists "Staff habilitado puede leer basesycondiciones" on public.basesycondiciones;
drop policy if exists basesycondiciones_select on public.basesycondiciones;

create policy basesycondiciones_select on public.basesycondiciones
  for select to authenticated
  using ((select public.has_permission('byc.ver')));

-- 4) byc_cis(): solo los CI (para colorear pendientes en viajes activos).
--    SECURITY DEFINER para saltear la RLS de la tabla, pero devuelve únicamente
--    la columna ci y solo a staff habilitado.
create or replace function public.byc_cis()
returns table (ci text)
language sql
stable
security definer
set search_path = public
as $$
  select b.ci
  from basesycondiciones b
  where b.ci is not null
    and exists (
      select 1 from staff s
      where s.email = auth.email() and s.status = 'enabled'
    );
$$;

revoke all on function public.byc_cis() from public, anon;
grant execute on function public.byc_cis() to authenticated;

-- 5) byc_buscar(): misma firma y resultado, ahora exige byc.ver.
--    Antes era SECURITY DEFINER sin chequeo (ejecutable por anon).
create or replace function public.byc_buscar(
  p_query  text    default ''::text,
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  id          bigint,
  nombre      text,
  ci          text,
  link        text,
  created_at  timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with total as (
    select count(*) as n
    from basesycondiciones
    where public.has_permission('byc.ver')
  ),
  base as (
    select b.id, b.nombre, b.ci, b.link, b.created_at
    from basesycondiciones b
    where public.has_permission('byc.ver')
      and (
        p_query is null
        or trim(p_query) = ''
        or b.nombre ilike '%' || trim(p_query) || '%'
        or regexp_replace(b.ci, '[.\-\s]', '', 'g') ilike
           '%' || regexp_replace(trim(p_query), '[.\-\s]', '', 'g') || '%'
      )
  )
  select base.id, base.nombre, base.ci, base.link, base.created_at, total.n as total_count
  from base, total
  order by base.created_at desc
  limit p_limit
  offset p_offset;
$$;

revoke all on function public.byc_buscar(text, integer, integer) from public, anon;
grant execute on function public.byc_buscar(text, integer, integer) to authenticated;

commit;
