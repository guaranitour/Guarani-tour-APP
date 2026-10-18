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

-- ============================================================
-- Limpieza: pagos.viaje_id y pagos.pasajero_id eliminadas
-- Estaban en NULL en todas las filas (los pagos cuelgan de
-- viaje_pasajero_id). Sus FKs con ON DELETE CASCADE se van con ellas.
-- _pasajeros_bloquear_delete_con_historial dejó de consultar
-- pagos.pasajero_id: basta con que el cliente tenga viaje_pasajeros.
-- ============================================================

create or replace function public._pasajeros_bloquear_delete_con_historial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from viaje_pasajeros where pasajero_id = old.id) then
    raise exception 'No se puede eliminar: el cliente tiene viajes o pagos registrados'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

alter table public.pagos drop column if exists viaje_id, drop column if exists pasajero_id;

-- ============================================================
-- Fase 2: comprobantes en R2 + tarea pagos.editar
--   * pagos.foto_storage_key: llave del comprobante en R2
--     (pagos/{viajeId}/{timestamp}.{ext}). foto_comprobante (URL pública
--     de Supabase Storage) queda para los pagos anteriores a la migración.
--   * pagos.editar (solo admin por defecto): corrige datos y comprobante.
--     Reemplazar o quitar el comprobante borra el anterior en R2 (el Worker
--     exige pagos.editar para el DELETE).
--   * UPDATE: pagos.editar, o fijar el vínculo de una transferencia
--     (pagos.registrar / pagos.transferir, como antes).
--   * Trigger _pagos_proteger_update:
--       - inmutables: id, viaje_pasajero_id, creado_por, created_at, ref_origen
--       - referencia_pago_id solo se fija una vez
--       - sin pagos.editar solo se puede fijar referencia_pago_id
--       - con pagos.editar no se cambia hacia/desde Transferencia
--       - un pago ligado a una transferencia mantiene monto, tipo y método
-- ============================================================

alter table public.pagos add column if not exists foto_storage_key text;

insert into public.permisos (codigo, modulo, descripcion) values
  ('pagos.editar', 'pagos', 'Corregir un pago ya registrado (datos y comprobante; reemplazar el comprobante borra el anterior)')
on conflict (codigo) do update set descripcion = excluded.descripcion;

insert into public.rol_permisos (role, permiso) values ('admin', 'pagos.editar')
on conflict do nothing;

drop policy if exists pagos_vincular on public.pagos;
drop policy if exists pagos_actualizar on public.pagos;

create policy pagos_actualizar on public.pagos for update to authenticated
using (
  (select public.has_permission('pagos.editar'))
  or (
    tipo = 'Transferencia'
    and referencia_pago_id is null
    and (
      (select public.has_permission('pagos.registrar'))
      or (select public.has_permission('pagos.transferir'))
    )
  )
)
with check (
  (select public.has_permission('pagos.editar'))
  or (
    tipo = 'Transferencia'
    and (
      (select public.has_permission('pagos.registrar'))
      or (select public.has_permission('pagos.transferir'))
    )
  )
);

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

  if new.id                is distinct from old.id
  or new.viaje_pasajero_id is distinct from old.viaje_pasajero_id
  or new.creado_por        is distinct from old.creado_por
  or new.created_at        is distinct from old.created_at
  or new.ref_origen        is distinct from old.ref_origen
  then
    raise exception 'No se pueden modificar el pasajero, el autor ni el origen de un pago';
  end if;

  if new.referencia_pago_id is distinct from old.referencia_pago_id
     and old.referencia_pago_id is not null then
    raise exception 'El vínculo de una transferencia no se puede modificar';
  end if;

  if not public.has_permission('pagos.editar') then
    if (to_jsonb(new) - 'referencia_pago_id') is distinct from (to_jsonb(old) - 'referencia_pago_id') then
      raise exception 'Solo se puede vincular la referencia de un pago; el resto no es modificable';
    end if;
    return new;
  end if;

  if new.tipo is distinct from old.tipo
     and 'Transferencia' in (new.tipo, old.tipo) then
    raise exception 'No se puede cambiar un pago hacia o desde el tipo Transferencia';
  end if;

  if (new.monto is distinct from old.monto
      or new.tipo is distinct from old.tipo
      or new.metodo_pago_id is distinct from old.metodo_pago_id)
     and (
       old.tipo = 'Transferencia'
       or old.referencia_pago_id is not null
       or old.ref_origen is not null
       or exists (select 1 from public.pagos x
                  where x.referencia_pago_id = old.id or x.ref_origen = old.id::text)
     )
  then
    raise exception 'Este pago está ligado a una transferencia: no se pueden cambiar monto, tipo ni método';
  end if;

  return new;
end;
$$;

-- ============================================================
-- Cierre de la migración a R2
--   * Se quitan las policies del bucket "pagos" de Supabase (ya sin uso)
--     y el bucket se vacía y se borra con la API de Storage.
--   * Se elimina pagos.foto_comprobante (URL pública vieja): los 167
--     comprobantes con viaje están en R2 (foto_storage_key). Los 3 de pagos
--     sin viaje (93, 139, 140) y 4 huérfanos se respaldaron en local.
--   Ejecutar el DROP COLUMN solo después de desplegar el front sin
--   foto_comprobante (si no, el SELECT de pagos.js falla).
-- ============================================================

drop policy if exists pagos_storage_insert on storage.objects;
drop policy if exists pagos_storage_select on storage.objects;

alter table public.pagos drop column if exists foto_comprobante;
