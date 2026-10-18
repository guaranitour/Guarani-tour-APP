-- ============================================================
-- Viajes activos > Registro de pagos → permisos por tareas
-- Tabla migrada: pagos (+ bucket de Storage "pagos", transitorio hasta R2).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : pagos.ver + registrar + transferir + comprobante_ver
--   worker   : pagos.ver + registrar + transferir + comprobante_ver
--   viewer   : pagos.ver + registrar + comprobante_ver
--   finanzas : pagos.ver (solo lectura, sin ver comprobantes)
-- Notas:
--  * Replica el acceso previo. Las policies viejas (Read pagos,
--    select_pagos_staff, insert_pagos_staff) no exigían status = 'enabled'
--    en todos los casos; has_permission() sí.
--  * pagos.ver alimenta también Resumen, Informes, Dashboard, historial PDF
--    y los totales del tab Pasajeros: por eso incluye a viewer y finanzas.
--  * INSERT: pagos.registrar o pagos.transferir (la transferencia entre
--    pasajeros inserta dos filas). Las devoluciones automáticas al cancelar
--    un viaje también son un INSERT: quien cancela necesita pagos.registrar.
--  * UPDATE: sin policy no se podía fijar referencia_pago_id (el update
--    afectaba 0 filas sin error). Ahora se permite solo sobre la fila
--    origen de una transferencia que aún no tiene vínculo, y el trigger
--    deja modificar únicamente referencia_pago_id.
--  * DELETE: sin policy (la UI no elimina pagos; los borrados en cascada
--    de viaje/pasajero ignoran RLS).
--  * Storage: el bucket pagos solo dejaba subir a admin/worker, así que la
--    foto de un viewer se perdía en silencio. Ahora INSERT con
--    pagos.registrar y SELECT con pagos.comprobante_ver. Transitorio: los
--    comprobantes pasan a R2 en la Fase 2.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('pagos.ver',             'pagos', 'Ver los pagos de un pasajero (también alimenta Resumen, Informes, Dashboard y totales)'),
  ('pagos.registrar',       'pagos', 'Registrar un pago, devolución o transferencia (incluye subir su comprobante)'),
  ('pagos.transferir',      'pagos', 'Transferir un pago ya registrado a otro pasajero del viaje'),
  ('pagos.comprobante_ver', 'pagos', 'Ver la foto o archivo adjunto del comprobante de un pago')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'pagos.ver'), ('admin',  'pagos.registrar'), ('admin',  'pagos.transferir'), ('admin',  'pagos.comprobante_ver'),
  ('worker',   'pagos.ver'), ('worker', 'pagos.registrar'), ('worker', 'pagos.transferir'), ('worker', 'pagos.comprobante_ver'),
  ('viewer',   'pagos.ver'), ('viewer', 'pagos.registrar'), ('viewer', 'pagos.comprobante_ver'),
  ('finanzas', 'pagos.ver')
on conflict do nothing;

-- 3) pagos --------------------------------------------------------------
drop policy if exists "Read pagos"        on public.pagos;
drop policy if exists select_pagos_staff  on public.pagos;
drop policy if exists insert_pagos_staff  on public.pagos;
drop policy if exists pagos_leer          on public.pagos;
drop policy if exists pagos_insertar      on public.pagos;
drop policy if exists pagos_vincular      on public.pagos;

create policy pagos_leer on public.pagos for select to authenticated
using ((select public.has_permission('pagos.ver')));

create policy pagos_insertar on public.pagos for insert to authenticated
with check (
  (select public.has_permission('pagos.registrar'))
  or (select public.has_permission('pagos.transferir'))
);

create policy pagos_vincular on public.pagos for update to authenticated
using (
  tipo = 'Transferencia'
  and referencia_pago_id is null
  and (
    (select public.has_permission('pagos.registrar'))
    or (select public.has_permission('pagos.transferir'))
  )
)
with check (
  tipo = 'Transferencia'
  and (
    (select public.has_permission('pagos.registrar'))
    or (select public.has_permission('pagos.transferir'))
  )
);

-- 4) Trigger: al editar solo se puede fijar referencia_pago_id ---------
-- Sin JWT (SQL editor / service role) no se restringe.
create or replace function public._pagos_proteger_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.email() is null then
    return new;
  end if;

  if (to_jsonb(new) - 'referencia_pago_id') is distinct from (to_jsonb(old) - 'referencia_pago_id') then
    raise exception 'Solo se puede vincular la referencia de un pago; el resto no es modificable';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pagos_proteger_update on public.pagos;
create trigger trg_pagos_proteger_update
before update on public.pagos
for each row execute function public._pagos_proteger_update();

-- 5) Storage: bucket "pagos" (transitorio hasta R2) ---------------------
drop policy if exists pagos_storage_insert on storage.objects;
drop policy if exists pagos_storage_select on storage.objects;

create policy pagos_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'pagos'
  and (select public.has_permission('pagos.registrar'))
);

create policy pagos_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'pagos'
  and (select public.has_permission('pagos.comprobante_ver'))
);

commit;
