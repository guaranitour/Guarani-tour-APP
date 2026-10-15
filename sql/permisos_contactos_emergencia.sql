-- ============================================================
-- Contacto de emergencia → permisos por tareas
-- Datos reales: reservas.bases_info_adicional (clave: ci), editado desde el
-- modal SOS del detalle de cliente y desde el formulario público (RPC por token).
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--
--   contactos.ver          admin, worker, viewer   leer el contacto
--   contactos.editar       admin, worker           crear / modificar
--   contactos.enviar_link  admin, worker, viewer   generar el link público
--
-- Se elimina public.contactos_emergencia: tabla legacy sin uso en la app
-- (última escritura 31/08/2026; el flujo por CI la reemplazó).
-- NO se toca: la policy INSERT abierta a anon/authenticated ("Cualquiera puede
-- insertar su info adicional") ni las RPC validar_token_ / guardar_..._por_token.
-- ============================================================

begin;

drop table if exists public.contactos_emergencia;

insert into public.permisos (codigo, modulo, descripcion) values
  ('contactos.ver',         'contactos', 'Ver el contacto de emergencia de un cliente'),
  ('contactos.editar',      'contactos', 'Crear o modificar el contacto de emergencia de un cliente'),
  ('contactos.enviar_link', 'contactos', 'Generar y compartir el link para que el cliente cargue su contacto')
on conflict (codigo) do nothing;

insert into public.rol_permisos (role, permiso) values
  ('admin',  'contactos.ver'),
  ('admin',  'contactos.editar'),
  ('admin',  'contactos.enviar_link'),
  ('worker', 'contactos.ver'),
  ('worker', 'contactos.editar'),
  ('worker', 'contactos.enviar_link'),
  ('viewer', 'contactos.ver'),
  ('viewer', 'contactos.enviar_link')
on conflict do nothing;

-- bases_info_adicional ----------------------------------------------------
drop policy if exists staff_select_bases_info_adicional on reservas.bases_info_adicional;
drop policy if exists staff_insert_bases_info_adicional on reservas.bases_info_adicional;
drop policy if exists staff_update_bases_info_adicional on reservas.bases_info_adicional;
drop policy if exists bases_info_adicional_select on reservas.bases_info_adicional;
drop policy if exists bases_info_adicional_insert on reservas.bases_info_adicional;
drop policy if exists bases_info_adicional_update on reservas.bases_info_adicional;

create policy bases_info_adicional_select on reservas.bases_info_adicional
  for select to authenticated
  using ((select public.has_permission('contactos.ver')));

create policy bases_info_adicional_insert on reservas.bases_info_adicional
  for insert to authenticated
  with check ((select public.has_permission('contactos.editar')));

create policy bases_info_adicional_update on reservas.bases_info_adicional
  for update to authenticated
  using      ((select public.has_permission('contactos.editar')))
  with check ((select public.has_permission('contactos.editar')));

-- contacto_emergencia_links ---------------------------------------------------
drop policy if exists staff_select_contacto_emergencia_links on reservas.contacto_emergencia_links;
drop policy if exists contacto_emergencia_links_select on reservas.contacto_emergencia_links;

create policy contacto_emergencia_links_select on reservas.contacto_emergencia_links
  for select to authenticated
  using ((select public.has_permission('contactos.enviar_link')));

-- generar_link_contacto_emergencia: mismo cuerpo, autorización por tarea ----------
create or replace function reservas.generar_link_contacto_emergencia(
  p_ci       text,
  p_base_url text default 'https://www.guaranitour.com/contacto-emergencia.html'
)
returns text
language plpgsql
security definer
set search_path to 'reservas', 'public'
as $$
declare
  v_ci     text := regexp_replace(coalesce(p_ci, ''), '\D', '', 'g');
  v_token  text;
  v_nombre text;
begin
  if not public.has_permission('contactos.enviar_link') then
    raise exception 'No autorizado';
  end if;

  if v_ci = '' then
    raise exception 'CI inválido';
  end if;

  select p."Pasajero" into v_nombre
  from public.pasajeros p
  where regexp_replace(coalesce(p."Documento de Identidad", ''), '\D', '', 'g') = v_ci
  limit 1;

  v_token := md5(random()::text || clock_timestamp()::text)
          || md5(random()::text || clock_timestamp()::text || v_ci);

  insert into reservas.contacto_emergencia_links (ci, nombre, token, created_by)
  values (v_ci, v_nombre, v_token, auth.email());

  return p_base_url || '?t=' || v_token;
end;
$$;

commit;
