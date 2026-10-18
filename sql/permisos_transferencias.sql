-- ============================================================
-- Viajes activos > tab Transferencias internas → permisos por tareas
-- Tabla migrada: transferencias_internas (+ bucket de Storage "transferencias").
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : transferencias.ver + registrar
--   worker   : transferencias.ver + registrar
--   finanzas : transferencias.ver (solo lectura)
-- Notas:
--  * Antes el SELECT lo tenía cualquier staff habilitado (viewer incluido);
--    ahora exige transferencias.ver. La tabla la leen el tab, Resumen y el
--    Dashboard (comparativo), cuyos roles (admin/worker/finanzas) coinciden.
--  * La UI no edita ni elimina transferencias: se eliminan las policies de
--    UPDATE y DELETE (antes solo admin). Si hace falta corregir una, se
--    hace desde el SQL Editor (ignora RLS).
--  * Storage: el bucket solo tenía policy de INSERT (admin/worker); pasa a
--    transferencias.registrar.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('transferencias.ver',       'transferencias', 'Ver las transferencias internas de un viaje (también alimenta Resumen y Dashboard)'),
  ('transferencias.registrar', 'transferencias', 'Registrar una transferencia interna entre cajas (incluye subir su comprobante)')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'transferencias.ver'), ('admin',  'transferencias.registrar'),
  ('worker',   'transferencias.ver'), ('worker', 'transferencias.registrar'),
  ('finanzas', 'transferencias.ver')
on conflict do nothing;

-- 3) transferencias_internas -------------------------------------------
drop policy if exists transferencias_internas_select on public.transferencias_internas;
drop policy if exists transferencias_internas_insert on public.transferencias_internas;
drop policy if exists transferencias_internas_update on public.transferencias_internas;
drop policy if exists transferencias_internas_delete on public.transferencias_internas;
drop policy if exists transferencias_leer     on public.transferencias_internas;
drop policy if exists transferencias_insertar on public.transferencias_internas;

create policy transferencias_leer on public.transferencias_internas for select to authenticated
using ((select public.has_permission('transferencias.ver')));

create policy transferencias_insertar on public.transferencias_internas for insert to authenticated
with check ((select public.has_permission('transferencias.registrar')));

-- 4) Storage: bucket "transferencias" ---------------------------------
drop policy if exists transferencias_insert_staff on storage.objects;

create policy transferencias_insert_staff on storage.objects for insert to authenticated
with check (
  bucket_id = 'transferencias'
  and (select public.has_permission('transferencias.registrar'))
);

commit;
