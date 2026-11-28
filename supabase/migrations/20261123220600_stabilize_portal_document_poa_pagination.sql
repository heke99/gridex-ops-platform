DO $migration$
BEGIN
  -- Keep physical V1 pagination for old cursors. V2 anchors a linked document to
  -- its scoped power of attorney and selects the current metadata at read time.
create function public.portal_customer_document_poa_winner_v1(
  p_company_id uuid, p_customer_id uuid, p_poa_id uuid
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
language sql stable security invoker set search_path = public, pg_catalog
as $$
  select candidate.* from (
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
    where d.company_id = p_company_id and d.customer_id = p_customer_id
      and d.power_of_attorney_id = p_poa_id
    order by d.created_at desc, d.id desc
    limit 1
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
    where a.company_id = p_company_id and a.customer_id = p_customer_id
      and a.power_of_attorney_id = p_poa_id
      and a.status <> 'archived'
    order by a.created_at desc, a.id desc
    limit 1
  )
  ) candidate
  where exists (
    select 1 from public.powers_of_attorney p
    where p.id = p_poa_id and p.company_id = p_company_id and p.customer_id = p_customer_id
  )
  order by candidate.source_rank desc, candidate.created_at desc, candidate.id desc
  limit 1;
$$;

revoke all on function public.portal_customer_document_poa_winner_v1(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.portal_customer_document_poa_winner_v1(uuid,uuid,uuid) to service_role;
create function public.portal_customer_documents_page_v2(
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
  created_at timestamptz,
  cursor_created_at timestamptz,
  cursor_source_rank integer,
  cursor_id uuid,
  public_reference_source text
)
language plpgsql
volatile
security invoker
set search_path = public, pg_catalog
as $$
begin
  perform public.ediel_require_portal_retention_access_v1(p_company_id, p_customer_id);
  return query
  select page_candidates.* from (
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
      d.created_at,
      d.created_at as cursor_created_at,
      2::integer as cursor_source_rank,
      d.id as cursor_id,
      d.id::text as public_reference_source
    from public.customer_documents d
    where d.company_id = p_company_id
      and d.customer_id = p_customer_id
      and not exists (
        select 1
        from public.powers_of_attorney anchor
        where anchor.id = d.power_of_attorney_id
          and anchor.company_id = p_company_id and anchor.customer_id = p_customer_id
      )
      -- Supply a conservative B-tree bound even in a generic prepared plan.
      and (d.created_at, d.id) <= (
        coalesce(p_cursor_created_at, 'infinity'::timestamptz),
        case
          when p_cursor_created_at is null or coalesce(p_cursor_source_rank, 0) > 2
            then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
          when p_cursor_source_rank = 2
            then coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          else '00000000-0000-0000-0000-000000000000'::uuid
        end
      )
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
      a.created_at,
      a.created_at as cursor_created_at,
      1::integer as cursor_source_rank,
      a.id as cursor_id,
      a.id::text as public_reference_source
    from public.customer_authorization_documents a
    where a.company_id = p_company_id
      and a.customer_id = p_customer_id
      and not exists (
        select 1
        from public.powers_of_attorney anchor
        where anchor.id = a.power_of_attorney_id
          and anchor.company_id = p_company_id and anchor.customer_id = p_customer_id
      )
      and a.status <> 'archived'
      -- Supply a conservative B-tree bound even in a generic prepared plan.
      and (a.created_at, a.id) <= (
        coalesce(p_cursor_created_at, 'infinity'::timestamptz),
        case
          when p_cursor_created_at is null or coalesce(p_cursor_source_rank, 0) > 1
            then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
          when p_cursor_source_rank = 1
            then coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          else '00000000-0000-0000-0000-000000000000'::uuid
        end
      )
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
    union all
    (
    select w.id,w.source_table,w.source_rank,w.document_type,w.status,w.title,w.file_name,
      w.mime_type,w.file_size_bytes,w.public_url,w.source_system,w.source,w.power_of_attorney_id,
      w.document_version,w.uploaded_at,w.created_at,
      p.created_at as cursor_created_at, 3::integer as cursor_source_rank,
      p.id as cursor_id, 'power-of-attorney:' || p.id::text as public_reference_source
    from public.powers_of_attorney p
    cross join lateral public.portal_customer_document_poa_winner_v1(p.company_id, p.customer_id, p.id) w
    where p.company_id = p_company_id and p.customer_id = p_customer_id
      and (p.created_at, p.id) <= (
        coalesce(p_cursor_created_at, 'infinity'::timestamptz),
        case
          when p_cursor_created_at is null or coalesce(p_cursor_source_rank, 0) > 3
            then 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid
          when p_cursor_source_rank = 3
            then coalesce(p_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid)
          else '00000000-0000-0000-0000-000000000000'::uuid
        end
      )
      and (p_cursor_created_at is null or
        (p.created_at, 3, p.id) < (p_cursor_created_at, coalesce(p_cursor_source_rank, 0), p_cursor_id))
    order by p.created_at desc, p.id desc
    limit greatest(1, least(coalesce(p_limit, 51), 101))
    )

  ) page_candidates
  order by page_candidates.cursor_created_at desc, page_candidates.cursor_source_rank desc, page_candidates.cursor_id desc
  limit greatest(1, least(coalesce(p_limit, 51), 101));
end;
$$;

revoke all on function public.portal_customer_documents_page_v2(uuid,uuid,timestamptz,integer,uuid,integer) from public, anon, authenticated;
grant execute on function public.portal_customer_documents_page_v2(uuid,uuid,timestamptz,integer,uuid,integer) to service_role;

-- Exact counterpart of publicReference('document', companyId, source) for
-- canonical lowercase UUID literals and an optional fixed POA namespace.
create function public.portal_document_reference_value_v1(p_company_id uuid, p_source text)
returns text
language sql immutable strict parallel safe security invoker set search_path = pg_catalog
as $$
  select 'document_' || left(
    translate(encode(sha256(convert_to(
      'gridex-public-reference:v1:' || p_company_id::text || ':document:' || p_source, 'UTF8'
    )), 'base64'), '+/', '-_'), 32);
$$;

revoke all on function public.portal_document_reference_value_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.portal_document_reference_value_v1(uuid,text) to service_role;

create index portal_document_reference_primary
  on public.customer_documents (company_id, customer_id, public.portal_document_reference_value_v1(company_id, id::text));
create index portal_document_reference_secondary
  on public.customer_authorization_documents (company_id, customer_id, public.portal_document_reference_value_v1(company_id, id::text))
  where status <> 'archived';
create index portal_document_reference_poa
  on public.powers_of_attorney (company_id, customer_id, public.portal_document_reference_value_v1(company_id, 'power-of-attorney:' || id::text));

create function public.portal_customer_document_reference_alias_v1(
  p_company_id uuid, p_customer_id uuid, p_public_reference text
)
returns jsonb
language sql stable security invoker set search_path = public, pg_catalog
as $$
  with reference_matches as (
    (
      select p.id as canonical_id, null::uuid as physical_id, null::integer as physical_rank
      from public.powers_of_attorney p
      where p.company_id = p_company_id and p.customer_id = p_customer_id
        and public.portal_document_reference_value_v1(p.company_id, 'power-of-attorney:' || p.id::text) = p_public_reference
      limit 2
    )
    union all
    (
      select p.id, d.id, 2
      from public.customer_documents d
      left join public.powers_of_attorney p
        on p.id = d.power_of_attorney_id and p.company_id = p_company_id and p.customer_id = p_customer_id
      where d.company_id = p_company_id and d.customer_id = p_customer_id
        and public.portal_document_reference_value_v1(d.company_id, d.id::text) = p_public_reference
      limit 2
    )
    union all
    (
      select p.id, a.id, 1
      from public.customer_authorization_documents a
      left join public.powers_of_attorney p
        on p.id = a.power_of_attorney_id and p.company_id = p_company_id and p.customer_id = p_customer_id
      where a.company_id = p_company_id and a.customer_id = p_customer_id and a.status <> 'archived'
        and public.portal_document_reference_value_v1(a.company_id, a.id::text) = p_public_reference
      limit 2
    )
  ), bindings as (
    select distinct canonical_id,
      case when canonical_id is null then physical_id end as physical_id,
      case when canonical_id is null then physical_rank end as physical_rank
    from reference_matches
  ), summary as (
    select count(*) as binding_count, count(canonical_id) as canonical_count
    from bindings
  ), visible as (
    select w.*
    from bindings b
    cross join summary
    cross join lateral public.portal_customer_document_poa_winner_v1(p_company_id,p_customer_id,b.canonical_id) w
    where b.canonical_id is not null and summary.binding_count = 1
  )
  select case
    when p_public_reference is null or p_public_reference !~ '^document_[A-Za-z0-9_-]{32}$'
      then jsonb_build_object('kind','unavailable')
    when s.canonical_count = 0 then jsonb_build_object('kind','unmatched')
    when s.binding_count <> 1 then jsonb_build_object('kind','ambiguous')
    when v.id is null then jsonb_build_object('kind','unavailable')
    else jsonb_build_object('kind','matched','document',
      to_jsonb(v) || jsonb_build_object('public_url', case
        when public.portal_document_reference_value_v1(p_company_id,v.id::text) = p_public_reference then v.public_url
        else null end)
    ) end
  from summary s left join visible v on true;
$$;

revoke all on function public.portal_customer_document_reference_alias_v1(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.portal_customer_document_reference_alias_v1(uuid,uuid,text) to service_role;

CREATE SCHEMA gridex_portal_document_references;
REVOKE ALL ON SCHEMA gridex_portal_document_references FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_portal_document_references.legacy_reference(company uuid, customer uuid, ref text)
RETURNS TABLE(id uuid, rank integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $$
  WITH candidates AS (
    (SELECT d.id,2 AS rank,d.power_of_attorney_id
     FROM public.customer_documents d
     WHERE d.company_id=company AND d.customer_id=customer
       AND public.portal_document_reference_value_v1(d.company_id,d.id::text)=ref
     LIMIT 2)
    UNION ALL
    (SELECT a.id,1 AS rank,a.power_of_attorney_id
     FROM public.customer_authorization_documents a
     WHERE a.company_id=company AND a.customer_id=customer AND a.status<>'archived'
       AND public.portal_document_reference_value_v1(a.company_id,a.id::text)=ref
     LIMIT 2)
  ), one AS (
    SELECT c.* FROM candidates c WHERE (SELECT count(*) FROM candidates)=1
  )
  SELECT s.id,s.rank FROM one s
  WHERE s.power_of_attorney_id IS NULL
     OR (s.rank,s.id)=(
       SELECT r.rank,r.id FROM (
         (SELECT d.id,2 AS rank,d.created_at FROM public.customer_documents d
          WHERE d.company_id=company AND d.customer_id=customer
            AND d.power_of_attorney_id=s.power_of_attorney_id
          ORDER BY d.created_at DESC,d.id DESC LIMIT 1)
         UNION ALL
         (SELECT a.id,1 AS rank,a.created_at FROM public.customer_authorization_documents a
          WHERE a.company_id=company AND a.customer_id=customer AND a.status<>'archived'
            AND a.power_of_attorney_id=s.power_of_attorney_id
          ORDER BY a.created_at DESC,a.id DESC LIMIT 1)
       ) r
       ORDER BY r.rank DESC,r.created_at DESC,r.id DESC
       LIMIT 1
     )
$$;
REVOKE ALL ON FUNCTION gridex_portal_document_references.legacy_reference(uuid,uuid,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA gridex_portal_document_references TO service_role;
GRANT EXECUTE ON FUNCTION gridex_portal_document_references.legacy_reference(uuid,uuid,text) TO service_role;

-- Both authorization and source selection execute in the same transaction.
CREATE FUNCTION public.portal_customer_document_reference_v2(
  p_company_id uuid,p_customer_id uuid,p_public_reference text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE payload jsonb;
BEGIN
  PERFORM public.ediel_require_portal_retention_access_v1(p_company_id,p_customer_id);
  WITH prior AS MATERIALIZED (
    SELECT public.portal_customer_document_reference_alias_v1(p_company_id,p_customer_id,p_public_reference) AS result
  ), key AS MATERIALIZED (
    SELECT l.id,l.rank FROM prior p
    CROSS JOIN LATERAL gridex_portal_document_references.legacy_reference(p_company_id,p_customer_id,
      CASE WHEN p.result->>'kind'='unmatched' THEN p_public_reference END) l
    WHERE p.result->>'kind'='unmatched'
  ), document AS (
    SELECT jsonb_build_object('id',d.id,'document_type',d.document_type,'status',d.status,
      'title',d.title,'file_name',d.file_name,'mime_type',d.mime_type,'file_size_bytes',d.file_size_bytes,
      'public_url',d.public_url,'document_version',d.document_version,'created_at',d.created_at) AS dto
    FROM key k JOIN public.customer_documents d ON k.rank=2 AND d.id=k.id
      AND d.company_id=p_company_id AND d.customer_id=p_customer_id
    UNION ALL
    SELECT jsonb_build_object('id',a.id,'document_type',a.document_type,'status',a.status,
      'title',a.title,'file_name',a.file_name,'mime_type',a.mime_type,'file_size_bytes',a.file_size_bytes,
      'public_url',NULL,'document_version',NULL,'created_at',a.created_at,'uploaded_at',a.uploaded_at)
    FROM key k JOIN public.customer_authorization_documents a ON k.rank=1 AND a.id=k.id
      AND a.company_id=p_company_id AND a.customer_id=p_customer_id AND a.status<>'archived'
  )
  SELECT CASE WHEN p.result->>'kind'='unmatched' AND d.dto IS NOT NULL
    THEN jsonb_build_object('kind','matched','document',d.dto) ELSE p.result END
    INTO STRICT payload
  FROM prior p LEFT JOIN document d ON true;
  RETURN payload;
END $$;
REVOKE ALL ON FUNCTION public.portal_customer_document_reference_v2(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.portal_customer_document_reference_v2(uuid,uuid,text)
  TO service_role;
END;
$migration$;
