-- ============================================================
-- Facturas: se quita la condición vieja por rol (solo tareas)
-- Sucede a sql/permisos_facturas.sql (modo híbrido).
-- ============================================================

-- facturas_tickets ---------------------------------------------------
drop policy if exists facturas_tickets_select on public.facturas_tickets;
create policy facturas_tickets_select on public.facturas_tickets for select to public
using ((select public.has_permission('facturas.ver')));

drop policy if exists facturas_tickets_insert on public.facturas_tickets;
create policy facturas_tickets_insert on public.facturas_tickets for insert to public
with check ((select public.has_permission('facturas.cargar')));

drop policy if exists facturas_tickets_update on public.facturas_tickets;
create policy facturas_tickets_update on public.facturas_tickets for update to public
using (
  (select public.has_permission('facturas.verificar'))
  or (select public.has_permission('facturas.editar'))
);

drop policy if exists facturas_tickets_delete on public.facturas_tickets;
create policy facturas_tickets_delete on public.facturas_tickets for delete to public
using ((select public.has_permission('facturas.eliminar')));

-- Trigger: qué columnas puede tocar cada tarea.
--   facturas.editar    → datos (archivo, fecha, monto, tipo)
--   facturas.verificar → estado, verificado_por, verificado_en
-- Sin JWT (SQL editor / service role) no se restringe, como antes.
create or replace function public._facturas_tickets_restringir_update_finanzas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.email() is null then
    return new;
  end if;

  if not public.has_permission('facturas.editar') then
    if new.storage_key    is distinct from old.storage_key
    or new.nombre_archivo is distinct from old.nombre_archivo
    or new.content_type   is distinct from old.content_type
    or new.tamano_bytes   is distinct from old.tamano_bytes
    or new.fecha_emision  is distinct from old.fecha_emision
    or new.monto          is distinct from old.monto
    or new.es_factura     is distinct from old.es_factura
    then
      raise exception 'Sin permiso para modificar los datos del comprobante';
    end if;
  end if;

  if not public.has_permission('facturas.verificar') then
    if new.estado         is distinct from old.estado
    or new.verificado_por is distinct from old.verificado_por
    or new.verificado_en  is distinct from old.verificado_en
    then
      raise exception 'Sin permiso para verificar comprobantes';
    end if;
  end if;

  return new;
end;
$$;

-- facturas_marangatu -------------------------------------------------
drop policy if exists facturas_marangatu_select on public.facturas_marangatu;
create policy facturas_marangatu_select on public.facturas_marangatu for select to authenticated
using ((select public.has_permission('marangatu.ver')));

drop policy if exists facturas_marangatu_insert on public.facturas_marangatu;
create policy facturas_marangatu_insert on public.facturas_marangatu for insert to authenticated
with check ((select public.has_permission('marangatu.cargar')));
