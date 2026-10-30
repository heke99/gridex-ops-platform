-- simulation: 20261029-3f1a8ab1/claude-track2/014b
-- Channel publication after an internal contract publication.
--
-- gridex_ensure_internal_contract_publication publishes an internal version
-- (snapshot gridex_internal_publication_v1, key legacy_contract_offer_id) as
-- soon as an internal contract is created. A later
-- gridex_publish_contract_channel(company, offer, 'internal', actor) only
-- looked for its own version via publication_snapshot->>'source_contract_offer_id',
-- found none, inserted a new draft and finalized it to 'published' next to the
-- existing one: 23505 on contract_publication_versions_one_published_per_publication_uid.
-- Old published versions were only ended for OTHER product versions.
--
-- Owner decision (strict, frozen terms):
-- * A published version on the same publication for the same offer
--   (source_contract_offer_id or legacy_contract_offer_id) whose binding
--   business fields are unchanged (contract_product_version_id, price_plan_id,
--   price_plan_version_id, price_book_id, legal_bundle_version_id,
--   customer_type, channel, valid_from, valid_to; same comparison as
--   20261030131300) is reused as a NO-OP: no snapshot/locked-field rewrite and
--   no finalize of that version.
-- * Otherwise (terms differ or another offer) that published version is ended
--   through gridex.version_transition, exactly as publish already ends
--   versions of other product versions, and a new version is created as before.
--   Contracts keep pointing at the ended version; no contract row is touched.
-- * An own non-published version is only re-finalized when no customer
--   contract or contract acceptance points at it (finalize may rewrite its
--   snapshot); otherwise a new version is created.
--
-- The function is patched by exact single-occurrence anchors on the installed
-- definition (as 20261013112427 does), so everything else is byte-identical.
-- Guard: installed prosrc sha256 must be the current main body e06f4b77...
-- (20260731152000 + 20261013112427, also pinned by 20261019180400) or this
-- migration's own result (replay = no-op). SECURITY DEFINER, owner,
-- search_path, signature, return type and ACL are verified unchanged.
begin;

do $channel_publish_reuse$
declare
  f pg_catalog.pg_proc%rowtype;
  v_hash text;
  v_acl text;
  v_owner oid;
  definition text;
  anchors text[];
  patches text[];
  i integer;
  c_old constant text := 'e06f4b770cda17e95553f2297c0db310419022a3e817df01931b6359bfd36c47';
  c_new constant text := '75f75427fb307446b46ab34c8de5dc84f4fa552ba8f50ed8ba780e5d9c8cfb77';
begin
  select p.* into f from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)');
  if not found then
    raise exception 'channel_publish_reuse_function_missing' using errcode = '55000';
  end if;
  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex');
  if v_hash not in (c_old, c_new) then
    raise exception 'channel_publish_reuse_source_changed:%', v_hash using errcode = '55000';
  end if;
  if not f.prosecdef
    or f.proconfig is distinct from array['search_path=public, extensions, pg_temp']
    or f.prorettype <> 'jsonb'::regtype or f.prokind <> 'f' or f.proretset
    or f.prolang <> (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql') then
    raise exception 'channel_publish_reuse_metadata_changed' using errcode = '55000';
  end if;
  v_acl := coalesce(f.proacl::text, '');
  v_owner := f.proowner;

  if v_hash = c_old then
    definition := pg_catalog.pg_get_functiondef(f.oid);
    anchors := array[
$a0$  v_price_areas text[]:='{}'::text[];
begin
$a0$,
$a1$  select id,offer_reference
    into v_publication_version_id,v_offer_reference
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id
    and contract_product_version_id=o.contract_product_version_id
    and channel=v_channel
    and publication_snapshot->>'source_contract_offer_id'=o.id::text
  order by version_number desc
  limit 1
  for update;

  if v_publication_version_id is null then
$a1$,
$a2$  perform public.gridex_finalize_contract_publication_v1(
    v_publication_version_id,p_actor_user_id,true
  );
$a2$,
$a3$    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
$a3$,
$a4$    'ok',true,'changed',true,'mode','published','channel',v_channel,
$a4$,
$a5$    'affected_publication_versions',1,
$a5$];
    patches := array[
$p0$  v_price_areas text[]:='{}'::text[];
  v_published public.contract_publication_versions%rowtype;
  v_reused boolean:=false;
  v_ended_version_id uuid;
begin
$p0$,
$p1$  -- One published version per publication. A published version of this
  -- same offer (channel publish: source_contract_offer_id, internal contract
  -- publication: legacy_contract_offer_id) with unchanged binding terms is
  -- reused unchanged: contracts may already point at it, so its snapshot and
  -- locked fields are never rewritten and it is not finalized again. Any other
  -- published version is ended first; contracts keep pointing at it.
  select cpv.* into v_published
  from public.contract_publication_versions cpv
  where cpv.contract_publication_id=v_publication_id
    and cpv.status='published'
  order by cpv.version_number desc
  limit 1
  for update;
  if found then
    if (coalesce(v_published.publication_snapshot->>'source_contract_offer_id'=o.id::text,false)
        or coalesce(v_published.publication_snapshot->>'legacy_contract_offer_id'=o.id::text,false))
      and not (v_published.publication_snapshot ? 'contract_type'
        and v_published.publication_snapshot->>'contract_type' is distinct from o.contract_type)
      and v_published.contract_product_version_id is not distinct from o.contract_product_version_id
      and v_published.price_plan_id is not distinct from o.price_plan_id
      and v_published.price_plan_version_id is not distinct from o.price_plan_version_id
      and v_published.price_book_id is not distinct from o.price_book_id
      and v_published.legal_bundle_version_id is not distinct from v_legal_version_id
      and v_published.customer_type is not distinct from coalesce(o.customer_type,'both')
      and v_published.channel is not distinct from v_channel
      and v_published.valid_from is not distinct from o.valid_from::timestamptz
      and v_published.valid_to is not distinct from o.valid_to::timestamptz then
      v_reused:=true;
      v_publication_version_id:=v_published.id;
      v_offer_reference:=v_published.offer_reference;
    else
      perform set_config('gridex.version_transition','on',true);
      update public.contract_publication_versions
      set status='ended',valid_to=coalesce(valid_to,now())
      where id=v_published.id;
      v_ended_version_id:=v_published.id;
    end if;
  end if;

  if not v_reused then
    -- An own version is only re-finalized when no contract binds it.
    select cpv.id,cpv.offer_reference
      into v_publication_version_id,v_offer_reference
    from public.contract_publication_versions cpv
    where cpv.contract_publication_id=v_publication_id
      and cpv.contract_product_version_id=o.contract_product_version_id
      and cpv.channel=v_channel
      and cpv.publication_snapshot->>'source_contract_offer_id'=o.id::text
      and cpv.id is distinct from v_ended_version_id
      and not exists(select 1 from public.customer_contracts cc
        where cc.contract_publication_version_id=cpv.id)
      and not exists(select 1 from public.customer_contract_acceptances ca
        where ca.contract_publication_version_id=cpv.id)
    order by cpv.version_number desc
    limit 1
    for update;
  end if;

  if v_reused then
    null;
  elsif v_publication_version_id is null then
$p1$,
$p2$  if not v_reused then
    perform public.gridex_finalize_contract_publication_v1(
      v_publication_version_id,p_actor_user_id,true
    );
  end if;
$p2$,
$p3$    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference,
      'publication_version_reused',v_reused)
$p3$,
$p4$    'ok',true,'changed',true,'mode','published','channel',v_channel,
    'publication_version_reused',v_reused,
$p4$,
$p5$    'affected_publication_versions',case when v_reused then 0 else 1 end,
$p5$];
    for i in 1 .. pg_catalog.array_length(anchors, 1) loop
      if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, anchors[i], '')))
         <> pg_catalog.length(anchors[i]) then
        raise exception 'channel_publish_reuse_anchor_%_changed', i - 1 using errcode = '55000';
      end if;
      definition := pg_catalog.replace(definition, anchors[i], patches[i]);
    end loop;
    execute definition;
  end if;

  select p.* into f from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.gridex_publish_contract_channel(uuid,uuid,text,uuid)');
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex') <> c_new
    or not f.prosecdef
    or f.proowner is distinct from v_owner
    or f.proconfig is distinct from array['search_path=public, extensions, pg_temp']
    or f.prorettype <> 'jsonb'::regtype
    or coalesce(f.proacl::text, '') is distinct from v_acl then
    raise exception 'channel_publish_reuse_postcheck_failed:%',
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc, 'UTF8')), 'hex') using errcode = '55000';
  end if;
end
$channel_publish_reuse$;

notify pgrst, 'reload schema';

commit;
