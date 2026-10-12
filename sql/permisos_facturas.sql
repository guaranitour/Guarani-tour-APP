-- ============================================================
-- Módulo Facturas → permisos por tareas (híbrido)
-- Tablas: facturas_tickets, facturas_marangatu
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
-- Modo híbrido: cada policy = has_permission(...) OR condición vieja
-- por rol. Cuando se valide, se quita la parte "OR ..." (ver al final).
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('facturas.ver',        'facturas',  'Ver facturas y tickets internos (y abrir/descargar el archivo)'),
  ('facturas.cargar',     'facturas',  'Subir un comprobante nuevo'),
  ('facturas.verificar',  'facturas',  'Marcar un comprobante como verificado'),
  ('facturas.editar',     'facturas',  'Modificar los datos de un comprobante (fecha, monto, archivo, tipo)'),
  ('facturas.eliminar',   'facturas',  'Eliminar un comprobante'),
  ('marangatu.ver',       'marangatu', 'Ver facturas electrónicas Marangatu (y abrir/descargar)'),
  ('marangatu.cargar',    'marangatu', 'Subir una factura Marangatu')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
--   admin    : todo menos facturas.verificar (se concede por usuario en
--              staff_permisos, p.ej. jcpalacios9830@gmail.com)
--   worker   : facturas ver/cargar/editar/eliminar + marangatu ver
--   finanzas : facturas ver/verificar + marangatu ver/cargar
--   viewer   : nada
insert into public.rol_permisos (role, permiso) values
  ('admin','facturas.ver'), ('admin','facturas.cargar'),
  ('admin','facturas.editar'), ('admin','facturas.eliminar'),
  ('admin','marangatu.ver'), ('admin','marangatu.cargar'),

  ('worker','facturas.ver'), ('worker','facturas.cargar'),
  ('worker','facturas.editar'), ('worker','facturas.eliminar'),
  ('worker','marangatu.ver'),

  ('finanzas','facturas.ver'), ('finanzas','facturas.verificar'),
  ('finanzas','marangatu.ver'), ('finanzas','marangatu.cargar')
on conflict do nothing;

-- 3) Policies híbridas: facturas_tickets ------------------------------
drop policy if exists facturas_tickets_select on public.facturas_tickets;
create policy facturas_tickets_select on public.facturas_tickets for select to public
using (
  (select public.has_permission('facturas.ver'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','worker','finanzas']))
);

drop policy if exists facturas_tickets_insert on public.facturas_tickets;
create policy facturas_tickets_insert on public.facturas_tickets for insert to public
with check (
  (select public.has_permission('facturas.cargar'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','worker']))
);

-- UPDATE lo usa tanto "verificar" como "editar"; el trigger (abajo)
-- decide qué columnas puede tocar cada uno.
drop policy if exists facturas_tickets_update on public.facturas_tickets;
create policy facturas_tickets_update on public.facturas_tickets for update to public
using (
  (select public.has_permission('facturas.verificar'))
  or (select public.has_permission('facturas.editar'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','worker','finanzas']))
);

drop policy if exists facturas_tickets_delete on public.facturas_tickets;
create policy facturas_tickets_delete on public.facturas_tickets for delete to public
using (
  (select public.has_permission('facturas.eliminar'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','worker']))
);

-- 4) Trigger: antes "si es finanzas, solo puede cambiar el estado".
--    Ahora: solo puede cambiar datos quien tiene facturas.editar
--    (o es admin/worker por la vía vieja).
create or replace function public._facturas_tickets_restringir_update_finanzas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.staff where email = auth.jwt()->>'email';

  if not (public.has_permission('facturas.editar') or v_role in ('admin','worker')) then
    if new.storage_key    is distinct from old.storage_key
    or new.nombre_archivo is distinct from old.nombre_archivo
    or new.content_type   is distinct from old.content_type
    or new.tamano_bytes   is distinct from old.tamano_bytes
    or new.fecha_emision  is distinct from old.fecha_emision
    or new.monto          is distinct from old.monto
    or new.es_factura     is distinct from old.es_factura
    then
      raise exception 'Sin permiso para modificar los datos del comprobante (solo verificación)';
    end if;
  end if;

  return new;
end;
$$;

-- 5) Policies híbridas: facturas_marangatu ----------------------------
drop policy if exists facturas_marangatu_select on public.facturas_marangatu;
create policy facturas_marangatu_select on public.facturas_marangatu for select to authenticated
using (
  (select public.has_permission('marangatu.ver'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','worker','finanzas']))
);

drop policy if exists facturas_marangatu_insert on public.facturas_marangatu;
create policy facturas_marangatu_insert on public.facturas_marangatu for insert to authenticated
with check (
  (select public.has_permission('marangatu.cargar'))
  or exists (select 1 from staff s
             where s.email = (auth.jwt() ->> 'email') and s.status = 'enabled'
               and s.role = any (array['admin','finanzas']))
);

commit;

-- ------------------------------------------------------------
-- DESPUÉS DE VALIDAR: quitar la condición vieja. Es dejar cada policy
-- solo con has_permission(...) y, en el trigger, quitar "or v_role in
-- ('admin','worker')". Se hace en una migración aparte.
-- ------------------------------------------------------------
