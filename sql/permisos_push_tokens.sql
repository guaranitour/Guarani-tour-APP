-- ============================================================
-- push_tokens → cada usuario solo ve y modifica sus propios tokens
--
-- Antes: INSERT/SELECT/UPDATE con `true` para cualquier authenticated
-- (se podían leer todos los tokens o reasignar el staff_id de otro) y
-- sin policy de DELETE, por lo que la limpieza de tokens viejos de
-- js/push-notifications.js (savePushToken) no borraba nada y quedaban
-- tokens duplicados.
--
-- send-notifications usa service_role (bypassa RLS): no se ve afectada.
-- ============================================================

begin;

drop policy if exists push_tokens_insert on public.push_tokens;
drop policy if exists push_tokens_select on public.push_tokens;
drop policy if exists push_tokens_update on public.push_tokens;
drop policy if exists push_tokens_delete on public.push_tokens;

create policy push_tokens_select on public.push_tokens for select to authenticated
using (staff_id in (
  select s.id from public.staff s
  where s.email = auth.email() and s.status = 'enabled'
));

create policy push_tokens_insert on public.push_tokens for insert to authenticated
with check (staff_id in (
  select s.id from public.staff s
  where s.email = auth.email() and s.status = 'enabled'
));

create policy push_tokens_update on public.push_tokens for update to authenticated
using (staff_id in (
  select s.id from public.staff s
  where s.email = auth.email() and s.status = 'enabled'
))
with check (staff_id in (
  select s.id from public.staff s
  where s.email = auth.email() and s.status = 'enabled'
));

create policy push_tokens_delete on public.push_tokens for delete to authenticated
using (staff_id in (
  select s.id from public.staff s
  where s.email = auth.email() and s.status = 'enabled'
));

-- Limpieza puntual: tokens duplicados (se conserva el más reciente por staff).
-- Con las policies nuevas la app lo hará sola en el próximo login.
delete from public.push_tokens t
using public.push_tokens n
where t.staff_id = n.staff_id
  and t.last_used_at < n.last_used_at;

commit;
