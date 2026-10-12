-- ============================================================
-- Permisos por tareas (esqueleto) — convive con staff.role
-- ============================================================
-- Aditivo: no modifica tablas ni policies existentes.
-- staff se identifica por email (auth.email()), igual que el resto
-- de las policies actuales. status válido = 'enabled'.
-- ============================================================

-- 1) Catálogo de tareas: 'modulo.accion' (ej: pagos.ver, recibos.anular)
create table if not exists public.permisos (
  codigo      text primary key,
  modulo      text not null,
  descripcion text
);

-- 2) Paquete de tareas por rol (rol = staff.role)
create table if not exists public.rol_permisos (
  role    text not null,
  permiso text not null references public.permisos(codigo) on delete cascade,
  primary key (role, permiso)
);

-- 3) Excepciones por usuario: concedido=true otorga, false revoca
create table if not exists public.staff_permisos (
  staff_id  uuid not null references public.staff(id) on delete cascade,
  permiso   text not null references public.permisos(codigo) on delete cascade,
  concedido boolean not null default true,
  primary key (staff_id, permiso)
);

-- 4) has_permission(): usar en policies como (select has_permission('x'))
create or replace function public.has_permission(p text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from staff s
    where s.email = auth.email()
      and s.status = 'enabled'
      and (
        -- por rol, salvo que haya una revocación individual
        (
          exists (select 1 from rol_permisos rp
                  where rp.role = s.role and rp.permiso = p)
          and not exists (select 1 from staff_permisos sp
                          where sp.staff_id = s.id and sp.permiso = p and not sp.concedido)
        )
        -- o concedido individualmente
        or exists (select 1 from staff_permisos sp
                   where sp.staff_id = s.id and sp.permiso = p and sp.concedido)
      )
  );
$$;

-- 5) mis_permisos(): lista de códigos del usuario autenticado (para el frontend)
create or replace function public.mis_permisos()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x.permiso order by x.permiso), '{}')
  from (
    select rp.permiso
    from staff s
    join rol_permisos rp on rp.role = s.role
    where s.email = auth.email() and s.status = 'enabled'
      and not exists (select 1 from staff_permisos sp
                      where sp.staff_id = s.id and sp.permiso = rp.permiso and not sp.concedido)
    union
    select sp.permiso
    from staff s
    join staff_permisos sp on sp.staff_id = s.id and sp.concedido
    where s.email = auth.email() and s.status = 'enabled'
  ) x;
$$;

-- 6) RLS de las tablas nuevas: lectura para autenticados, escritura solo admin
alter table public.permisos       enable row level security;
alter table public.rol_permisos   enable row level security;
alter table public.staff_permisos enable row level security;

do $$
declare t text;
begin
  foreach t in array array['permisos','rol_permisos','staff_permisos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format($f$create policy %I on public.%I for all to authenticated
      using (exists (select 1 from public.staff s where s.email = auth.email() and s.role = 'admin' and s.status = 'enabled'))
      with check (exists (select 1 from public.staff s where s.email = auth.email() and s.role = 'admin' and s.status = 'enabled'))$f$,
      t || '_admin_write', t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- OPCIONAL: usuarios "solo tareas" (sin rol real)
-- staff.role es NOT NULL con un check (viewer/finanzas/worker/admin).
-- Para dejar a alguien sin paquete de rol hay que permitir un valor neutro:
--
--   alter table public.staff drop constraint <nombre_del_check_de_role>;
--   alter table public.staff add constraint staff_role_check
--     check (role = any (array['viewer','finanzas','worker','admin','sin_rol']));
--
-- (obtener el nombre real con: select conname from pg_constraint
--  where conrelid = 'public.staff'::regclass and contype = 'c';)
-- Ojo: las policies viejas por rol no incluyen 'sin_rol', así que ese
-- usuario solo verá lo que ya esté migrado a has_permission().
-- ------------------------------------------------------------
