begin;
set local search_path = public, pg_catalog;

create index if not exists domain_events_portal_customer_keyset_idx
  on public.domain_events
    (company_id, subject_customer_id, occurred_at desc, id desc)
  where subject_customer_id is not null;

create or replace function public.portal_customer_events_page_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_source_rank integer default null,
  p_cursor_id uuid default null,
  p_limit integer default 51
)
returns table (
  id uuid,
  source_table text,
  source_rank integer,
  event_type text,
  source text,
  occurred_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  with all_events as (
    select
      e.id,
      'customer_events'::text as source_table,
      2::integer as source_rank,
      e.event_type,
      e.source,
      coalesce(e.occurred_at, e.created_at) as occurred_at,
      e.created_at
    from public.customer_events e
    where e.company_id = p_company_id
      and e.customer_id = p_customer_id

    union all

    select
      d.id,
      'domain_events'::text as source_table,
      1::integer as source_rank,
      d.event_type,
      d.source,
      coalesce(d.occurred_at, d.created_at) as occurred_at,
      d.created_at
    from public.domain_events d
    where d.company_id = p_company_id
      and d.subject_customer_id = p_customer_id
  )
  select
    e.id,
    e.source_table,
    e.source_rank,
    e.event_type,
    e.source,
    e.occurred_at,
    e.created_at
  from all_events e
  where p_cursor_occurred_at is null
     or (e.occurred_at, e.source_rank, e.id)
        < (p_cursor_occurred_at, coalesce(p_cursor_source_rank, 0), p_cursor_id)
  order by e.occurred_at desc, e.source_rank desc, e.id desc
  limit greatest(1, least(coalesce(p_limit, 51), 101));
$$;

revoke all on function public.portal_customer_events_page_v1(
  uuid, uuid, timestamptz, integer, uuid, integer
) from public, anon, authenticated;
grant execute on function public.portal_customer_events_page_v1(
  uuid, uuid, timestamptz, integer, uuid, integer
) to service_role;

commit;
