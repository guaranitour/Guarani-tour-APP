-- ============================================================
-- Módulo Clientes (tabla pasajeros) → permisos por tareas
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
--   clientes.ver               admin, worker          módulo, lista y rutas del módulo
--   clientes.crear             admin, worker          alta completa (vista "nuevo")
--   clientes.crear_rapido      admin, worker, viewer  alta rápida desde un viaje
--   clientes.editar            admin, worker          editar datos y avatar (también vincular ByC)
--   clientes.cambiar_vendedor  admin                  cambiar el vendedor de un cliente
--   clientes.eliminar          admin                  borrar clientes SIN historial
--
-- SELECT de pasajeros NO se toca: lo leen dashboard, calendario, byc,
-- viajes (joins embebidos) y el flujo de alta rápida. Cuando esos módulos
-- migren, la policy pasará a clientes.ver OR <tareas de cada módulo>.
-- ============================================================

begin;

-- 1) Catálogo --------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('clientes.ver',              'clientes', 'Ver el módulo Clientes: lista y detalle'),
  ('clientes.crear',            'clientes', 'Crear un cliente desde el módulo (alta completa)'),
  ('clientes.crear_rapido',     'clientes', 'Crear un cliente desde un viaje (nombre, sexo, vendedor)'),
  ('clientes.editar',           'clientes', 'Editar datos y avatar de un cliente'),
  ('clientes.cambiar_vendedor', 'clientes', 'Cambiar el vendedor asignado a un cliente'),
  ('clientes.eliminar',         'clientes', 'Eliminar un cliente sin viajes ni pagos')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol ------------------------------------------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',  'clientes.ver'),
  ('admin',  'clientes.crear'),
  ('admin',  'clientes.crear_rapido'),
  ('admin',  'clientes.editar'),
  ('admin',  'clientes.cambiar_vendedor'),
  ('admin',  'clientes.eliminar'),
  ('worker', 'clientes.ver'),
  ('worker', 'clientes.crear'),
  ('worker', 'clientes.crear_rapido'),
  ('worker', 'clientes.editar'),
  ('viewer', 'clientes.crear_rapido')
on conflict do nothing;

-- 3) Policies de pasajeros (SELECT queda como está) -------------------------
drop policy if exists "worker y admin pueden insertar pasajeros" on public.pasajeros;
drop policy if exists admin_worker_update_pasajeros              on public.pasajeros;
drop policy if exists pasajeros_insert                           on public.pasajeros;
drop policy if exists pasajeros_update                           on public.pasajeros;
drop policy if exists pasajeros_delete                           on public.pasajeros;

create policy pasajeros_insert on public.pasajeros for insert to authenticated
with check (
  (select public.has_permission('clientes.crear'))
  or (select public.has_permission('clientes.crear_rapido'))
);

create policy pasajeros_update on public.pasajeros for update to authenticated
using      ((select public.has_permission('clientes.editar')))
with check ((select public.has_permission('clientes.editar')));

create policy pasajeros_delete on public.pasajeros for delete to authenticated
using ((select public.has_permission('clientes.eliminar')));

-- 4) Protección del borrado ---------------------------------------------------
-- viaje_pasajeros y pagos referencian pasajeros con ON DELETE CASCADE: borrar
-- un cliente con historial borraría sus viajes y pagos. Se bloquea acá, a
-- nivel de base, sin importar por qué vía llegue el DELETE.
create or replace function public._pasajeros_bloquear_delete_con_historial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from viaje_pasajeros where pasajero_id = old.id)
     or exists (select 1 from pagos where pasajero_id = old.id) then
    raise exception 'No se puede eliminar: el cliente tiene viajes o pagos registrados'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_pasajeros_bloquear_delete on public.pasajeros;
create trigger trg_pasajeros_bloquear_delete
  before delete on public.pasajeros
  for each row execute function public._pasajeros_bloquear_delete_con_historial();

commit;
