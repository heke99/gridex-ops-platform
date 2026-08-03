begin;

do $$
declare
  v_signature regprocedure;
begin
  for v_signature in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'store_website_public_contract_snapshot'
  loop
    execute format('drop function if exists %s', v_signature);
  end loop;
end;
$$;

create function public.store_website_public_contract_snapshot(
  p_cache_key text,
  p_tenant_reference text,
  p_customer_type text,
  p_publication_revision bigint,
  p_contract_version text,
  p_parser_version text,
  p_schema_sha256 text,
  p_etag text,
  p_snapshot jsonb,
  p_accepted_count integer,
  p_blocked_count integer,
  p_upstream_count integer,
  p_feed_state text,
  p_empty_feed_authorization jsonb,
  p_fetched_at timestamptz
)
returns table (
  result text,
  stored boolean,
  empty_authorized boolean,
  stored_revision bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing public.website_public_contract_snapshots%rowtype;
  v_canonical_revision bigint;
  v_canonical_token text;
  v_canonical_changed_at timestamptz;
  v_existing_found boolean := false;
  v_empty_authorized boolean := false;
  v_authorization_revision bigint;
  v_authorization_reason text;
begin
  if
    nullif(trim(p_cache_key), '') is null
    or p_tenant_reference !~ '^tenant_[0-9a-f]{36}$'
    or p_customer_type not in ('all', 'private', 'business')
    or p_publication_revision is null
    or p_publication_revision < 0
    or nullif(trim(p_contract_version), '') is null
    or nullif(trim(p_parser_version), '') is null
    or p_schema_sha256 !~ '^[0-9a-f]{64}$'
    or p_snapshot is null
    or jsonb_typeof(p_snapshot) <> 'object'
    or p_snapshot ->> 'tenant_reference' is distinct from p_tenant_reference
    or p_snapshot ->> 'contract_version' is distinct from p_contract_version
    or p_snapshot -> 'publication_revision' is distinct from to_jsonb(p_publication_revision)
    or p_snapshot ->> 'feed_state' is distinct from p_feed_state
    or (
      p_empty_feed_authorization is null
      and coalesce(p_snapshot -> 'empty_feed_authorization', 'null'::jsonb) <> 'null'::jsonb
    )
    or (
      p_empty_feed_authorization is not null
      and p_snapshot -> 'empty_feed_authorization' is distinct from p_empty_feed_authorization
    )
    or p_accepted_count is null
    or p_blocked_count is null
    or p_upstream_count is null
    or p_accepted_count < 0
    or p_blocked_count < 0
    or p_upstream_count <> p_accepted_count + p_blocked_count
    or p_fetched_at is null
  then
    raise exception using errcode = '22023',
      message = 'CANONICAL_WEBSITE_PUBLIC_CONTRACT_SNAPSHOT_ARGUMENTS_INVALID';
  end if;

  if
    jsonb_typeof(p_snapshot -> 'contracts') <> 'array'
    or jsonb_typeof(p_snapshot -> 'blocked_contracts') <> 'array'
    or jsonb_array_length(p_snapshot -> 'contracts') <> p_accepted_count
    or jsonb_array_length(p_snapshot -> 'blocked_contracts') <> p_blocked_count
  then
    raise exception using errcode = '22023',
      message = 'CANONICAL_WEBSITE_PUBLIC_CONTRACT_SNAPSHOT_COUNTS_INVALID';
  end if;

  if p_feed_state = 'contracts_present' then
    if p_accepted_count <= 0 or p_upstream_count <= 0 or p_empty_feed_authorization is not null then
      raise exception using errcode = '22023',
        message = 'CONTRACTS_PRESENT_SNAPSHOT_INVALID';
    end if;
  elsif p_feed_state = 'canonical_empty' then
    if
      p_accepted_count <> 0
      or p_blocked_count <> 0
      or p_upstream_count <> 0
      or jsonb_typeof(p_empty_feed_authorization) <> 'object'
      or p_empty_feed_authorization -> 'authorized' is distinct from 'true'::jsonb
      or p_empty_feed_authorization ->> 'canonical_source' is distinct from 'canonical_public_contract_delivery_readiness_v'
      or jsonb_typeof(p_empty_feed_authorization -> 'affected_offer_references') <> 'array'
      or jsonb_typeof(p_empty_feed_authorization -> 'blockers') <> 'array'
      or jsonb_path_exists(p_empty_feed_authorization, '$.affected_offer_references[*] ? (@.type() != "string")')
      or jsonb_path_exists(p_empty_feed_authorization, '$.blockers[*] ? (@.type() != "string")')
      or (p_empty_feed_authorization - array[
        'authorized', 'reason', 'publication_revision', 'canonical_source',
        'affected_offer_references', 'blockers'
      ]::text[]) <> '{}'::jsonb
    then
      raise exception using errcode = '22023',
        message = 'CANONICAL_EMPTY_SNAPSHOT_PROOF_INVALID';
    end if;

    begin
      v_authorization_revision := (p_empty_feed_authorization ->> 'publication_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023',
        message = 'CANONICAL_EMPTY_SNAPSHOT_REVISION_INVALID';
    end;
    v_authorization_reason := p_empty_feed_authorization ->> 'reason';
    if
      v_authorization_revision is distinct from p_publication_revision
      or v_authorization_reason not in (
        'no_canonical_publications',
        'canonical_unpublished_or_archived',
        'publication_validity_ended',
        'canonical_no_visible_contracts'
      )
    then
      raise exception using errcode = '22023',
        message = 'CANONICAL_EMPTY_SNAPSHOT_PROOF_MISMATCH';
    end if;
    v_empty_authorized := true;
  else
    raise exception using errcode = '22023',
      message = 'CANONICAL_PUBLIC_CONTRACT_FEED_STATE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cache_key, 0));

  execute $canonical$
    select r.revision, r.revision_token::text, r.updated_at
    from public.contract_publication_revisions r
    join public.companies c on c.id = r.company_id
    where c.external_tenant_reference = $1
      and r.channel = 'website'
    limit 1
  $canonical$
    into v_canonical_revision, v_canonical_token, v_canonical_changed_at
    using p_tenant_reference;

  if v_canonical_revision is not null then
    insert into public.ops_publication_state (
      tenant_reference, channel, publication_revision, revision_token,
      changed_at, updated_at
    ) values (
      p_tenant_reference, 'website', v_canonical_revision,
      v_canonical_token, v_canonical_changed_at, now()
    )
    on conflict (tenant_reference, channel)
    do update set
      publication_revision = excluded.publication_revision,
      revision_token = excluded.revision_token,
      changed_at = excluded.changed_at,
      updated_at = now();
  end if;

  if v_canonical_revision is null then
    select publication_revision
      into v_canonical_revision
      from public.ops_publication_state
     where tenant_reference = p_tenant_reference
       and channel = 'website'
     for share;
  end if;

  if v_canonical_revision is null then
    return query select
      'rejected_publication_state_missing'::text,
      false,
      false,
      null::bigint;
    return;
  end if;

  if p_publication_revision <> v_canonical_revision then
    return query select
      case
        when p_publication_revision < v_canonical_revision
          then 'rejected_older_than_publication_state'
        else 'rejected_ahead_of_publication_state'
      end::text,
      false,
      false,
      v_canonical_revision;
    return;
  end if;

  select *
    into v_existing
    from public.website_public_contract_snapshots
   where cache_key = p_cache_key
   for update;
  v_existing_found := found;

  if v_existing_found and (
    v_existing.tenant_reference <> p_tenant_reference
    or v_existing.customer_type <> p_customer_type
    or v_existing.channel <> 'website'
  ) then
    raise exception using errcode = '23505',
      message = 'PUBLIC_CONTRACT_SNAPSHOT_CACHE_KEY_TENANT_CONFLICT';
  end if;

  if v_existing_found
     and v_existing.publication_revision > p_publication_revision then
    return query select
      'rejected_older_than_stored_snapshot'::text,
      false,
      false,
      v_existing.publication_revision;
    return;
  end if;

  insert into public.website_public_contract_snapshots (
    cache_key, tenant_reference, channel, customer_type,
    publication_revision, contract_version, parser_version, schema_sha256,
    etag, snapshot, accepted_count, blocked_count, upstream_count,
    feed_state, empty_feed_authorization, fetched_at, updated_at
  ) values (
    p_cache_key, p_tenant_reference, 'website', p_customer_type,
    p_publication_revision, p_contract_version, p_parser_version,
    p_schema_sha256, p_etag, p_snapshot, p_accepted_count,
    p_blocked_count, p_upstream_count, p_feed_state,
    p_empty_feed_authorization, p_fetched_at, now()
  )
  on conflict (cache_key)
  do update set
    tenant_reference = excluded.tenant_reference,
    channel = excluded.channel,
    customer_type = excluded.customer_type,
    publication_revision = excluded.publication_revision,
    contract_version = excluded.contract_version,
    parser_version = excluded.parser_version,
    schema_sha256 = excluded.schema_sha256,
    etag = excluded.etag,
    snapshot = excluded.snapshot,
    accepted_count = excluded.accepted_count,
    blocked_count = excluded.blocked_count,
    upstream_count = excluded.upstream_count,
    feed_state = excluded.feed_state,
    empty_feed_authorization = excluded.empty_feed_authorization,
    fetched_at = excluded.fetched_at,
    updated_at = now();

  return query select
    case when p_feed_state = 'canonical_empty'
      then 'stored_canonical_empty'
      else 'stored'
    end::text,
    true,
    v_empty_authorized,
    p_publication_revision;
end;
$$;

revoke all on function public.store_website_public_contract_snapshot(
  text, text, text, bigint, text, text, text, text, jsonb,
  integer, integer, integer, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.store_website_public_contract_snapshot(
  text, text, text, bigint, text, text, text, text, jsonb,
  integer, integer, integer, text, jsonb, timestamptz
) to service_role;

commit;
