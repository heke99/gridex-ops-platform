-- Look up the winning row for a POA before applying the cursor to that winner.
-- The winner lookup deliberately has no page cursor, including for the lower-priority source.
create index if not exists customer_documents_portal_poa_winner_idx
  on public.customer_documents (company_id, customer_id, power_of_attorney_id, created_at desc, id desc)
  where power_of_attorney_id is not null;
create index if not exists customer_authorization_documents_portal_poa_winner_idx
  on public.customer_authorization_documents (company_id, customer_id, power_of_attorney_id, created_at desc, id desc)
  where status <> 'archived' and power_of_attorney_id is not null;

create or replace function public.portal_customer_documents_page_v1(
  p_company_id uuid,
  p_customer_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_source_rank integer default null,
  p_cursor_id uuid default null,
  p_limit integer default 51
)
returns table (
  id uuid,
  source_table text,
  source_rank integer,
  document_type text,
  status text,
  title text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  public_url text,
  source_system text,
  source text,
  power_of_attorney_id uuid,
  document_version text,
  uploaded_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select * from (
    (

    select
      d.id,
      'customer_documents'::text as source_table,
      2::integer as source_rank,
      d.document_type,
      d.status,
      d.title,
      d.file_name,
      d.mime_type,
      d.file_size_bytes,
      d.public_url,
      d.source_system,
      d.source,
      d.power_of_attorney_id,
      d.document_version,
      null::timestamptz as uploaded_at,
      d.created_at
    from public.customer_documents d
    where d.company_id = p_company_id
      and d.customer_id = p_customer_id
      and (p_cursor_created_at is null or (
        d.created_at <= p_cursor_created_at and
        (d.created_at, 2, d.id) < (p_cursor_created_at, coalesce(p_cursor_source_rank, 0), p_cursor_id)
      ))
      and (d.power_of_attorney_id is null or d.id = (
        select preferred.id from public.customer_documents preferred
        where preferred.company_id = p_company_id
          and preferred.customer_id = p_customer_id
          and preferred.power_of_attorney_id = d.power_of_attorney_id
        order by preferred.created_at desc, preferred.id desc
        limit 1
      ))
    order by d.created_at desc, d.id desc
    limit greatest(1, least(coalesce(p_limit, 51), 101))
    )
    union all
    (
    select
      a.id,
      'customer_authorization_documents'::text as source_table,
      1::integer as source_rank,
      a.document_type,
      a.status,
      a.title,
      a.file_name,
      a.mime_type,
      a.file_size_bytes,
      null::text as public_url,
      'customer_authorization_documents'::text as source_system,
      'customer_authorization_documents'::text as source,
      a.power_of_attorney_id,
      null::text as document_version,
      a.uploaded_at,
      a.created_at
    from public.customer_authorization_documents a
    where a.company_id = p_company_id
      and a.customer_id = p_customer_id
      and a.status <> 'archived'
      and (p_cursor_created_at is null or (
        a.created_at <= p_cursor_created_at and
        (a.created_at, 1, a.id) < (p_cursor_created_at, coalesce(p_cursor_source_rank, 0), p_cursor_id)
      ))
      and (a.power_of_attorney_id is null or a.id = (
        select preferred.id from public.customer_authorization_documents preferred
        where preferred.company_id = p_company_id
          and preferred.customer_id = p_customer_id
          and preferred.power_of_attorney_id = a.power_of_attorney_id
          and preferred.status <> 'archived'
        order by preferred.created_at desc, preferred.id desc
        limit 1
      ))
      and (a.power_of_attorney_id is null or (
        select preferred.id from public.customer_documents preferred
        where preferred.company_id = p_company_id
          and preferred.customer_id = p_customer_id
          and preferred.power_of_attorney_id = a.power_of_attorney_id
        limit 1
      ) is null)
    order by a.created_at desc, a.id desc
    limit greatest(1, least(coalesce(p_limit, 51), 101))
    )
  ) page_candidates
  order by created_at desc, source_rank desc, id desc
  limit greatest(1, least(coalesce(p_limit, 51), 101));
$$;

revoke all on function public.portal_customer_documents_page_v1(uuid,uuid,timestamptz,integer,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.portal_customer_documents_page_v1(uuid,uuid,timestamptz,integer,uuid,integer)
  to service_role;
