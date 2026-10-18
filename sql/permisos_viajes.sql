-- ============================================================
-- Viajes activos > viajes y viaje_pasajeros → permisos por tareas
-- Tablas migradas: viajes, viaje_pasajeros (+ bucket "viajes" y las
-- funciones reemplazar_pasajero y cancelar_viaje).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin    : todas
--   worker   : viajes.ver + viaje_pasajeros.ver/listado/agregar/reemplazar + resumen.ver
--   viewer   : viajes.ver + viaje_pasajeros.ver/listado/agregar/reemplazar
--   finanzas : viajes.ver + viaje_pasajeros.ver + resumen.ver
-- Notas:
--  * viajes_select era "using (true)": lo leía cualquier usuario autenticado
--    (p. ej. un cliente logueado en la app de asientos). Ahora exige
--    viajes.ver, y se revoca todo acceso de anon a ambas tablas.
--  * viaje_pasajeros.ver alimenta Resumen, Dashboard, Informes, clientes,
--    recibos y presupuesto; por eso incluye a los cuatro roles. El tab
--    Pasajeros se controla aparte (viaje_pasajeros.listado, finanzas no).
--  * Sin policy de DELETE en ninguna de las dos tablas: la UI no borra
--    viajes ni pasajeros del viaje y un DELETE arrastra en cascada egresos,
--    presupuesto, extras y transferencias. Se hace desde el SQL Editor.
--  * Cancelar un viaje pasa a ser atómico: cancelar_viaje(p_viaje_id)
--    (antes eran 3 llamadas sueltas del navegador). Un trigger impide
--    poner estado = 'cancelado' por UPDATE directo.
--  * reemplazar_pasajero era SECURITY DEFINER, ejecutable por anon y sin
--    ningún chequeo: cualquiera con la anon key podía reemplazar pasajeros
--    y mover señas. Ahora exige viaje_pasajeros.reemplazar + agregar, no es
--    ejecutable por anon y el autor sale del JWT (p_creado_por se ignora).
--  * El bucket "viajes" tenía INSERT/UPDATE/DELETE para el rol public
--    (cualquiera podía subir, pisar o borrar imágenes). Ahora INSERT con
--    viajes.crear/editar, UPDATE y DELETE con viajes.editar.
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('viajes.ver',                  'viajes',          'Ver los viajes (lista, detalle, calendario, dashboard e informes)'),
  ('viajes.crear',                'viajes',          'Crear un viaje nuevo (incluye subir su imagen)'),
  ('viajes.editar',               'viajes',          'Editar los datos, el estado y la imagen de un viaje'),
  ('viajes.cancelar',             'viajes',          'Cancelar un viaje (marca a todos como No asiste y registra las devoluciones)'),
  ('viaje_pasajeros.ver',         'viaje_pasajeros', 'Leer los pasajeros de los viajes (alimenta Resumen, Dashboard, Informes y clientes)'),
  ('viaje_pasajeros.listado',     'viaje_pasajeros', 'Ver el tab Pasajeros de un viaje'),
  ('viaje_pasajeros.agregar',     'viaje_pasajeros', 'Agregar un pasajero a un viaje'),
  ('viaje_pasajeros.editar',      'viaje_pasajeros', 'Editar total a pagar, asistencia y puntos de un pasajero del viaje'),
  ('viaje_pasajeros.reemplazar',  'viaje_pasajeros', 'Reemplazar un pasajero del viaje por otro (con opción de transferir la seña)'),
  ('resumen.ver',                 'resumen',         'Ver el tab Resumen financiero de un viaje')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',    'viajes.ver'), ('admin', 'viajes.crear'), ('admin', 'viajes.editar'), ('admin', 'viajes.cancelar'),
  ('admin',    'viaje_pasajeros.ver'), ('admin', 'viaje_pasajeros.listado'), ('admin', 'viaje_pasajeros.agregar'),
  ('admin',    'viaje_pasajeros.editar'), ('admin', 'viaje_pasajeros.reemplazar'), ('admin', 'resumen.ver'),
  ('worker',   'viajes.ver'), ('worker', 'viaje_pasajeros.ver'), ('worker', 'viaje_pasajeros.listado'),
  ('worker',   'viaje_pasajeros.agregar'), ('worker', 'viaje_pasajeros.reemplazar'), ('worker', 'resumen.ver'),
  ('viewer',   'viajes.ver'), ('viewer', 'viaje_pasajeros.ver'), ('viewer', 'viaje_pasajeros.listado'),
  ('viewer',   'viaje_pasajeros.agregar'), ('viewer', 'viaje_pasajeros.reemplazar'),
  ('finanzas', 'viajes.ver'), ('finanzas', 'viaje_pasajeros.ver'), ('finanzas', 'resumen.ver')
on conflict do nothing;

-- 3) viajes ---------------------------------------------------------------
revoke all on public.viajes, public.viaje_pasajeros from anon;

drop policy if exists viajes_select on public.viajes;
drop policy if exists viajes_insert on public.viajes;
drop policy if exists viajes_update on public.viajes;
drop policy if exists viajes_delete on public.viajes;
drop policy if exists viajes_leer       on public.viajes;
drop policy if exists viajes_insertar   on public.viajes;
drop policy if exists viajes_actualizar on public.viajes;

create policy viajes_leer on public.viajes for select to authenticated
using ((select public.has_permission('viajes.ver')));

create policy viajes_insertar on public.viajes for insert to authenticated
with check ((select public.has_permission('viajes.crear')));

create policy viajes_actualizar on public.viajes for update to authenticated
using      ((select public.has_permission('viajes.editar')))
with check ((select public.has_permission('viajes.editar')));

-- Trigger: id y created_at inmutables; 'cancelado' solo vía cancelar_viaje().
-- Sin JWT (SQL editor / service role) no se restringe.
create or replace function public._viajes_proteger_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.email() is null then
    return new;
  end if;

  if new.id is distinct from old.id
  or new.created_at is distinct from old.created_at
  then
    raise exception 'No se pueden modificar el id ni la fecha de creación de un viaje';
  end if;

  if new.estado = 'cancelado' and old.estado is distinct from 'cancelado'
     and coalesce(current_setting('app.cancelando_viaje', true), '') <> old.id::text
  then
    raise exception 'Para cancelar un viaje usá cancelar_viaje()';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_viajes_proteger_update on public.viajes;
create trigger trg_viajes_proteger_update
before update on public.viajes
for each row execute function public._viajes_proteger_update();

-- 4) cancelar_viaje: atómico ---------------------------------------------
--   1. estado = 'cancelado'
--   2. todos los viaje_pasajeros → 'No asiste', puntos 0
--   3. por cada (pasajero, método, banco), una Devolución por la suma de sus
--      pagos tipo 'Pago' (misma regla que el flujo anterior del navegador)
create or replace function public.cancelar_viaje(p_viaje_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado     text;
  v_pasajeros  int;
  v_devs       int;
begin
  if not public.has_permission('viajes.cancelar') then
    raise exception 'No tenés permiso para cancelar viajes' using errcode = '42501';
  end if;

  select estado into v_estado from viajes where id = p_viaje_id for update;
  if not found then
    raise exception 'No existe el viaje %', p_viaje_id;
  end if;
  if v_estado = 'cancelado' then
    raise exception 'El viaje ya está cancelado';
  end if;

  perform set_config('app.cancelando_viaje', p_viaje_id::text, true);
  update viajes set estado = 'cancelado' where id = p_viaje_id;

  update viaje_pasajeros
     set asistencia = 'No asiste', puntos_destino = 0
   where viaje_id = p_viaje_id;
  get diagnostics v_pasajeros = row_count;

  insert into pagos (viaje_pasajero_id, monto, tipo, metodo_pago_id, banco, fecha_pago, observacion, creado_por)
  select p.viaje_pasajero_id, sum(p.monto), 'Devolución', p.metodo_pago_id, p.banco,
         (now() at time zone 'America/Asuncion')::date,
         'Devolución automática por cancelación de viaje', auth.email()
    from pagos p
    join viaje_pasajeros vp on vp.id = p.viaje_pasajero_id
   where vp.viaje_id = p_viaje_id and p.tipo = 'Pago'
   group by p.viaje_pasajero_id, p.metodo_pago_id, p.banco
  having sum(p.monto) > 0;
  get diagnostics v_devs = row_count;

  return jsonb_build_object('pasajeros', v_pasajeros, 'devoluciones', v_devs);
end;
$$;

revoke execute on function public.cancelar_viaje(bigint) from public, anon;
grant execute on function public.cancelar_viaje(bigint) to authenticated;

-- 5) viaje_pasajeros ----------------------------------------------------
drop policy if exists select_staff          on public.viaje_pasajeros;
drop policy if exists insert_admin_worker   on public.viaje_pasajeros;
drop policy if exists update_admin_only     on public.viaje_pasajeros;
drop policy if exists viaje_pasajeros_leer       on public.viaje_pasajeros;
drop policy if exists viaje_pasajeros_agregar    on public.viaje_pasajeros;
drop policy if exists viaje_pasajeros_actualizar on public.viaje_pasajeros;

create policy viaje_pasajeros_leer on public.viaje_pasajeros for select to authenticated
using ((select public.has_permission('viaje_pasajeros.ver')));

create policy viaje_pasajeros_agregar on public.viaje_pasajeros for insert to authenticated
with check ((select public.has_permission('viaje_pasajeros.agregar')));

create policy viaje_pasajeros_actualizar on public.viaje_pasajeros for update to authenticated
using      ((select public.has_permission('viaje_pasajeros.editar')))
with check ((select public.has_permission('viaje_pasajeros.editar')));

-- Trigger:
--   INSERT: el autor es siempre quien llama; reemplaza_a solo lo fija
--           reemplazar_pasajero().
--   UPDATE: id, viaje_id, pasajero_id, reemplaza_a, creado_por y created_at
--           son inmutables.
-- Sin JWT (SQL editor / service role) no se restringe.
create or replace function public._viaje_pasajeros_proteger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.email() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.reemplaza_a is not null
       and coalesce(current_setting('app.reemplazando_pasajero', true), '') <> '1' then
      raise exception 'El vínculo de reemplazo solo se crea con reemplazar_pasajero()';
    end if;
    new.creado_por := auth.email();
    return new;
  end if;

  if new.id          is distinct from old.id
  or new.viaje_id    is distinct from old.viaje_id
  or new.pasajero_id is distinct from old.pasajero_id
  or new.reemplaza_a is distinct from old.reemplaza_a
  or new.creado_por  is distinct from old.creado_por
  or new.created_at  is distinct from old.created_at
  then
    raise exception 'No se pueden modificar el viaje, el cliente ni el origen de un pasajero del viaje';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_viaje_pasajeros_proteger on public.viaje_pasajeros;
create trigger trg_viaje_pasajeros_proteger
before insert or update on public.viaje_pasajeros
for each row execute function public._viaje_pasajeros_proteger();

-- 6) reemplazar_pasajero: permisos, search_path y autor desde el JWT -----
-- La lógica es la anterior. p_creado_por se conserva en la firma por
-- compatibilidad con el front, pero se ignora (no es de fiar).
create or replace function public.reemplazar_pasajero(
  p_viaje_pasajero_origen_id bigint,
  p_pasajero_nuevo_id        bigint,
  p_total_a_pagar            numeric,
  p_transferir_sena          boolean,
  p_creado_por               text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viaje_id       bigint;
  v_puntos_viaje   numeric;
  v_viajes_previos int;
  v_es_miembro     boolean;
  v_puntos_asignar numeric;
  v_vp_nuevo_id    bigint;
  v_pago           record;
  v_reg_origen_id  bigint;
  v_reg_destino_id bigint;
  v_hoy            date := (now() at time zone 'America/Asuncion')::date;
  v_autor          text := auth.email();
begin
  if not (public.has_permission('viaje_pasajeros.reemplazar')
          and public.has_permission('viaje_pasajeros.agregar')) then
    raise exception 'No tenés permiso para reemplazar pasajeros' using errcode = '42501';
  end if;

  -- Bloquear la fila de origen para evitar carreras (doble reemplazo simultáneo)
  select viaje_id into v_viaje_id
    from viaje_pasajeros
   where id = p_viaje_pasajero_origen_id
     for update;

  if v_viaje_id is null then
    raise exception 'No existe viaje_pasajero de origen (id=%)', p_viaje_pasajero_origen_id;
  end if;

  -- Evitar reemplazar dos veces el mismo registro
  if exists (select 1 from viaje_pasajeros where reemplaza_a = p_viaje_pasajero_origen_id) then
    raise exception 'Este pasajero ya fue reemplazado anteriormente';
  end if;

  -- a) Marcar origen como "No asiste"
  update viaje_pasajeros
     set asistencia = 'No asiste'
   where id = p_viaje_pasajero_origen_id;

  -- Calcular puntos/membresía igual que en guardarPasajeroEnViaje()
  select count(*) into v_viajes_previos
    from viaje_pasajeros
   where pasajero_id = p_pasajero_nuevo_id
     and asistencia = 'Asiste';

  v_es_miembro := v_viajes_previos >= 2;

  select puntos_destino into v_puntos_viaje from viajes where id = v_viaje_id;

  v_puntos_asignar := case when v_es_miembro then coalesce(v_puntos_viaje, 0) else 0 end;

  -- b) Insertar nuevo viaje_pasajero con la relación de reemplazo
  perform set_config('app.reemplazando_pasajero', '1', true);
  insert into viaje_pasajeros (
    viaje_id, pasajero_id, total_a_pagar, asistencia,
    puntos_destino, creado_por, reemplaza_a
  )
  values (
    v_viaje_id, p_pasajero_nuevo_id, p_total_a_pagar, 'Asiste',
    v_puntos_asignar, v_autor, p_viaje_pasajero_origen_id
  )
  returning id into v_vp_nuevo_id;

  -- c) Transferencia de seña (opcional), mismo patrón que confirmarTransferirPago()
  if p_transferir_sena then
    for v_pago in
      select id, monto, metodo_pago_id
        from pagos
       where viaje_pasajero_id = p_viaje_pasajero_origen_id
    loop
      insert into pagos (
        viaje_pasajero_id, monto, tipo, fecha_pago,
        metodo_pago_id, ref_origen, observacion, creado_por
      )
      values (
        p_viaje_pasajero_origen_id, v_pago.monto, 'Transferencia', v_hoy,
        v_pago.metodo_pago_id, v_pago.id,
        'Transferido por reemplazo de pasajero', v_autor
      )
      returning id into v_reg_origen_id;

      insert into pagos (
        viaje_pasajero_id, monto, tipo, fecha_pago,
        metodo_pago_id, referencia_pago_id, observacion, creado_por
      )
      values (
        v_vp_nuevo_id, v_pago.monto, 'Pago', v_hoy,
        v_pago.metodo_pago_id, v_reg_origen_id,
        'Transferencia por reemplazo de pasajero', v_autor
      )
      returning id into v_reg_destino_id;

      update pagos
         set referencia_pago_id = v_reg_destino_id
       where id = v_reg_origen_id;
    end loop;
  end if;

  return v_vp_nuevo_id;
end;
$$;

revoke execute on function public.reemplazar_pasajero(bigint, bigint, numeric, boolean, text) from public, anon;
grant execute on function public.reemplazar_pasajero(bigint, bigint, numeric, boolean, text) to authenticated;

-- 7) Storage: bucket "viajes" ---------------------------------------------
drop policy if exists "Actualizar archivos viajes" on storage.objects;
drop policy if exists "Borrar archivos viajes"     on storage.objects;
drop policy if exists "Leer archivos viajes"       on storage.objects;
drop policy if exists "Subir archivos 1litznu_0"   on storage.objects;
drop policy if exists viajes_storage_insert on storage.objects;
drop policy if exists viajes_storage_update on storage.objects;
drop policy if exists viajes_storage_delete on storage.objects;
drop policy if exists viajes_storage_select on storage.objects;

create policy viajes_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'viajes'
  and (
    (select public.has_permission('viajes.crear'))
    or (select public.has_permission('viajes.editar'))
  )
);

create policy viajes_storage_update on storage.objects for update to authenticated
using      (bucket_id = 'viajes' and (select public.has_permission('viajes.editar')))
with check (bucket_id = 'viajes' and (select public.has_permission('viajes.editar')));

create policy viajes_storage_delete on storage.objects for delete to authenticated
using (bucket_id = 'viajes' and (select public.has_permission('viajes.editar')));

-- Las imágenes se muestran por URL pública (el bucket es público y no
-- necesita policy). Esta policy solo cubre el chequeo previo del upsert.
create policy viajes_storage_select on storage.objects for select to authenticated
using (bucket_id = 'viajes' and (select public.has_permission('viajes.ver')));

commit;

-- ============================================================
-- Saldo neto en cancelar_viaje() y reemplazar_pasajero()
-- Ambas usaban solo los pagos tipo 'Pago' e ignoraban devoluciones y
-- transferencias previas: un pasajero con una devolución manual recibía
-- otra por el mismo monto al cancelar, y al reemplazar se transferían
-- también las filas de Devolución/Transferencia.
-- Ahora ambas usan _saldo_neto_pagos(), con la misma regla que la pantalla
-- de pagos: neto = Pago - Devolución - Transferencia.
--   * Se calcula por pasajero, método y banco. Una Transferencia toma el
--     banco/método del Pago al que apunta ref_origen.
--   * Si hay devoluciones sin banco (manuales), el total por método manda:
--     el neto del método se reparte entre sus bancos, de mayor a menor.
--   * cancelar_viaje(): una Devolución por cada grupo con neto > 0.
--   * reemplazar_pasajero(): una Transferencia (y su Pago en el destino)
--     por grupo con neto > 0; ref_origen apunta a un Pago del grupo que
--     aún no tenga transferencia. El Pago destino conserva el banco.
-- Las definiciones vigentes de cancelar_viaje() y reemplazar_pasajero()
-- son las de este bloque (reemplazan a las de arriba).
-- ============================================================

create or replace function public._saldo_neto_pagos(p_vp_ids bigint[])
returns table (viaje_pasajero_id bigint, metodo_pago_id bigint, banco text, monto numeric)
language sql
stable
set search_path = public
as $$
  with mov as (
    select p.viaje_pasajero_id as vp, p.metodo_pago_id as metodo, p.banco as banco,
           case p.tipo when 'Pago' then p.monto else -p.monto end as monto
      from pagos p
     where p.viaje_pasajero_id = any(p_vp_ids) and p.tipo in ('Pago', 'Devolución')
    union all
    select t.viaje_pasajero_id, coalesce(o.metodo_pago_id, t.metodo_pago_id), coalesce(o.banco, t.banco), -t.monto
      from pagos t
      left join pagos o on o.id::text = t.ref_origen
     where t.viaje_pasajero_id = any(p_vp_ids) and t.tipo = 'Transferencia'
  ),
  g as (
    select vp, metodo, banco, sum(monto) as net_g from mov group by vp, metodo, banco
  ),
  g2 as (
    select g.*, sum(net_g) over (partition by vp, metodo) as net_m from g
  ),
  a as (
    select g2.*,
           coalesce(sum(net_g) over (partition by vp, metodo order by net_g desc, banco nulls last
                                     rows between unbounded preceding and 1 preceding), 0) as prev
      from g2
     where net_g > 0 and net_m > 0
  )
  select vp, metodo, banco, least(net_g, net_m - prev)
    from a
   where least(net_g, net_m - prev) > 0
$$;

revoke execute on function public._saldo_neto_pagos(bigint[]) from public, anon;
grant execute on function public._saldo_neto_pagos(bigint[]) to authenticated;

create or replace function public.cancelar_viaje(p_viaje_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado     text;
  v_pasajeros  int;
  v_devs       int;
begin
  if not public.has_permission('viajes.cancelar') then
    raise exception 'No tenés permiso para cancelar viajes' using errcode = '42501';
  end if;

  select estado into v_estado from viajes where id = p_viaje_id for update;
  if not found then
    raise exception 'No existe el viaje %', p_viaje_id;
  end if;
  if v_estado = 'cancelado' then
    raise exception 'El viaje ya está cancelado';
  end if;

  perform set_config('app.cancelando_viaje', p_viaje_id::text, true);
  update viajes set estado = 'cancelado' where id = p_viaje_id;

  update viaje_pasajeros
     set asistencia = 'No asiste', puntos_destino = 0
   where viaje_id = p_viaje_id;
  get diagnostics v_pasajeros = row_count;

  insert into pagos (viaje_pasajero_id, monto, tipo, metodo_pago_id, banco, fecha_pago, observacion, creado_por)
  select s.viaje_pasajero_id, s.monto, 'Devolución', s.metodo_pago_id, s.banco,
         (now() at time zone 'America/Asuncion')::date,
         'Devolución automática por cancelación de viaje', auth.email()
    from public._saldo_neto_pagos(array(select id from viaje_pasajeros where viaje_id = p_viaje_id)) s;
  get diagnostics v_devs = row_count;

  return jsonb_build_object('pasajeros', v_pasajeros, 'devoluciones', v_devs);
end;
$$;

revoke execute on function public.cancelar_viaje(bigint) from public, anon;
grant execute on function public.cancelar_viaje(bigint) to authenticated;

create or replace function public.reemplazar_pasajero(
  p_viaje_pasajero_origen_id bigint,
  p_pasajero_nuevo_id        bigint,
  p_total_a_pagar            numeric,
  p_transferir_sena          boolean,
  p_creado_por               text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viaje_id       bigint;
  v_puntos_viaje   numeric;
  v_viajes_previos int;
  v_es_miembro     boolean;
  v_puntos_asignar numeric;
  v_vp_nuevo_id    bigint;
  v_saldo          record;
  v_reg_origen_id  bigint;
  v_reg_destino_id bigint;
  v_hoy            date := (now() at time zone 'America/Asuncion')::date;
  v_autor          text := auth.email();
begin
  if not (public.has_permission('viaje_pasajeros.reemplazar')
          and public.has_permission('viaje_pasajeros.agregar')) then
    raise exception 'No tenés permiso para reemplazar pasajeros' using errcode = '42501';
  end if;

  select viaje_id into v_viaje_id
    from viaje_pasajeros
   where id = p_viaje_pasajero_origen_id
     for update;

  if v_viaje_id is null then
    raise exception 'No existe viaje_pasajero de origen (id=%)', p_viaje_pasajero_origen_id;
  end if;

  if exists (select 1 from viaje_pasajeros where reemplaza_a = p_viaje_pasajero_origen_id) then
    raise exception 'Este pasajero ya fue reemplazado anteriormente';
  end if;

  update viaje_pasajeros
     set asistencia = 'No asiste'
   where id = p_viaje_pasajero_origen_id;

  select count(*) into v_viajes_previos
    from viaje_pasajeros
   where pasajero_id = p_pasajero_nuevo_id
     and asistencia = 'Asiste';

  v_es_miembro := v_viajes_previos >= 2;

  select puntos_destino into v_puntos_viaje from viajes where id = v_viaje_id;

  v_puntos_asignar := case when v_es_miembro then coalesce(v_puntos_viaje, 0) else 0 end;

  perform set_config('app.reemplazando_pasajero', '1', true);
  insert into viaje_pasajeros (
    viaje_id, pasajero_id, total_a_pagar, asistencia,
    puntos_destino, creado_por, reemplaza_a
  )
  values (
    v_viaje_id, p_pasajero_nuevo_id, p_total_a_pagar, 'Asiste',
    v_puntos_asignar, v_autor, p_viaje_pasajero_origen_id
  )
  returning id into v_vp_nuevo_id;

  if p_transferir_sena then
    for v_saldo in
      select s.metodo_pago_id, s.banco, s.monto,
             (select max(o.id)
                from pagos o
               where o.viaje_pasajero_id = p_viaje_pasajero_origen_id
                 and o.tipo = 'Pago'
                 and o.metodo_pago_id is not distinct from s.metodo_pago_id
                 and o.banco is not distinct from s.banco
                 and not exists (select 1 from pagos t
                                  where t.tipo = 'Transferencia' and t.ref_origen = o.id::text)) as pago_ref
        from public._saldo_neto_pagos(array[p_viaje_pasajero_origen_id]) s
    loop
      insert into pagos (
        viaje_pasajero_id, monto, tipo, fecha_pago,
        metodo_pago_id, banco, ref_origen, observacion, creado_por
      )
      values (
        p_viaje_pasajero_origen_id, v_saldo.monto, 'Transferencia', v_hoy,
        v_saldo.metodo_pago_id, v_saldo.banco, v_saldo.pago_ref::text,
        'Transferido por reemplazo de pasajero', v_autor
      )
      returning id into v_reg_origen_id;

      insert into pagos (
        viaje_pasajero_id, monto, tipo, fecha_pago,
        metodo_pago_id, banco, referencia_pago_id, observacion, creado_por
      )
      values (
        v_vp_nuevo_id, v_saldo.monto, 'Pago', v_hoy,
        v_saldo.metodo_pago_id, v_saldo.banco, v_reg_origen_id,
        'Transferencia por reemplazo de pasajero', v_autor
      )
      returning id into v_reg_destino_id;

      update pagos
         set referencia_pago_id = v_reg_destino_id
       where id = v_reg_origen_id;
    end loop;
  end if;

  return v_vp_nuevo_id;
end;
$$;

revoke execute on function public.reemplazar_pasajero(bigint, bigint, numeric, boolean, text) from public, anon;
grant execute on function public.reemplazar_pasajero(bigint, bigint, numeric, boolean, text) to authenticated;
