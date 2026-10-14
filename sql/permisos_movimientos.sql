-- ============================================================
-- Módulo Movimientos bancarios → permisos 100% por tareas
-- Tabla: movimientos_bancarios (sin UPDATE/DELETE desde el cliente)
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin / worker : movimientos.ver + movimientos.cargar
--   finanzas       : movimientos.ver (solo lectura)
-- Nota: Informes > Caja lee esta tabla; sus roles (admin/worker/finanzas)
-- coinciden con los de movimientos.ver.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('movimientos.ver',    'movimientos', 'Ver movimientos bancarios (también alimenta Informes > Caja)'),
  ('movimientos.cargar', 'movimientos', 'Registrar un movimiento bancario nuevo')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'movimientos.ver'), ('admin',  'movimientos.cargar'),
  ('worker',   'movimientos.ver'), ('worker', 'movimientos.cargar'),
  ('finanzas', 'movimientos.ver')
on conflict do nothing;

-- 3) movimientos_bancarios ---------------------------------------------
drop policy if exists "Solo admin y worker pueden leer"      on public.movimientos_bancarios;
drop policy if exists "Solo admin y worker pueden insertar"  on public.movimientos_bancarios;
drop policy if exists movimientos_select on public.movimientos_bancarios;
drop policy if exists movimientos_insert on public.movimientos_bancarios;

create policy movimientos_select on public.movimientos_bancarios for select to public
using ((select public.has_permission('movimientos.ver')));

create policy movimientos_insert on public.movimientos_bancarios for insert to public
with check ((select public.has_permission('movimientos.cargar')));

commit;
