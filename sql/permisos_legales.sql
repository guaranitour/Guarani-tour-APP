-- ============================================================
-- Módulo Legales → permisos 100% por tareas (sin modo híbrido)
-- Tabla: legales_documentos  ·  Bucket: legales-docs
-- Requiere: sql/permisos_por_tareas.sql ya aplicado.
--   admin / worker : legales.ver + legales.cargar (igual que antes)
--   resto de roles : nada
-- ============================================================

begin;

-- 1) Catálogo de tareas -------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('legales.ver',    'legales', 'Ver documentos legales y abrir/descargar el archivo'),
  ('legales.cargar', 'legales', 'Subir un documento legal nuevo')
on conflict (codigo) do nothing;

-- 2) Paquetes por rol: replican el acceso actual ----------------------
insert into public.rol_permisos (role, permiso) values
  ('admin',  'legales.ver'), ('admin',  'legales.cargar'),
  ('worker', 'legales.ver'), ('worker', 'legales.cargar')
on conflict do nothing;

-- 3) legales_documentos -------------------------------------------------
drop policy if exists legales_select_admin_worker on public.legales_documentos;
drop policy if exists legales_insert_admin_worker on public.legales_documentos;
drop policy if exists legales_select on public.legales_documentos;
drop policy if exists legales_insert on public.legales_documentos;

create policy legales_select on public.legales_documentos for select to public
using ((select public.has_permission('legales.ver')));

create policy legales_insert on public.legales_documentos for insert to public
with check ((select public.has_permission('legales.cargar')));

-- 4) Storage: bucket legales-docs --------------------------------------
drop policy if exists legales_storage_select_admin_worker on storage.objects;
drop policy if exists legales_storage_insert_admin_worker on storage.objects;
drop policy if exists legales_storage_select on storage.objects;
drop policy if exists legales_storage_insert on storage.objects;

create policy legales_storage_select on storage.objects for select to public
using (bucket_id = 'legales-docs' and (select public.has_permission('legales.ver')));

create policy legales_storage_insert on storage.objects for insert to public
with check (bucket_id = 'legales-docs' and (select public.has_permission('legales.cargar')));

commit;
