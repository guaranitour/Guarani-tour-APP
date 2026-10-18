-- ============================================================
-- Auditoría (activity_log) para staff, staff_permisos,
-- transferencias_internas, recibos y movimientos_bancarios
-- Se suman a las que ya registraban: categorias, egresos, pagos,
-- presupuesto_viaje, servicio_extra_pasajeros, servicios_extra,
-- viaje_pasajeros y viajes.
-- Notas:
--  * fn_activity_log() hacía id::bigint y activity_log.record_id era NOT NULL:
--    staff tiene id uuid y staff_permisos no tiene id (PK compuesta), así que
--    con la función anterior esas tablas habrían fallado al escribir.
--    Ahora record_id (bigint) es opcional y se agrega record_key (text) con la
--    clave primaria de la fila: el id, o las columnas de la PK unidas con ':'
--    (staff_permisos: "<staff_id>:<permiso>").
--  * La función acepta columnas a ignorar como argumentos del trigger: un
--    UPDATE que solo cambia esas columnas no se registra. staff ignora
--    last_seen (touch_last_seen lo actualiza en cada sesión) y avatar_url
--    (se sincroniza solo desde Google).
--  * Solo lee el log quien tenga actividad.ver (admin).
-- ============================================================

begin;

alter table public.activity_log alter column record_id drop not null;
alter table public.activity_log add column if not exists record_key text;
update public.activity_log set record_key = record_id::text where record_key is null;

create or replace function public.fn_activity_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row       jsonb;
  v_id        text;
  v_record_id bigint;
  v_key       text;
begin
  -- UPDATE que solo toca columnas ignoradas (argumentos del trigger): no se registra
  if TG_OP = 'UPDATE' and TG_NARGS > 0
     and (to_jsonb(new) - TG_ARGV) = (to_jsonb(old) - TG_ARGV) then
    return new;
  end if;

  v_row := case when TG_OP = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_id  := v_row->>'id';

  if v_id ~ '^[0-9]{1,18}$' then
    v_record_id := v_id::bigint;
  end if;

  v_key := v_id;
  if v_key is null then
    -- Tablas sin columna id: se usa la clave primaria
    select string_agg(v_row->>a.attname, ':' order by array_position(i.indkey::int2[], a.attnum))
      into v_key
      from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = TG_RELID and i.indisprimary;
  end if;

  insert into public.activity_log (
    table_name, record_id, record_key, operation,
    old_data, new_data,
    changed_by, changed_by_email
  )
  values (
    TG_TABLE_NAME, v_record_id, v_key, TG_OP,
    case when TG_OP = 'INSERT' then null else to_jsonb(old) end,
    case when TG_OP = 'DELETE' then null else to_jsonb(new) end,
    auth.uid(),
    auth.email()
  );

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activity_log_staff                   on public.staff;
drop trigger if exists trg_activity_log_staff_permisos          on public.staff_permisos;
drop trigger if exists trg_activity_log_transferencias_internas on public.transferencias_internas;
drop trigger if exists trg_activity_log_recibos                 on public.recibos;
drop trigger if exists trg_activity_log_movimientos_bancarios   on public.movimientos_bancarios;

create trigger trg_activity_log_staff
after insert or update or delete on public.staff
for each row execute function public.fn_activity_log('last_seen', 'avatar_url');

create trigger trg_activity_log_staff_permisos
after insert or update or delete on public.staff_permisos
for each row execute function public.fn_activity_log();

create trigger trg_activity_log_transferencias_internas
after insert or update or delete on public.transferencias_internas
for each row execute function public.fn_activity_log();

create trigger trg_activity_log_recibos
after insert or update or delete on public.recibos
for each row execute function public.fn_activity_log();

create trigger trg_activity_log_movimientos_bancarios
after insert or update or delete on public.movimientos_bancarios
for each row execute function public.fn_activity_log();

commit;
