-- ============================================================
-- categorias → permisos por tareas
-- Sucede a sql/permisos_egresos.sql y sql/permisos_presupuesto.sql.
-- La tabla la escriben solo Egresos ("+ Otro tipo…") y Presupuesto
-- ("categoría extra"), y la leen Egresos, Presupuesto, Resumen e Informes.
--   * SELECT : egresos.ver o presupuesto.ver
--   * INSERT local (scope no nulo): egresos.registrar/editar o
--     presupuesto.registrar/editar. worker ya las tiene por su rol.
--   * INSERT global (scope nulo) y UPDATE: sin policy. Ninguna pantalla
--     administra las categorías globales; se gestionan desde el SQL Editor
--     (ignora RLS). Se eliminan categorias_insert_admin/update_admin.
-- Se elimina lectura_categorias (using true), que dejaba la lectura
-- abierta a cualquier autenticado y anulaba a categorias_read.
-- ============================================================

begin;

drop policy if exists lectura_categorias       on public.categorias;
drop policy if exists categorias_read          on public.categorias;
drop policy if exists categorias_insertar_local on public.categorias;
drop policy if exists categorias_leer          on public.categorias;
drop policy if exists categorias_insert_admin  on public.categorias;
drop policy if exists categorias_update_admin  on public.categorias;

create policy categorias_leer on public.categorias for select to authenticated
using (
  (select public.has_permission('egresos.ver'))
  or (select public.has_permission('presupuesto.ver'))
);

create policy categorias_insertar_local on public.categorias for insert to authenticated
with check (
  scope is not null
  and (
    (select public.has_permission('egresos.registrar'))
    or (select public.has_permission('egresos.editar'))
    or (select public.has_permission('presupuesto.registrar'))
    or (select public.has_permission('presupuesto.editar'))
  )
);

commit;
