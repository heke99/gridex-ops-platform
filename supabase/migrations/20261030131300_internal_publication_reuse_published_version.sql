-- simulation: 20261029-3f1a8ab1/claude-track2/014
-- Internal publication reuse of an already published version.
--
-- gridex_ensure_internal_contract_publication (called by every internal
-- customer-contract create, the contract insert trigger and signing/import
-- paths) inserted a second 'published' version when the internal channel was
-- already published by gridex_publish_contract_channel with a different
-- snapshot. The partial unique index
-- contract_publication_versions_one_published_per_publication_uid then raised
-- 23505 for every contract created after channel publication.
--
-- Owner decision (alternative a): when the publication already has a published
-- version, reuse it only when every binding business field of the offer is
-- unchanged against the version's own columns (not the snapshot hash) and the
-- version's snapshot names this same offer. Any
-- difference raises the controlled domain error
-- internal_publication_republish_required (P0001); the call is atomic, so a
-- contract is never bound to stale terms. Without a published version the
-- previous behaviour is unchanged.
--
-- Concurrency: the offer row stays locked FOR UPDATE. The published version is
-- read only after the contract_publications upsert, whose ON CONFLICT DO
-- UPDATE (or fresh insert + unique index wait) holds the publication row lock
-- until commit. gridex_publish_contract_channel upserts the same row, so the
-- read-check-insert sequence is serialized per publication and the waiter
-- reuses the committed published version.
--
-- Guard: refuses unless the installed body is exactly the canonical fcb963b3
-- source (also pinned by 20261020220844) or this migration's own body (replay),
-- with unchanged security definer, owner, search_path and ACL.
begin;

do $guard$
declare
  f pg_catalog.pg_proc%rowtype;
  v_hash text;
begin
  select p.* into f from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)');
  if not found then
    raise exception 'internal_publication_reuse_function_missing' using errcode = '55000';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex');
  if v_hash not in (
    'fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984',
    'd18ca44d2865bb020f750ad88bc9213b1ff62017f21f42bfdcfe074771357a7d'
  ) then
    raise exception 'internal_publication_reuse_source_changed:%', v_hash using errcode = '55000';
  end if;
  if not f.prosecdef
    or f.proowner is distinct from (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user)
    or f.proconfig is distinct from array['search_path=public, extensions, pg_temp']
    or f.prorettype <> 'uuid'::regtype or f.prokind <> 'f' or f.proretset
    or f.prolang <> (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql') then
    raise exception 'internal_publication_reuse_metadata_changed' using errcode = '55000';
  end if;
  perform pg_catalog.set_config('gridex.internal_publication_reuse_acl',
    coalesce(f.proacl::text, ''), true);
end
$guard$;

create or replace function public.gridex_ensure_internal_contract_publication(
  p_company_id uuid, p_contract_offer_id uuid, p_actor_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  o public.contract_offers%rowtype; v_assignment_id uuid; v_publication_id uuid; v_version_id uuid;
  v_snapshot jsonb; v_hash text; v_number integer; v_status text; v_offer_reference text;
  v_published public.contract_publication_versions%rowtype;
begin
  select * into o from public.contract_offers
  where id=p_contract_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='internal_contract_offer_not_found'; end if;

  if o.contract_product_version_id is null or o.legal_bundle_version_id is null or o.price_plan_version_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id;
  end if;
  if o.contract_product_version_id is null or o.legal_bundle_version_id is null or o.price_plan_version_id is null then
    raise exception using errcode='23514',message='internal_offer_not_canonical_ready';
  end if;

  v_status:=case when o.is_active and o.status='active' then 'published' else 'draft' end;

  select id into v_assignment_id from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  order by created_at desc limit 1;

  if v_assignment_id is null then
    insert into public.tenant_contract_assignments(
      company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by
    ) values(
      p_company_id,o.contract_product_version_id,true,false,
      case when o.is_active and o.status='active' then 'active' else 'paused' end,
      'ops_standard',o.valid_from,o.valid_to,p_actor_user_id
    ) returning id into v_assignment_id;
  end if;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,'internal',case when o.is_active and o.status='active' then 'published' else 'draft' end,p_actor_user_id)
  on conflict(assignment_id,channel) do update
    set status=excluded.status,updated_at=now()
  returning id into v_publication_id;

  -- Reuse an already published internal version (e.g. from
  -- gridex_publish_contract_channel) instead of publishing a second one. The
  -- upsert above holds the publication row lock until commit, so this
  -- read-check-insert is serialized with concurrent ensure and channel-publish
  -- calls; a waiter re-reads the committed published version (READ COMMITTED
  -- takes a fresh snapshot per statement). A mismatch raises and the whole
  -- call, including the upsert, is rolled back.
  if v_status='published' then
    select cpv.* into v_published from public.contract_publication_versions cpv
    where cpv.contract_publication_id=v_publication_id and cpv.status='published'
    order by cpv.version_number desc limit 1;
    if found then
      -- Same offer only: gridex_publish_contract_channel stores the offer as
      -- source_contract_offer_id, this function as legacy_contract_offer_id.
      -- contract_type has no version column; it is compared where the
      -- snapshot carries it (v1) and is otherwise fixed by the same offer id.
      if not (coalesce(v_published.publication_snapshot->>'source_contract_offer_id'=o.id::text,false)
              or coalesce(v_published.publication_snapshot->>'legacy_contract_offer_id'=o.id::text,false))
        or (v_published.publication_snapshot ? 'contract_type'
            and v_published.publication_snapshot->>'contract_type' is distinct from o.contract_type)
        or v_published.contract_product_version_id is distinct from o.contract_product_version_id
        or v_published.price_plan_id is distinct from o.price_plan_id
        or v_published.price_plan_version_id is distinct from o.price_plan_version_id
        or v_published.price_book_id is distinct from o.price_book_id
        or v_published.legal_bundle_version_id is distinct from o.legal_bundle_version_id
        or v_published.customer_type is distinct from coalesce(o.customer_type,'both')
        or v_published.channel is distinct from 'internal'
        or v_published.valid_from is distinct from o.valid_from::timestamptz
        or v_published.valid_to is distinct from o.valid_to::timestamptz then
        raise exception using errcode='P0001',message='internal_publication_republish_required',
          detail='published_version_id='||v_published.id::text;
      end if;
      return v_published.id;
    end if;
  end if;

  v_snapshot:=jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_internal_publication_v1',
    'company_id',p_company_id,
    'legacy_contract_offer_id',o.id,
    'contract_product_version_id',o.contract_product_version_id,
    'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,
    'legal_bundle_version_id',o.legal_bundle_version_id,
    'name',o.name,
    'customer_type',o.customer_type,
    'contract_type',o.contract_type,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  ));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');
  select id into v_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash limit 1;

  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number
    from public.contract_publication_versions where contract_publication_id=v_publication_id;
    v_offer_reference:='internal_'||replace(o.id::text,'-','')||'_v'||v_number::text;
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,price_plan_id,price_plan_version_id,
      price_book_id,legal_bundle_version_id,legacy_public_contract_offer_id,customer_type,channel,
      valid_from,valid_to,publication_snapshot,offer_reference,content_sha256,status,
      published_at,locked_at,created_by
    ) values(
      v_publication_id,v_number,o.contract_product_version_id,o.price_plan_id,o.price_plan_version_id,
      o.price_book_id,o.legal_bundle_version_id,null,coalesce(o.customer_type,'both'),'internal',
      o.valid_from::timestamptz,o.valid_to::timestamptz,v_snapshot,v_offer_reference,v_hash,v_status,
      case when v_status='published' then now() end,case when v_status='published' then now() end,p_actor_user_id
    ) returning id into v_version_id;
  elsif v_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now())
    where id=v_version_id;
  end if;

  return v_version_id;
end $$;

do $postcheck$
declare
  f pg_catalog.pg_proc%rowtype;
begin
  select p.* into f from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)');
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex') <> 'd18ca44d2865bb020f750ad88bc9213b1ff62017f21f42bfdcfe074771357a7d'
    or not f.prosecdef
    or f.proconfig is distinct from array['search_path=public, extensions, pg_temp']
    or coalesce(f.proacl::text, '') is distinct from pg_catalog.current_setting('gridex.internal_publication_reuse_acl', true) then
    raise exception 'internal_publication_reuse_postcheck_failed' using errcode = '55000';
  end if;
end
$postcheck$;

commit;
