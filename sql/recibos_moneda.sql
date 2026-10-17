-- ══════════════════════════════════════════════
--  Recibos: soporte de moneda (PYG / USD)
--  Los recibos existentes quedan como PYG por el default.
--  Los totales NO mezclan monedas: total_gs suma solo PYG y total_usd solo USD.
--  Las funciones cambian su tipo de retorno, por eso se hace DROP + CREATE.
-- ══════════════════════════════════════════════

alter table public.recibos
  add column if not exists moneda text not null default 'PYG'
  check (moneda in ('PYG', 'USD'));

-- ── Listados (agregan r.moneda) ───────────────
drop function if exists public.recibos_buscar(text, integer, integer);
create function public.recibos_buscar(p_query text, p_limit integer default 50, p_offset integer default 0)
returns table(id bigint, created_at timestamptz, cliente text, ci text, correo_beneficiario text, monto numeric, moneda text, fecha date, concepto text, forma_pago text, banco text, comprobante text, abona_por text, tipo_recibo_id bigint, tipo_recibo_nombre text, usuario text, link text, recibo_nro text)
language sql stable as $$
  select
    r.id, r.created_at, r.cliente, r.ci, r.correo_beneficiario, r.monto, r.moneda,
    r.fecha, r.concepto, r.forma_pago, r.banco, r.comprobante, r.abona_por,
    r.tipo_recibo_id, tr.tipo as tipo_recibo_nombre, r.usuario, r.link, r.recibo_nro
  from recibos r
  left join tipo_recibos tr on tr.id = r.tipo_recibo_id
  where
    r.cliente ilike '%' || p_query || '%' or
    r.ci ilike '%' || p_query || '%' or
    r.abona_por ilike '%' || p_query || '%' or
    r.concepto ilike '%' || p_query || '%' or
    r.recibo_nro::text ilike '%' || p_query || '%' or
    r.forma_pago ilike '%' || p_query || '%'
  order by r.fecha desc, r.id desc
  limit p_limit offset p_offset;
$$;

drop function if exists public.recibos_listar_por_tipo(bigint, integer, integer);
create function public.recibos_listar_por_tipo(p_tipo_recibo_id bigint, p_limit integer default 50, p_offset integer default 0)
returns table(id bigint, created_at timestamptz, cliente text, ci text, correo_beneficiario text, monto numeric, moneda text, fecha date, concepto text, forma_pago text, banco text, comprobante text, abona_por text, tipo_recibo_id bigint, tipo_recibo_nombre text, usuario text, link text, recibo_nro text)
language sql stable as $$
  select
    r.id, r.created_at, r.cliente, r.ci, r.correo_beneficiario, r.monto, r.moneda,
    r.fecha, r.concepto, r.forma_pago, r.banco, r.comprobante, r.abona_por,
    r.tipo_recibo_id, tr.tipo as tipo_recibo_nombre, r.usuario, r.link, r.recibo_nro
  from recibos r
  left join tipo_recibos tr on tr.id = r.tipo_recibo_id
  where r.tipo_recibo_id = p_tipo_recibo_id
  order by r.fecha desc, r.id desc
  limit p_limit offset p_offset;
$$;

drop function if exists public.recibos_listar_todos(integer, integer);
create function public.recibos_listar_todos(p_limit integer default 50, p_offset integer default 0)
returns table(id bigint, created_at timestamptz, cliente text, ci text, correo_beneficiario text, monto numeric, moneda text, fecha date, concepto text, forma_pago text, banco text, comprobante text, abona_por text, tipo_recibo_id bigint, tipo_recibo_nombre text, usuario text, link text, recibo_nro text)
language sql stable as $$
  select
    r.id, r.created_at, r.cliente, r.ci, r.correo_beneficiario, r.monto, r.moneda,
    r.fecha, r.concepto, r.forma_pago, r.banco, r.comprobante, r.abona_por,
    r.tipo_recibo_id, tr.tipo as tipo_recibo_nombre, r.usuario, r.link, r.recibo_nro
  from recibos r
  left join tipo_recibos tr on tr.id = r.tipo_recibo_id
  order by r.fecha desc, r.id desc
  limit p_limit offset p_offset;
$$;

drop function if exists public.recibos_viaje_detalle(text);
create function public.recibos_viaje_detalle(p_abona_por text)
returns table(id bigint, created_at timestamptz, cliente text, ci text, correo_beneficiario text, monto numeric, moneda text, fecha date, concepto text, forma_pago text, banco text, comprobante text, abona_por text, tipo_recibo_id bigint, tipo_recibo_nombre text, usuario text, link text, recibo_nro text)
language sql stable as $$
  select
    r.id, r.created_at, r.cliente, r.ci, r.correo_beneficiario, r.monto, r.moneda,
    r.fecha, r.concepto, r.forma_pago, r.banco, r.comprobante, r.abona_por,
    r.tipo_recibo_id, tr.tipo as tipo_recibo_nombre, r.usuario, r.link, r.recibo_nro
  from recibos r
  left join tipo_recibos tr on tr.id = r.tipo_recibo_id
  where (p_abona_por is null and r.abona_por is null)
     or r.abona_por = p_abona_por
  order by r.fecha desc, r.id desc;
$$;

-- ── Totales (separados por moneda) ────────────
drop function if exists public.recibos_listar_viajes(integer, integer);
create function public.recibos_listar_viajes(p_limit integer default 6, p_offset integer default 0)
returns table(abona_por text, cantidad bigint, total_gs numeric, total_usd numeric, fecha_mas_reciente date)
language sql stable as $$
  select
    r.abona_por,
    count(*)::bigint as cantidad,
    coalesce(sum(r.monto) filter (where r.moneda = 'PYG'), 0)::numeric as total_gs,
    coalesce(sum(r.monto) filter (where r.moneda = 'USD'), 0)::numeric as total_usd,
    max(r.fecha) as fecha_mas_reciente
  from recibos r
  group by r.abona_por
  order by (r.abona_por is null) asc, max(r.fecha) desc
  limit p_limit offset p_offset;
$$;

drop function if exists public.recibos_resumen_mes();
create function public.recibos_resumen_mes()
returns table(cantidad bigint, total_gs numeric, total_usd numeric)
language sql stable as $$
  select
    count(*)::bigint as cantidad,
    coalesce(sum(monto) filter (where moneda = 'PYG'), 0)::numeric as total_gs,
    coalesce(sum(monto) filter (where moneda = 'USD'), 0)::numeric as total_usd
  from recibos
  where fecha >= date_trunc('month', current_date)
    and fecha <  date_trunc('month', current_date) + interval '1 month';
$$;
