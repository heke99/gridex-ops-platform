-- Gridex OPS: contract lifecycle unpublish/delete/backfill repair
-- Forward-only production migration. 2026-07-21

begin;
create extension if not exists pgcrypto;

-- Keep immutable commercial/legal content locked even during an approved lifecycle transition.
create or replace function public.gridex_reject_locked_row_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  v_transition boolean:=coalesce(current_setting('gridex.version_transition',true),'')='on';
  v_old jsonb;
  v_new jsonb;
  v_allowed text[];
begin
  if nullif(to_jsonb(old)->>'locked_at','') is null
     and nullif(to_jsonb(old)->>'published_at','') is null then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if not v_transition then
    raise exception using errcode='55000',message='immutable_version_locked';
  end if;

  if tg_op='DELETE' then
    return old;
  end if;

  v_allowed:=case tg_table_name
    when 'contract_product_versions' then array['status','approved_at','approved_by','locked_at']
    when 'legal_template_versions' then array['status','reviewed_by','reviewed_at','published_at','locked_at']
    when 'legal_bundle_versions' then array['status','published_at','locked_at']
    when 'contract_publication_versions' then array['status','valid_from','valid_to','published_at','locked_at','legacy_public_contract_offer_id']
    when 'tenant_legal_overrides' then array['status','submitted_at','reviewed_at','reviewed_by','review_notes','locked_at']
    else array[]::text[]
  end;

  v_old:=to_jsonb(old)-v_allowed;
  v_new:=to_jsonb(new)-v_allowed;
  if v_old is distinct from v_new then
    raise exception using errcode='55000',message='immutable_version_content_changed';
  end if;
  return new;
end $$;

create or replace function public.gridex_sync_internal_offer_to_canonical(p_offer_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_product_id uuid;
  v_version_id uuid;
  v_assignment_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_number integer;
  v_required text[];
  v_legal_version_id uuid;
  v_production_enabled boolean:=false;
  v_sellable boolean:=false;
  v_product_status text;
  v_internal_allowed boolean:=true;
begin
  select * into o from public.contract_offers where id=p_offer_id for update;
  if not found or o.company_id is null then return null; end if;

  v_product_id:=o.contract_product_id;
  if v_product_id is null and o.supersedes_offer_id is not null then
    select contract_product_id into v_product_id
    from public.contract_offers where id=o.supersedes_offer_id;
  end if;
  if v_product_id is null then
    select id into v_product_id
    from public.contract_products
    where company_id=o.company_id and product_code='contract:'||o.version_series_id::text
    limit 1;
  end if;

  v_product_status:=case
    when o.lifecycle_status='published' then 'active'
    when o.lifecycle_status='archived' then 'archived'
    when exists(
      select 1 from public.contract_offers sibling
      where sibling.company_id=o.company_id
        and sibling.version_series_id=o.version_series_id
        and sibling.id<>o.id
        and sibling.lifecycle_status='published'
        and sibling.is_active
    ) then 'active'
    when o.lifecycle_status in ('draft','ready') then 'draft'
    else 'paused'
  end;

  if v_product_id is null then
    insert into public.contract_products(
      company_id,product_code,name,product_category,description,status,created_by
    ) values(
      o.company_id,'contract:'||o.version_series_id::text,o.name,'electricity',o.description,v_product_status,o.created_by
    ) returning id into v_product_id;
  else
    update public.contract_products
    set name=case when o.lifecycle_status='published'
                    or not exists(
                      select 1 from public.contract_offers sibling
                      where sibling.company_id=o.company_id
                        and sibling.version_series_id=o.version_series_id
                        and sibling.id<>o.id
                        and sibling.lifecycle_status='published'
                        and sibling.is_active
                    ) then o.name else name end,
        description=case when o.lifecycle_status='published'
                    or not exists(
                      select 1 from public.contract_offers sibling
                      where sibling.company_id=o.company_id
                        and sibling.version_series_id=o.version_series_id
                        and sibling.id<>o.id
                        and sibling.lifecycle_status='published'
                        and sibling.is_active
                    ) then o.description else description end,
        status=v_product_status,
        updated_at=now()
    where id=v_product_id and company_id=o.company_id;
  end if;

  v_production_enabled:=coalesce((o.commercial_snapshot#>>'{production,enabled}')::boolean,false);
  v_required:=public.gridex_required_legal_modules(
    o.customer_type,o.contract_type,'internal',coalesce(o.automatic_renewal,false),
    coalesce(o.power_of_attorney_required,true),v_production_enabled
  );

  -- Lifecycle/publication state is intentionally excluded from the immutable
  -- commercial hash. Publishing an unchanged draft must lock the same version,
  -- not create a second price/product version only because status changed.
  v_snapshot:=(coalesce(o.commercial_snapshot,'{}'::jsonb)-'lifecycle_status')||jsonb_strip_nulls(jsonb_build_object(
    'schema','gridex_contract_product_version_v5',
    'version_series_id',o.version_series_id,
    'legacy_contract_offer_id',o.id,
    'supersedes_offer_id',o.supersedes_offer_id,
    'company_id',o.company_id,
    'name',o.name,
    'customer_type',o.customer_type,
    'contract_type',o.contract_type,
    'price_plan_id',o.price_plan_id,
    'price_plan_version_id',o.price_plan_version_id,
    'price_book_id',o.price_book_id,
    'price_version',o.price_version,
    'terms_version',o.terms_version,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to,
    'max_customers',o.max_customers,
    'discount_value',o.discount_value,
    'discount_unit',o.discount_unit,
    'discount_months',o.discount_months,
    'discount_calculation_base',o.discount_calculation_base,
    'discount_starts_on_mode',o.discount_starts_on_mode,
    'automatic_renewal',o.automatic_renewal,
    'automatic_renewal_term_months',o.automatic_renewal_term_months,
    'power_of_attorney_required',o.power_of_attorney_required,
    'power_of_attorney_mode',o.power_of_attorney_mode,
    'optional_fees',coalesce(o.optional_fee_lines,'[]'::jsonb),
    'required_legal_modules',v_required,
    'legal_source','legal_template_versions'
  ));
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_version_id
  from public.contract_product_versions
  where contract_product_id=v_product_id and content_sha256=v_hash
  limit 1;

  if v_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number
    from public.contract_product_versions where contract_product_id=v_product_id;

    insert into public.contract_product_versions(
      contract_product_id,version_number,customer_type,contract_type,pricing_model,
      price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,
      automatic_renewal,power_of_attorney_required,required_legal_modules,
      commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by
    ) values(
      v_product_id,v_number,o.customer_type,o.contract_type,
      coalesce(v_snapshot->>'pricing_model',o.contract_type),o.price_plan_id,o.price_plan_version_id,
      o.default_binding_months,o.default_notice_months,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
      coalesce(o.automatic_renewal,false),coalesce(o.power_of_attorney_required,true),v_required,
      v_snapshot,v_hash,
      case when o.lifecycle_status='published' then 'approved' else 'draft' end,
      case when o.lifecycle_status='published' then now() end,
      case when o.lifecycle_status='published' then o.updated_by end,
      case when o.lifecycle_status='published' then now() end,
      o.created_by
    ) returning id into v_version_id;
  elsif o.lifecycle_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions
    set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,o.updated_by),locked_at=coalesce(locked_at,now())
    where id=v_version_id and (status<>'approved' or locked_at is null);
  end if;

  v_sellable:=o.lifecycle_status='published'
    and (o.valid_from is null or o.valid_from<=current_date)
    and (o.valid_to is null or o.valid_to>=current_date);

  if o.lifecycle_status='published' then
    -- Internal publication moves only the internal sales channel. Website/API
    -- channels on the predecessor remain live until that exact channel is
    -- explicitly published for the successor, preventing a sales outage.
    update public.tenant_contract_channels ch
    set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
    from public.tenant_contract_assignments ta
    join public.contract_product_versions oldv on oldv.id=ta.contract_product_version_id
    where ch.assignment_id=ta.id and ta.company_id=o.company_id
      and oldv.contract_product_id=v_product_id
      and ta.contract_product_version_id<>v_version_id
      and ch.channel='internal'
      and ch.status in ('active','paused');

    update public.tenant_contract_assignments ta
    set internal_sales_allowed=false,
        status=case when exists(
          select 1 from public.tenant_contract_channels remaining
          where remaining.assignment_id=ta.id and remaining.status='active'
            and (remaining.valid_from is null or remaining.valid_from<=now())
            and (remaining.valid_to is null or remaining.valid_to>=now())
        ) then 'active' else 'ended' end,
        valid_to=case when exists(
          select 1 from public.tenant_contract_channels remaining
          where remaining.assignment_id=ta.id and remaining.status='active'
            and (remaining.valid_from is null or remaining.valid_from<=now())
            and (remaining.valid_to is null or remaining.valid_to>=now())
        ) then ta.valid_to else coalesce(ta.valid_to,current_date) end,
        updated_at=now()
    from public.contract_product_versions oldv
    where oldv.id=ta.contract_product_version_id and ta.company_id=o.company_id
      and oldv.contract_product_id=v_product_id
      and ta.contract_product_version_id<>v_version_id;

    v_legal_version_id:=public.gridex_materialize_legal_bundle_version(
      o.company_id,v_version_id,null,o.updated_by
    );
    if exists(
      select 1 from public.legal_bundle_versions
      where id=v_legal_version_id and cardinality(unresolved_variables)>0
    ) then
      raise exception using errcode='23514',message='internal_offer_legal_documents_not_ready';
    end if;
    perform set_config('gridex.version_transition','on',true);
    update public.legal_bundle_versions
    set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now())
    where id=v_legal_version_id and locked_at is null;
  else
    v_legal_version_id:=o.legal_bundle_version_id;
  end if;

  insert into public.tenant_contract_assignments(
    company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,
    status,legal_mode,valid_from,valid_to,assigned_by
  ) values(
    o.company_id,v_version_id,true,false,
    case when v_sellable then 'active' else 'paused' end,
    coalesce((select legal_mode from public.legal_bundle_versions where id=v_legal_version_id),'ops_standard'),
    o.valid_from,o.valid_to,o.updated_by
  )
  on conflict(company_id,contract_product_version_id) do update set
    -- Preserve explicit channel grants/denials. Canonical synchronization may
    -- repair lifecycle metadata but must never silently re-grant a channel.
    internal_sales_allowed=tenant_contract_assignments.internal_sales_allowed,
    website_publication_allowed=tenant_contract_assignments.website_publication_allowed,
    status=excluded.status,
    legal_mode=excluded.legal_mode,
    valid_from=excluded.valid_from,
    valid_to=excluded.valid_to,
    updated_at=now()
  returning id,internal_sales_allowed into v_assignment_id,v_internal_allowed;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,'internal',case when v_sellable and v_internal_allowed then 'active' else 'paused' end,
    o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object(
      'name',o.name,'version_series_id',o.version_series_id,
      'source_of_truth','contract_product_versions'
    ),o.updated_by
  )
  on conflict(assignment_id,channel) do update set
    status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  update public.contract_offers
  set contract_product_id=v_product_id,
      contract_product_version_id=v_version_id,
      legal_bundle_version_id=v_legal_version_id,
      legal_bundle_id=null,
      updated_at=now()
  where id=o.id;

  return v_version_id;
end $$;;

create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_readiness jsonb;
  v_assignment_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_legal_version_id uuid;
  v_public_offer_id uuid;
  v_snapshot jsonb;
  v_hash text;
  v_offer_reference text;
  v_version integer;
  v_channel text;
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  if o.lifecycle_status not in ('published','paused') then
    raise exception using errcode='23514',message='contract_version_not_published';
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    raise exception using errcode='23514',message='contract_version_not_locked';
  end if;

  v_readiness:=public.gridex_validate_contract_readiness(p_company_id,p_offer_id);
  if not coalesce((v_readiness->>'can_publish')::boolean,false) then
    raise exception using errcode='23514',message='contract_not_ready:'||v_readiness::text;
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(valid_to,now()),updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_channel.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_channel.channel=v_channel
    and old_channel.status in ('active','paused');

  -- Locked publication versions may only move through an explicit lifecycle transition.
  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions old_publication_version
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications old_publication
  join public.tenant_contract_assignments old_assignment on old_assignment.id=old_publication.assignment_id
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication_version.contract_publication_id=old_publication.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication_version.status='published';

  update public.contract_publications old_publication
  set status='ended',updated_at=now()
  from public.tenant_contract_assignments old_assignment
  join public.contract_product_versions old_version on old_version.id=old_assignment.contract_product_version_id
  where old_publication.assignment_id=old_assignment.id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id
    and old_publication.channel=v_channel
    and old_publication.status not in ('ended','archived');

  update public.tenant_contract_assignments old_assignment
  set status=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then 'active' else 'ended' end,
      valid_to=case when exists(
        select 1 from public.tenant_contract_channels remaining
        where remaining.assignment_id=old_assignment.id and remaining.status='active'
          and (remaining.valid_from is null or remaining.valid_from<=now())
          and (remaining.valid_to is null or remaining.valid_to>=now())
      ) then old_assignment.valid_to else coalesce(old_assignment.valid_to,current_date) end,
      updated_at=now()
  from public.contract_product_versions old_version
  where old_version.id=old_assignment.contract_product_version_id
    and old_assignment.company_id=p_company_id
    and old_version.contract_product_id=o.contract_product_id
    and old_assignment.contract_product_version_id<>o.contract_product_version_id;

  update public.contract_offers old_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'superseded' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      superseded_at=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=old_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then old_offer.superseded_at else coalesce(old_offer.superseded_at,now()) end,
      updated_by=p_actor_user_id,updated_at=now()
  where old_offer.company_id=p_company_id
    and old_offer.contract_product_id=o.contract_product_id
    and old_offer.id<>o.id
    and old_offer.lifecycle_status not in ('archived','expired');

  update public.contract_offers
  set lifecycle_status='published',status='active',is_active=true,
      superseded_at=null,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id;
  update public.contract_products set status='active',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  select id into v_assignment_id
  from public.tenant_contract_assignments
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
  for update;

  update public.tenant_contract_assignments
  set website_publication_allowed=website_publication_allowed or v_channel='website',
      internal_sales_allowed=internal_sales_allowed or v_channel='internal',
      status='active',valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
  where id=v_assignment_id;

  insert into public.tenant_contract_channels(
    assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by
  ) values(
    v_assignment_id,v_channel,'active',o.valid_from::timestamptz,o.valid_to::timestamptz,
    jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions'),
    p_actor_user_id
  ) on conflict(assignment_id,channel) do update set
    status='active',valid_from=excluded.valid_from,valid_to=excluded.valid_to,
    marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  select legal_bundle_version_id into v_legal_version_id
  from public.contract_offers where id=o.id;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,v_channel,'published',p_actor_user_id)
  on conflict(assignment_id,channel) do update set status='published',updated_at=now()
  returning id into v_publication_id;

  select coalesce(max(version_number),0)+1 into v_version
  from public.contract_publication_versions where contract_publication_id=v_publication_id;
  v_offer_reference:='GRIDEX-'||replace(o.version_series_id::text,'-','')||'-V'||o.version_number||'-'||upper(v_channel);
  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_publication_v5',
    'company_id',p_company_id,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'source_contract_offer_id',o.id,
    'channel',v_channel,
    'offer_reference',v_offer_reference,
    'commercial_snapshot',o.commercial_snapshot,
    'legal_bundle_version_id',v_legal_version_id,
    'valid_from',o.valid_from,
    'valid_to',o.valid_to
  );
  v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

  select id into v_publication_version_id
  from public.contract_publication_versions
  where contract_publication_id=v_publication_id and content_sha256=v_hash;
  if v_publication_version_id is null then
    insert into public.contract_publication_versions(
      contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
      customer_type,channel,valid_from,valid_to,publication_snapshot,offer_reference,
      content_sha256,status,published_at,locked_at,created_by
    ) values(
      v_publication_id,v_version,o.contract_product_version_id,
      o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,
      o.customer_type,v_channel,o.valid_from::timestamptz,o.valid_to::timestamptz,
      v_snapshot,v_offer_reference,v_hash,'published',now(),now(),p_actor_user_id
    ) returning id into v_publication_version_id;
  else
    -- Content is immutable, but a previously ended channel may be re-enabled.
    -- Reactivate the same locked publication identity instead of attempting a
    -- duplicate row with the same content hash/offer reference.
    perform set_config('gridex.version_transition','on',true);
    update public.contract_publication_versions
    set status='published',valid_from=o.valid_from::timestamptz,
        valid_to=o.valid_to::timestamptz,published_at=coalesce(published_at,now()),
        locked_at=coalesce(locked_at,now())
    where id=v_publication_version_id;
  end if;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);

    -- Only one website offer in a product series may be public. Older public
    -- compatibility rows remain for historic references but are immediately
    -- removed from all public/CTA surfaces.
    update public.public_contract_offers old_public
    set lifecycle_status='superseded',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where old_public.company_id=p_company_id
      and old_public.contract_product_id=o.contract_product_id
      and old_public.source_contract_offer_id is distinct from o.id
      and (old_public.is_public or old_public.website_enabled or old_public.website_cta_enabled
           or old_public.publication_status='published');

    select id into v_public_offer_id
    from public.public_contract_offers
    where company_id=p_company_id and source_contract_offer_id=o.id
    order by created_at desc limit 1 for update;

    if v_public_offer_id is null then
      insert into public.public_contract_offers(
        company_id,source_contract_offer_id,version_series_id,version_number,
        contract_product_id,contract_product_version_id,contract_publication_version_id,
        legal_bundle_version_id,price_plan_id,price_plan_version_id,price_book_id,
        product_code,offer_code,public_name,public_description,contract_type,billing_model,
        customer_type,monthly_fee_sek,invoice_fee_sek,spot_markup_ore_per_kwh,
        variable_fee_ore_per_kwh,fixed_price_ore_per_kwh,green_fee_mode,green_fee_value,
        start_fee_sek,administration_fee_sek,break_fee_sek,discount_value,discount_unit,
        discount_months,vat_rate,terms_version,binding_months,notice_months,
        spot_weight_percent,portfolio_weight_percent,fixed_weight_percent,price_areas,
        automatic_renewal,power_of_attorney_required,valid_from,valid_to,
        is_public,is_archived,publication_status,lifecycle_status,website_enabled,
        website_cta_enabled,published_at,metadata,created_by,updated_by
      ) values(
        p_company_id,o.id,o.version_series_id,o.version_number,
        o.contract_product_id,o.contract_product_version_id,v_publication_version_id,
        v_legal_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,
        'electricity','contract-'||o.version_series_id::text,o.name,o.description,o.contract_type,
        coalesce(o.commercial_snapshot->>'pricing_model',o.contract_type),o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        coalesce((o.commercial_snapshot->>'spot_weight_percent')::numeric,100),
        coalesce((o.commercial_snapshot->>'portfolio_weight_percent')::numeric,0),
        coalesce((o.commercial_snapshot->>'fixed_weight_percent')::numeric,0),
        coalesce(array(select jsonb_array_elements_text(coalesce(o.commercial_snapshot->'price_areas','[]'::jsonb))),'{}'::text[]),
        o.automatic_renewal,o.power_of_attorney_required,o.valid_from,o.valid_to,
        true,false,'published','published',true,true,now(),
        jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        p_actor_user_id,p_actor_user_id
      ) returning id into v_public_offer_id;
    else
      update public.public_contract_offers set
        contract_product_id=o.contract_product_id,
        contract_product_version_id=o.contract_product_version_id,
        contract_publication_version_id=v_publication_version_id,
        legal_bundle_version_id=v_legal_version_id,
        price_plan_id=o.price_plan_id,price_plan_version_id=o.price_plan_version_id,price_book_id=o.price_book_id,
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,automatic_renewal=o.automatic_renewal,
        power_of_attorney_required=o.power_of_attorney_required,valid_from=o.valid_from,valid_to=o.valid_to,
        is_public=true,is_archived=false,publication_status='published',lifecycle_status='published',
        website_enabled=true,website_cta_enabled=true,published_at=coalesce(published_at,now()),archived_at=null,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('source_of_truth','contract_product_versions','offer_reference',v_offer_reference),
        updated_by=p_actor_user_id,updated_at=now()
      where id=v_public_offer_id;
    end if;
    update public.contract_publication_versions
    set legacy_public_contract_offer_id=v_public_offer_id
    where id=v_publication_version_id and legacy_public_contract_offer_id is null;
  end if;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(
    p_company_id,p_actor_user_id,'contract_publication_version',v_publication_version_id::text,
    'contract.channel.published',null,v_snapshot,
    jsonb_build_object('offer_id',o.id,'channel',v_channel,'offer_reference',v_offer_reference)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'mode','published','channel',v_channel,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id,
    'contract_publication_version_id',v_publication_version_id,
    'public_contract_offer_id',v_public_offer_id,
    'offer_reference',v_offer_reference,
    'affected_channels',1,
    'affected_publication_versions',1,
    'affected_public_offers',case when v_channel='website' then 1 else 0 end
  );
end $$;;

-- Shared business-usage classifier. System-generated canonical versions are
-- intentionally excluded; only customer/legal/billing activity blocks deletion.
create or replace function public.gridex_contract_business_usage_counts(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_customer_contracts bigint:=0;
  v_applications bigint:=0;
  v_external_intakes bigint:=0;
  v_snapshots bigint:=0;
  v_invoices bigint:=0;
  v_billing_underlays bigint:=0;
  v_billing_underlay_items bigint:=0;
  v_charge_ledger bigint:=0;
  v_acceptances bigint:=0;
begin
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('ok',false,'code','contract_offer_not_found');
  end if;

  select count(*) into v_customer_contracts
  from public.customer_contracts c
  where c.company_id=p_company_id and (
    c.contract_offer_id=o.id
    or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
    or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
        and c.contract_offer_id is null and c.contract_product_version_id is null)
  );

  select count(*) into v_applications
  from public.website_customer_applications a
  where a.company_id=p_company_id
    and coalesce(a.status,'application_received') not in ('cancelled','failed','rejected')
    and exists(
      select 1 from public.public_contract_offers po
      where po.id=a.public_contract_offer_id and (
        po.source_contract_offer_id=o.id
        or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
            and po.source_contract_offer_id is null and po.contract_product_version_id is null)
      )
    );

  select count(*) into v_external_intakes
  from public.external_contract_intakes x
  where x.company_id=p_company_id
    and coalesce(x.status,'received') not in ('cancelled','failed','duplicate')
    and (
      x.contract_offer_id=o.id
      or exists(
        select 1 from public.public_contract_offers po
        where po.id=x.public_contract_offer_id and (
          po.source_contract_offer_id=o.id
          or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
          or (o.contract_product_id is not null and po.contract_product_id=o.contract_product_id
              and po.source_contract_offer_id is null and po.contract_product_version_id is null)
        )
      )
    );

  -- Preview-only public price snapshots are technical data. A snapshot blocks
  -- deletion only when it belongs to a real customer contract for this offer.
  select count(*) into v_snapshots
  from public.contract_price_snapshots s
  where s.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=s.contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_invoices
  from public.customer_invoices i
  where i.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=coalesce(i.customer_contract_id,i.contract_id)
      and c.company_id=p_company_id and (
        c.contract_offer_id=o.id
        or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
        or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
            and c.contract_offer_id is null and c.contract_product_version_id is null)
      )
  );

  select count(*) into v_billing_underlays
  from public.billing_underlays b
  where b.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=b.contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_billing_underlay_items
  from public.billing_underlay_items bi
  join public.billing_underlays b on b.id=bi.billing_underlay_id and b.company_id=bi.company_id
  where bi.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=b.contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_charge_ledger
  from public.contract_charge_ledger l
  where l.company_id=p_company_id and exists(
    select 1 from public.customer_contracts c
    where c.id=l.customer_contract_id and c.company_id=p_company_id and (
      c.contract_offer_id=o.id
      or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
      or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
          and c.contract_offer_id is null and c.contract_product_version_id is null)
    )
  );

  select count(*) into v_acceptances
  from public.customer_contract_acceptances a
  join public.customer_contracts c on c.id=a.customer_contract_id and c.company_id=a.company_id
  where a.company_id=p_company_id and (
    c.contract_offer_id=o.id
    or (o.contract_product_version_id is not null and c.contract_product_version_id=o.contract_product_version_id)
    or (o.contract_product_id is not null and c.contract_product_id=o.contract_product_id
        and c.contract_offer_id is null and c.contract_product_version_id is null)
  );

  return jsonb_build_object(
    'ok',true,
    'customer_contracts',v_customer_contracts,
    'customer_applications',v_applications,
    'external_intakes',v_external_intakes,
    'binding_price_snapshots',v_snapshots,
    'invoices',v_invoices,
    'billing_underlays',v_billing_underlays,
    'billing_underlay_items',v_billing_underlay_items,
    'charge_ledger',v_charge_ledger,
    'legal_acceptances',v_acceptances,
    'total',v_customer_contracts+v_applications+v_external_intakes+v_snapshots+
      v_invoices+v_billing_underlays+v_billing_underlay_items+v_charge_ledger+v_acceptances
  );
end $$;

create or replace function public.gridex_contract_system_dependency_counts(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_offer_versions bigint:=0;
  v_successors bigint:=0;
  v_public_offers bigint:=0;
  v_product_versions bigint:=0;
  v_assignments bigint:=0;
  v_channels bigint:=0;
  v_active_channels bigint:=0;
  v_publications bigint:=0;
  v_publication_versions bigint:=0;
  v_legal_versions bigint:=0;
  v_shared_product_version bigint:=0;
  v_shared_legal_version bigint:=0;
begin
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('ok',false,'code','contract_offer_not_found');
  end if;

  select count(*) into v_offer_versions from public.contract_offer_versions
  where company_id=p_company_id and contract_offer_id=o.id;
  select count(*) into v_successors from public.contract_offers
  where company_id=p_company_id and supersedes_offer_id=o.id;
  select count(*) into v_public_offers from public.public_contract_offers po
  where po.company_id=p_company_id and (
    po.source_contract_offer_id=o.id
    or (o.contract_product_version_id is not null and po.contract_product_version_id=o.contract_product_version_id)
  );
  select count(*) into v_product_versions from public.contract_product_versions
  where o.contract_product_version_id is not null and id=o.contract_product_version_id;
  select count(*) into v_assignments from public.tenant_contract_assignments
  where company_id=p_company_id and o.contract_product_version_id is not null
    and contract_product_version_id=o.contract_product_version_id;
  select count(*),count(*) filter(where ch.status='active') into v_channels,v_active_channels
  from public.tenant_contract_channels ch
  join public.tenant_contract_assignments ta on ta.id=ch.assignment_id
  where ta.company_id=p_company_id and o.contract_product_version_id is not null
    and ta.contract_product_version_id=o.contract_product_version_id;
  select count(*) into v_publications
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  where ta.company_id=p_company_id and o.contract_product_version_id is not null
    and ta.contract_product_version_id=o.contract_product_version_id;
  select count(*) into v_publication_versions
  from public.contract_publication_versions pv
  join public.contract_publications p on p.id=pv.contract_publication_id
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  where ta.company_id=p_company_id and o.contract_product_version_id is not null
    and ta.contract_product_version_id=o.contract_product_version_id;
  select count(*) into v_legal_versions from public.legal_bundle_versions
  where company_id=p_company_id and o.contract_product_version_id is not null
    and contract_product_version_id=o.contract_product_version_id;
  select count(*) into v_shared_product_version from public.contract_offers other_offer
  where other_offer.company_id=p_company_id and other_offer.id<>o.id
    and o.contract_product_version_id is not null
    and other_offer.contract_product_version_id=o.contract_product_version_id;
  select count(*) into v_shared_legal_version from public.contract_offers other_offer
  where other_offer.company_id=p_company_id and other_offer.id<>o.id
    and o.legal_bundle_version_id is not null
    and other_offer.legal_bundle_version_id=o.legal_bundle_version_id;

  return jsonb_build_object(
    'ok',true,
    'offer_versions',v_offer_versions,
    'successor_offers',v_successors,
    'public_offers',v_public_offers,
    'product_versions',v_product_versions,
    'tenant_assignments',v_assignments,
    'channel_rows',v_channels,
    'active_channels',v_active_channels,
    'publications',v_publications,
    'publication_versions',v_publication_versions,
    'legal_bundle_versions',v_legal_versions,
    'shared_product_version_references',v_shared_product_version,
    'shared_legal_version_references',v_shared_legal_version
  );
end $$;

create or replace function public.gridex_preview_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_business jsonb;
  v_system jsonb;
  v_reason_codes text[]:='{}'::text[];
  v_business_total bigint:=0;
  v_unsafe_total bigint:=0;
  v_can_delete boolean:=false;
  v_mapping_complete boolean:=false;
  v_requires_unpublish boolean:=false;
begin
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id;
  if not found then
    return jsonb_build_object('ok',false,'code','contract_offer_not_found','can_delete',false,'deletable',false);
  end if;

  v_business:=public.gridex_contract_business_usage_counts(p_company_id,p_offer_id);
  v_system:=public.gridex_contract_system_dependency_counts(p_company_id,p_offer_id);
  v_business_total:=coalesce((v_business->>'total')::bigint,0);
  v_unsafe_total:=coalesce((v_system->>'successor_offers')::bigint,0)
    +coalesce((v_system->>'shared_product_version_references')::bigint,0)
    +coalesce((v_system->>'shared_legal_version_references')::bigint,0);
  v_mapping_complete:=o.contract_product_id is not null and o.contract_product_version_id is not null;
  v_requires_unpublish:=coalesce((v_system->>'active_channels')::bigint,0)>0;

  if coalesce((v_business->>'customer_contracts')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CUSTOMER_CONTRACTS'); end if;
  if coalesce((v_business->>'customer_applications')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_ACCEPTED_APPLICATIONS'); end if;
  if coalesce((v_business->>'external_intakes')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_EXTERNAL_INTAKES'); end if;
  if coalesce((v_business->>'binding_price_snapshots')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BINDING_PRICE_SNAPSHOTS'); end if;
  if coalesce((v_business->>'invoices')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_INVOICES'); end if;
  if coalesce((v_business->>'billing_underlays')::bigint,0)>0 or coalesce((v_business->>'billing_underlay_items')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_BILLING_HISTORY'); end if;
  if coalesce((v_business->>'charge_ledger')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_CHARGE_LEDGER'); end if;
  if coalesce((v_business->>'legal_acceptances')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_LEGAL_ACCEPTANCES'); end if;
  if coalesce((v_system->>'successor_offers')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SUCCESSOR_VERSION'); end if;
  if coalesce((v_system->>'shared_product_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_CANONICAL_VERSION'); end if;
  if coalesce((v_system->>'shared_legal_version_references')::bigint,0)>0 then v_reason_codes:=array_append(v_reason_codes,'HAS_SHARED_LEGAL_VERSION'); end if;
  if not v_mapping_complete then v_reason_codes:=array_append(v_reason_codes,'INCOMPLETE_CANONICAL_MAPPING'); end if;

  v_can_delete:=v_business_total=0 and v_unsafe_total=0 and v_mapping_complete;

  return jsonb_build_object(
    'ok',true,
    'can_delete',v_can_delete,
    'deletable',v_can_delete,
    'has_business_usage',v_business_total>0,
    'requires_archive',v_business_total>0,
    'requires_unpublish',v_requires_unpublish,
    'result_mode',case when v_can_delete then 'delete' else 'archive_only' end,
    'business_blockers',v_business-'ok'-'total',
    'business_references',v_business-'ok'-'total',
    'removable_system_dependencies',v_system-'ok'-'successor_offers'-'shared_product_version_references'-'shared_legal_version_references',
    'system_references',v_system-'ok',
    'shared_or_unsafe_dependencies',jsonb_build_object(
      'successor_offers',coalesce((v_system->>'successor_offers')::bigint,0),
      'shared_product_version_references',coalesce((v_system->>'shared_product_version_references')::bigint,0),
      'shared_legal_version_references',coalesce((v_system->>'shared_legal_version_references')::bigint,0),
      'canonical_mapping_complete',v_mapping_complete
    ),
    'reason_codes',to_jsonb(v_reason_codes),
    'lifecycle_status',o.lifecycle_status,
    'contract_product_id',o.contract_product_id,
    'contract_product_version_id',o.contract_product_version_id
  );
end $$;

create or replace function public.gridex_unpublish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_channel text:=lower(coalesce(p_channel,''));
  v_assignment_id uuid;
  v_channel_id uuid;
  v_channel_status text;
  v_active_publication_versions bigint:=0;
  v_active_public_offers bigint:=0;
  v_affected_channels bigint:=0;
  v_affected_publications bigint:=0;
  v_affected_versions bigint:=0;
  v_affected_public_offers bigint:=0;
begin
  if v_channel not in ('internal','website','api','partner','phone') then
    raise exception using errcode='22023',message='invalid_contract_channel';
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.pause');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;

  if o.contract_product_id is null or o.contract_product_version_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id for update;
  end if;
  if o.contract_product_version_id is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_backfill_incomplete','offer_id',o.id,'channel',v_channel);
  end if;

  select ta.id,ch.id,ch.status into v_assignment_id,v_channel_id,v_channel_status
  from public.tenant_contract_assignments ta
  join public.tenant_contract_channels ch on ch.assignment_id=ta.id and ch.channel=v_channel
  where ta.company_id=p_company_id and ta.contract_product_version_id=o.contract_product_version_id
  for update of ta,ch;

  if v_channel_id is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_channel_not_found','offer_id',o.id,'channel',v_channel);
  end if;

  select count(*) into v_active_publication_versions
  from public.contract_publication_versions pv
  join public.contract_publications p on p.id=pv.contract_publication_id
  where p.assignment_id=v_assignment_id and p.channel=v_channel and pv.status='published';

  if v_channel='website' then
    select count(*) into v_active_public_offers
    from public.public_contract_offers po
    where po.company_id=p_company_id and po.source_contract_offer_id=o.id
      and (po.is_public or po.website_enabled or po.website_cta_enabled or po.publication_status='published');
  end if;

  if v_channel_status<>'active' and v_active_publication_versions=0 and v_active_public_offers=0 then
    return jsonb_build_object(
      'ok',true,'changed',false,'already_unpublished',true,'mode','unpublished',
      'offer_id',o.id,'channel',v_channel,'resulting_status',v_channel_status,
      'affected_channels',0,'affected_publication_versions',0,'affected_public_offers',0
    );
  end if;

  if v_channel<>'internal' and v_channel_status='active'
     and v_active_publication_versions=0 then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','active_publication_version_not_found',
      'offer_id',o.id,'channel',v_channel
    );
  end if;

  update public.tenant_contract_channels
  set status='paused',updated_by=p_actor_user_id,updated_at=now()
  where id=v_channel_id and status='active';
  get diagnostics v_affected_channels=row_count;

  update public.contract_publications
  set status='paused',updated_at=now()
  where assignment_id=v_assignment_id and channel=v_channel and status='published';
  get diagnostics v_affected_publications=row_count;

  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions pv
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  where pv.contract_publication_id=p.id
    and p.assignment_id=v_assignment_id and p.channel=v_channel
    and pv.status='published';
  get diagnostics v_affected_versions=row_count;

  if v_channel='website' then
    perform set_config('gridex.public_offer_write','on',true);
    update public.public_contract_offers
    set lifecycle_status='paused',publication_status='unpublished',
        is_public=false,website_enabled=false,website_cta_enabled=false,
        updated_by=p_actor_user_id,updated_at=now()
    where company_id=p_company_id and source_contract_offer_id=o.id
      and (is_public or website_enabled or website_cta_enabled or publication_status='published');
    get diagnostics v_affected_public_offers=row_count;
  end if;

  -- Channel permission is deliberately preserved. Only runtime status changes.
  update public.tenant_contract_assignments ta
  set status=case when exists(
        select 1 from public.tenant_contract_channels active_channel
        where active_channel.assignment_id=ta.id and active_channel.status='active'
          and (active_channel.valid_from is null or active_channel.valid_from<=now())
          and (active_channel.valid_to is null or active_channel.valid_to>=now())
      ) then 'active' else 'paused' end,
      updated_at=now()
  where ta.id=v_assignment_id;

  update public.contract_offers source_offer
  set lifecycle_status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
          and (ch.valid_from is null or ch.valid_from<=now())
          and (ch.valid_to is null or ch.valid_to>=now())
      ) then 'published' else 'paused' end,
      status=case when exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'inactive' end,
      is_active=exists(
        select 1 from public.tenant_contract_assignments ta
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where ta.company_id=p_company_id
          and ta.contract_product_version_id=source_offer.contract_product_version_id
          and ta.status='active' and ch.status='active'
      ),
      updated_by=p_actor_user_id,updated_at=now()
  where source_offer.id=o.id;

  update public.contract_products product
  set status=case when exists(
        select 1 from public.contract_product_versions pv
        join public.tenant_contract_assignments ta on ta.contract_product_version_id=pv.id
        join public.tenant_contract_channels ch on ch.assignment_id=ta.id
        where pv.contract_product_id=product.id and ta.company_id=p_company_id
          and ta.status='active' and ch.status='active'
      ) then 'active' else 'paused' end,
      updated_at=now()
  where product.id=o.contract_product_id and product.company_id=p_company_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product_version',o.contract_product_version_id::text,
    'contract.channel.unpublished',null,null,
    jsonb_build_object(
      'offer_id',o.id,'channel',v_channel,'affected_channels',v_affected_channels,
      'affected_publications',v_affected_publications,'affected_publication_versions',v_affected_versions,
      'affected_public_offers',v_affected_public_offers,'channel_permission_preserved',true
    ));

  return jsonb_build_object(
    'ok',true,'changed',(v_affected_channels+v_affected_publications+v_affected_versions+v_affected_public_offers)>0,
    'mode','unpublished','offer_id',o.id,'channel',v_channel,'resulting_status','paused',
    'affected_channels',v_affected_channels,
    'affected_publications',v_affected_publications,
    'affected_publication_versions',v_affected_versions,
    'affected_public_offers',v_affected_public_offers
  );
end $$;

create or replace function public.gridex_pause_contract_channels(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_public_offers bigint:=0;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.pause');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  if o.contract_product_version_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id for update;
  end if;
  if o.contract_product_version_id is null then
    return jsonb_build_object('ok',false,'changed',false,'code','contract_backfill_incomplete');
  end if;

  update public.tenant_contract_channels ch
  set status='paused',updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  where ch.assignment_id=ta.id and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and ch.status='active';
  get diagnostics v_channels=row_count;

  update public.contract_publications p set status='paused',updated_at=now()
  from public.tenant_contract_assignments ta
  where p.assignment_id=ta.id and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and p.status='published';
  get diagnostics v_publications=row_count;

  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions pv
  set status='ended',valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  where pv.contract_publication_id=p.id and ta.company_id=p_company_id
    and ta.contract_product_version_id=o.contract_product_version_id
    and pv.status='published';
  get diagnostics v_versions=row_count;

  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status='paused',publication_status='unpublished',is_public=false,
      website_enabled=false,website_cta_enabled=false,updated_by=p_actor_user_id,updated_at=now()
  where company_id=p_company_id and source_contract_offer_id=o.id
    and (is_public or website_enabled or website_cta_enabled or publication_status='published');
  get diagnostics v_public_offers=row_count;

  update public.tenant_contract_assignments
  set status='paused',updated_at=now()
  where company_id=p_company_id and contract_product_version_id=o.contract_product_version_id
    and status='active';
  update public.contract_offers
  set lifecycle_status='paused',status='inactive',is_active=false,updated_by=p_actor_user_id,updated_at=now()
  where id=o.id returning * into o;
  update public.contract_products set status='paused',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product_version',o.contract_product_version_id::text,
    'contract.channels.paused',null,to_jsonb(o),
    jsonb_build_object('offer_id',o.id,'affected_channels',v_channels,'affected_publication_versions',v_versions));

  return jsonb_build_object(
    'ok',true,'changed',(v_channels+v_publications+v_versions+v_public_offers)>0,'mode','paused','offer',to_jsonb(o),
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers
  );
end $$;

create or replace function public.gridex_archive_contract_product(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_before jsonb;
  v_channels bigint:=0;
  v_publications bigint:=0;
  v_versions bigint:=0;
  v_assignments bigint:=0;
  v_public_offers bigint:=0;
  v_offers bigint:=0;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.archive');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then raise exception using errcode='P0002',message='contract_offer_not_found'; end if;
  v_before:=to_jsonb(o);

  if o.contract_product_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id for update;
  end if;

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions pv
  set status=case when pv.locked_at is null then 'archived' else 'ended' end,
      valid_to=coalesce(valid_to,now())
  from public.contract_publications p
  join public.tenant_contract_assignments ta on ta.id=p.assignment_id
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where pv.contract_publication_id=p.id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id
    and pv.status not in ('ended','archived');
  get diagnostics v_versions=row_count;

  update public.contract_publications p set status='archived',updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where p.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and p.status<>'archived';
  get diagnostics v_publications=row_count;

  update public.tenant_contract_assignments ta
  set status='ended',valid_to=coalesce(valid_to,current_date),updated_at=now()
  from public.contract_product_versions cpv
  where cpv.id=ta.contract_product_version_id and ta.company_id=p_company_id
    and cpv.contract_product_id=o.contract_product_id and ta.status<>'ended';
  get diagnostics v_assignments=row_count;

  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status='archived',publication_status='archived',is_public=false,is_archived=true,
      website_enabled=false,website_cta_enabled=false,archived_at=coalesce(archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where company_id=p_company_id and (
      (o.contract_product_id is not null and contract_product_id=o.contract_product_id)
      or source_contract_offer_id in (
        select series_offer.id from public.contract_offers series_offer
        where series_offer.company_id=p_company_id and series_offer.version_series_id=o.version_series_id
      )
    ) and not is_archived;
  get diagnostics v_public_offers=row_count;

  update public.contract_offers series_offer
  set lifecycle_status='archived',status='inactive',is_active=false,
      archived_at=coalesce(series_offer.archived_at,now()),
      updated_by=p_actor_user_id,updated_at=now()
  where series_offer.company_id=p_company_id
    and (series_offer.version_series_id=o.version_series_id
         or (o.contract_product_id is not null and series_offer.contract_product_id=o.contract_product_id))
    and series_offer.lifecycle_status<>'archived';
  get diagnostics v_offers=row_count;

  select * into o from public.contract_offers where id=p_offer_id;
  update public.contract_products set status='archived',updated_at=now()
  where id=o.contract_product_id and company_id=p_company_id;

  insert into public.audit_logs(company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata)
  values(p_company_id,p_actor_user_id,'contract_product',o.contract_product_id::text,'contract.product.archived',
    v_before,to_jsonb(o),jsonb_build_object(
      'offer_id',o.id,'history_preserved',true,'affected_channels',v_channels,
      'affected_publication_versions',v_versions,'affected_public_offers',v_public_offers
    ));

  return jsonb_build_object(
    'ok',true,'changed',(v_channels+v_publications+v_versions+v_assignments+v_public_offers+v_offers)>0,
    'mode','archived','offer',to_jsonb(o),'contract_product_id',o.contract_product_id,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_assignments',v_assignments,
    'affected_public_offers',v_public_offers,'affected_contract_offers',v_offers
  );
end $$;
create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,p_offer_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_preview jsonb;
  v_product_id uuid;
  v_price_plan_id uuid;
  v_price_plan_version_id uuid;
  v_price_book_id uuid;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_counts jsonb:='{}'::jsonb;
  v_count bigint;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  select * into o
  from public.contract_offers
  where id=p_offer_id and company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'can_delete')::boolean,coalesce((v_preview->>'deletable')::boolean,false)) then
    raise exception using errcode='23514',message='unused_contract_delete_blocked:'||v_preview::text;
  end if;

  v_product_id:=o.contract_product_id;
  v_price_plan_id:=o.price_plan_id;
  v_price_plan_version_id:=o.price_plan_version_id;
  v_price_book_id:=o.price_book_id;

  select coalesce(array_agg(id),'{}'::uuid[]) into v_public_offer_ids
  from public.public_contract_offers
  where company_id=p_company_id and (
    source_contract_offer_id=o.id
    or (o.contract_product_version_id is not null and contract_product_version_id=o.contract_product_version_id)
  );

  select coalesce(array_agg(id),'{}'::uuid[]) into v_product_version_ids
  from public.contract_product_versions
  where o.contract_product_version_id is not null and id=o.contract_product_version_id;

  select coalesce(array_agg(id),'{}'::uuid[]) into v_assignment_ids
  from public.tenant_contract_assignments
  where company_id=p_company_id
    and contract_product_version_id=any(v_product_version_ids);

  select coalesce(array_agg(id),'{}'::uuid[]) into v_publication_ids
  from public.contract_publications
  where assignment_id=any(v_assignment_ids);

  select coalesce(array_agg(id),'{}'::uuid[]) into v_legal_version_ids
  from public.legal_bundle_versions
  where company_id=p_company_id
    and contract_product_version_id=any(v_product_version_ids);

  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.pricing_version_write','on',true);

  -- A still-published but business-unused offer is closed inside the same
  -- transaction. Channel permission flags are irrelevant because the whole
  -- exclusive technical graph is being deleted.
  update public.tenant_contract_channels
  set status='ended',valid_to=coalesce(valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  where assignment_id=any(v_assignment_ids) and status<>'ended';

  update public.contract_publications
  set status='ended',updated_at=now()
  where id=any(v_publication_ids) and status not in ('ended','archived');

  update public.contract_publication_versions
  set status='ended',valid_to=coalesce(valid_to,now())
  where contract_publication_id=any(v_publication_ids) and status not in ('ended','archived');

  perform set_config('gridex.public_offer_write','on',true);
  update public.public_contract_offers
  set lifecycle_status='paused',publication_status='unpublished',is_public=false,is_archived=false,
      website_enabled=false,website_cta_enabled=false,updated_at=now()
  where id=any(v_public_offer_ids);

  -- Break the intentionally restrictive legacy compatibility cycle before
  -- deleting either side: public_contract_offers points to the publication
  -- version, while the publication version points back to the legacy offer.
  update public.contract_publication_versions
  set legacy_public_contract_offer_id=null
  where contract_publication_id=any(v_publication_ids)
    and legacy_public_contract_offer_id=any(v_public_offer_ids);

  update public.public_contract_offers
  set lifecycle_status='draft',publication_status='draft',is_public=false,is_archived=false,
      website_enabled=false,website_cta_enabled=false,
      contract_publication_version_id=null,updated_at=now()
  where id=any(v_public_offer_ids);

  delete from public.contract_offer_versions
  where company_id=p_company_id and contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  -- Compatibility rows and the source draft are removed before their
  -- referenced legal/product versions. Publication rows are already detached.
  delete from public.public_contract_offers
  where id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_offers
  where id=o.id and company_id=p_company_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception using errcode='55000',message='contract_offer_delete_count_mismatch';
  end if;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.contract_publication_versions
  where contract_publication_id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications
  where id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels
  where assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments
  where id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.legal_bundle_version_documents
  where legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions
  where id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions
  where id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(select 1 from public.contract_product_versions where contract_product_id=v_product_id) then
    delete from public.contract_products where id=v_product_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  if v_price_book_id is not null
     and not exists(select 1 from public.contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.public_contract_offers where price_book_id=v_price_book_id)
     and not exists(select 1 from public.customer_contracts where price_book_id=v_price_book_id)
     and not exists(select 1 from public.contract_price_snapshots where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlays where price_book_id=v_price_book_id)
     and not exists(select 1 from public.billing_underlay_items where price_book_id=v_price_book_id) then
    delete from public.price_books where id=v_price_book_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_books',v_count);
  end if;

  if v_price_plan_version_id is not null
     and not exists(select 1 from public.contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.public_contract_offers where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.customer_contracts where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.contract_price_snapshots where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlays where price_plan_version_id=v_price_plan_version_id)
     and not exists(select 1 from public.billing_underlay_items where price_plan_version_id=v_price_plan_version_id) then
    delete from public.price_plan_versions where id=v_price_plan_version_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plan_versions',v_count);
  end if;

  if v_price_plan_id is not null
     and not exists(select 1 from public.price_plan_versions where price_plan_id=v_price_plan_id) then
    delete from public.price_plans where id=v_price_plan_id and company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('price_plans',v_count);
  end if;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.unused_draft.deleted',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'deleted',true,'mode','deleted','offer_id',p_offer_id,
    'contract_product_id',v_product_id,'deleted_rows',v_counts,
    'deleted_contract_offers',coalesce((v_counts->>'contract_offers')::bigint,0),
    'deleted_public_offers',coalesce((v_counts->>'public_contract_offers')::bigint,0),
    'deleted_channels',coalesce((v_counts->>'tenant_contract_channels')::bigint,0),
    'deleted_assignments',coalesce((v_counts->>'tenant_contract_assignments')::bigint,0),
    'deleted_publication_versions',coalesce((v_counts->>'contract_publication_versions')::bigint,0),
    'deleted_product_versions',coalesce((v_counts->>'contract_product_versions')::bigint,0),
    'deleted_legal_versions',coalesce((v_counts->>'legal_bundle_versions')::bigint,0),
    'deleted_products',coalesce((v_counts->>'contract_products')::bigint,0)
  );
end $$;
create or replace function public.gridex_remove_internal_contract_offer(
  p_company_id uuid,p_offer_id uuid,p_mode text default 'archive',p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_preview jsonb;
begin
  if p_mode='archive' then
    return public.gridex_archive_contract_product(p_company_id,p_offer_id,p_actor_user_id);
  elsif p_mode='safe_delete' then
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
    if coalesce((v_preview->>'can_delete')::boolean,coalesce((v_preview->>'deletable')::boolean,false)) then
      return public.gridex_delete_unused_contract(p_company_id,p_offer_id,p_actor_user_id);
    end if;
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked','code','unused_contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'recommended_action','archive','delete_preview',v_preview
    );
  end if;
  raise exception using errcode='22023',message='invalid_contract_remove_mode';
end $$;

create or replace function public.gridex_cleanup_unused_contract_drafts(
  p_company_id uuid,p_actor_user_id uuid,p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r record;
  v_preview jsonb;
  v_item jsonb;
  v_items jsonb:='[]'::jsonb;
  v_deleted integer:=0;
  v_archive_only integer:=0;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  for r in
    select id,name,lifecycle_status,updated_at
    from public.contract_offers
    where company_id=p_company_id and lifecycle_status in ('draft','ready','published','paused','archived')
    order by updated_at,id
  loop
    v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,r.id);
    if coalesce((v_preview->>'can_delete')::boolean,coalesce((v_preview->>'deletable')::boolean,false)) then
      if p_apply then
        v_item:=public.gridex_delete_unused_contract(p_company_id,r.id,p_actor_user_id);
        v_deleted:=v_deleted+1;
      else
        v_item:=jsonb_build_object('offer_id',r.id,'name',r.name,'action','delete','preview',v_preview);
      end if;
    else
      v_archive_only:=v_archive_only+1;
      v_item:=jsonb_build_object('offer_id',r.id,'name',r.name,'action','archive_only','preview',v_preview);
    end if;
    v_items:=v_items||jsonb_build_array(v_item);
  end loop;
  return jsonb_build_object(
    'ok',true,'apply',p_apply,'deleted_count',v_deleted,
    'archive_only_count',v_archive_only,'items',v_items
  );
end $$;

-- ---------------------------------------------------------------------------
-- Idempotent legacy/canonical lifecycle repair and audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.contract_lifecycle_backfill_issues (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  contract_offer_id uuid references public.contract_offers(id) on delete cascade,
  public_contract_offer_id uuid references public.public_contract_offers(id) on delete cascade,
  issue_code text not null,
  issue_detail jsonb not null default '{}'::jsonb,
  status text not null default 'open' check(status in ('open','resolved')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists contract_lifecycle_backfill_issues_identity_uidx
  on public.contract_lifecycle_backfill_issues(
    issue_code,
    coalesce(contract_offer_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(public_contract_offer_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists contract_lifecycle_backfill_issues_open_idx
  on public.contract_lifecycle_backfill_issues(company_id,status,last_seen_at desc);

alter table public.contract_lifecycle_backfill_issues enable row level security;
alter table public.contract_lifecycle_backfill_issues force row level security;
revoke all on public.contract_lifecycle_backfill_issues from anon,authenticated;
grant select,insert,update,delete on public.contract_lifecycle_backfill_issues to service_role;

create or replace function public.gridex_record_contract_backfill_issue(
  p_company_id uuid,
  p_contract_offer_id uuid,
  p_public_contract_offer_id uuid,
  p_issue_code text,
  p_issue_detail jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  insert into public.contract_lifecycle_backfill_issues(
    company_id,contract_offer_id,public_contract_offer_id,issue_code,issue_detail,status,last_seen_at
  ) values(
    p_company_id,p_contract_offer_id,p_public_contract_offer_id,p_issue_code,coalesce(p_issue_detail,'{}'::jsonb),'open',now()
  )
  on conflict(
    issue_code,
    (coalesce(contract_offer_id,'00000000-0000-0000-0000-000000000000'::uuid)),
    (coalesce(public_contract_offer_id,'00000000-0000-0000-0000-000000000000'::uuid))
  ) do update set
    company_id=excluded.company_id,
    issue_detail=excluded.issue_detail,
    status='open',last_seen_at=now(),resolved_at=null;
end $$;

create or replace function public.gridex_backfill_contract_lifecycle(
  p_company_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  po public.public_contract_offers%rowtype;
  v_match_id uuid;
  v_match_count integer;
  v_assignment_id uuid;
  v_channel_id uuid;
  v_publication_id uuid;
  v_publication_version_id uuid;
  v_version integer;
  v_offer_reference text;
  v_snapshot jsonb;
  v_hash text;
  v_active boolean;
  v_synced integer:=0;
  v_mapped integer:=0;
  v_publications integer:=0;
  v_issues integer:=0;
begin
  -- Clear only issues in this execution scope. Failed rows are reopened below.
  update public.contract_lifecycle_backfill_issues
  set status='resolved',resolved_at=now(),last_seen_at=now()
  where status='open' and (p_company_id is null or company_id=p_company_id);

  for o in
    select * from public.contract_offers
    where p_company_id is null or company_id=p_company_id
    order by company_id,created_at,id
  loop
    begin
      perform public.gridex_sync_internal_offer_to_canonical(o.id);
      v_synced:=v_synced+1;
    exception when others then
      perform public.gridex_record_contract_backfill_issue(
        o.company_id,o.id,null,'CANONICAL_SYNC_FAILED',
        jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm)
      );
      v_issues:=v_issues+1;
    end;
  end loop;

  -- Deterministically attach legacy public offers that have exactly one source.
  for po in
    select * from public.public_contract_offers
    where source_contract_offer_id is null
      and (p_company_id is null or company_id=p_company_id)
    order by company_id,created_at,id
  loop
    v_match_id:=null;
    v_match_count:=0;
    select count(*),(array_agg(o2.id order by o2.id))[1] into v_match_count,v_match_id
    from public.contract_offers o2
    where o2.company_id=po.company_id
      and (
        (po.contract_product_version_id is not null and o2.contract_product_version_id=po.contract_product_version_id)
        or (po.version_series_id is not null and o2.version_series_id=po.version_series_id and o2.version_number=po.version_number)
        or (po.price_plan_version_id is not null and o2.price_plan_version_id=po.price_plan_version_id
            and lower(o2.name)=lower(po.public_name))
      );

    if v_match_count=1 then
      perform set_config('gridex.public_offer_write','on',true);
      update public.public_contract_offers
      set source_contract_offer_id=v_match_id,updated_at=now()
      where id=po.id;
      v_mapped:=v_mapped+1;
    else
      perform public.gridex_record_contract_backfill_issue(
        po.company_id,null,po.id,
        case when v_match_count=0 then 'PUBLIC_OFFER_SOURCE_NOT_FOUND' else 'PUBLIC_OFFER_SOURCE_AMBIGUOUS' end,
        jsonb_build_object('candidate_count',v_match_count)
      );
      v_issues:=v_issues+1;
    end if;
  end loop;

  -- Build/repair the website assignment, channel and immutable publication graph.
  for po in
    select p.* from public.public_contract_offers p
    where p.source_contract_offer_id is not null
      and (p_company_id is null or p.company_id=p_company_id)
    order by p.company_id,p.created_at,p.id
  loop
    begin
      select * into o from public.contract_offers
      where id=po.source_contract_offer_id and company_id=po.company_id;
      if not found then
        perform public.gridex_record_contract_backfill_issue(
          po.company_id,po.source_contract_offer_id,po.id,'PUBLIC_OFFER_SOURCE_MISSING','{}'::jsonb
        );
        v_issues:=v_issues+1;
        continue;
      end if;

      if o.contract_product_id is null or o.contract_product_version_id is null or o.legal_bundle_version_id is null then
        perform public.gridex_sync_internal_offer_to_canonical(o.id);
        select * into o from public.contract_offers where id=o.id;
      end if;
      if o.contract_product_id is null or o.contract_product_version_id is null or o.legal_bundle_version_id is null then
        perform public.gridex_record_contract_backfill_issue(
          o.company_id,o.id,po.id,'INCOMPLETE_CANONICAL_MAPPING',
          jsonb_build_object(
            'contract_product_id',o.contract_product_id,
            'contract_product_version_id',o.contract_product_version_id,
            'legal_bundle_version_id',o.legal_bundle_version_id
          )
        );
        v_issues:=v_issues+1;
        continue;
      end if;

      select id into v_assignment_id
      from public.tenant_contract_assignments
      where company_id=o.company_id and contract_product_version_id=o.contract_product_version_id
      order by created_at,id limit 1 for update;
      if v_assignment_id is null then
        insert into public.tenant_contract_assignments(
          company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,
          status,legal_mode,valid_from,valid_to
        ) values(
          o.company_id,o.contract_product_version_id,true,true,
          case when o.lifecycle_status='archived' then 'ended' when po.is_public and not po.is_archived then 'active' else 'paused' end,
          'ops_standard',o.valid_from,o.valid_to
        ) returning id into v_assignment_id;
      else
        update public.tenant_contract_assignments
        set website_publication_allowed=true,
            status=case when o.lifecycle_status='archived' then 'ended'
                        when po.is_public and not po.is_archived then 'active'
                        when status='ended' then status else 'paused' end,
            valid_from=o.valid_from,valid_to=o.valid_to,updated_at=now()
        where id=v_assignment_id;
      end if;

      v_active:=coalesce(po.is_public,false)
        and not coalesce(po.is_archived,false)
        and coalesce(po.publication_status,'')='published'
        and coalesce(po.lifecycle_status,'')='published'
        and o.lifecycle_status<>'archived';

      insert into public.tenant_contract_channels(
        assignment_id,channel,status,valid_from,valid_to,marketing_content
      ) values(
        v_assignment_id,'website',case when v_active then 'active' else 'paused' end,
        o.valid_from::timestamptz,o.valid_to::timestamptz,
        jsonb_build_object('name',o.name,'source_contract_offer_id',o.id,'source_of_truth','contract_product_versions')
      ) on conflict(assignment_id,channel) do update set
        status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,
        marketing_content=excluded.marketing_content,updated_at=now()
      returning id into v_channel_id;

      insert into public.contract_publications(assignment_id,channel,status)
      values(v_assignment_id,'website',case when v_active then 'published' else 'paused' end)
      on conflict(assignment_id,channel) do update set status=excluded.status,updated_at=now()
      returning id into v_publication_id;

      v_offer_reference:='GRIDEX-'||replace(o.version_series_id::text,'-','')||'-V'||o.version_number||'-WEBSITE';
      v_snapshot:=jsonb_build_object(
        'schema','gridex_contract_publication_v5',
        'company_id',o.company_id,
        'contract_product_id',o.contract_product_id,
        'contract_product_version_id',o.contract_product_version_id,
        'source_contract_offer_id',o.id,
        'channel','website',
        'offer_reference',v_offer_reference,
        'commercial_snapshot',o.commercial_snapshot,
        'legal_bundle_version_id',o.legal_bundle_version_id,
        'valid_from',o.valid_from,
        'valid_to',o.valid_to
      );
      v_hash:=encode(digest(v_snapshot::text,'sha256'),'hex');

      select id into v_publication_version_id
      from public.contract_publication_versions
      where contract_publication_id=v_publication_id
        and (content_sha256=v_hash or legacy_public_contract_offer_id=po.id)
      order by version_number desc limit 1 for update;

      if v_active then
        if v_publication_version_id is null then
          select coalesce(max(version_number),0)+1 into v_version
          from public.contract_publication_versions where contract_publication_id=v_publication_id;
          insert into public.contract_publication_versions(
            contract_publication_id,version_number,contract_product_version_id,
            price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,
            legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,
            publication_snapshot,offer_reference,content_sha256,status,published_at,locked_at
          ) values(
            v_publication_id,v_version,o.contract_product_version_id,
            o.price_plan_id,o.price_plan_version_id,o.price_book_id,o.legal_bundle_version_id,
            po.id,o.customer_type,'website',o.valid_from::timestamptz,o.valid_to::timestamptz,
            v_snapshot,v_offer_reference,v_hash,'published',coalesce(po.published_at,now()),now()
          ) returning id into v_publication_version_id;
          v_publications:=v_publications+1;
        else
          perform set_config('gridex.version_transition','on',true);
          update public.contract_publication_versions
          set status='published',valid_to=o.valid_to::timestamptz,
              published_at=coalesce(published_at,po.published_at,now()),locked_at=coalesce(locked_at,now()),
              legacy_public_contract_offer_id=coalesce(legacy_public_contract_offer_id,po.id)
          where id=v_publication_version_id;
        end if;
      else
        if v_publication_version_id is not null then
          perform set_config('gridex.version_transition','on',true);
          update public.contract_publication_versions
          set status=case when o.lifecycle_status='archived' then 'archived' else 'ended' end,
              valid_to=coalesce(valid_to,po.archived_at,po.updated_at,now())
          where id=v_publication_version_id and status in ('draft','review','published','paused');
        end if;
      end if;

      perform set_config('gridex.public_offer_write','on',true);
      update public.public_contract_offers
      set contract_product_id=o.contract_product_id,
          contract_product_version_id=o.contract_product_version_id,
          legal_bundle_version_id=o.legal_bundle_version_id,
          contract_publication_version_id=case when v_active then v_publication_version_id else contract_publication_version_id end,
          version_series_id=o.version_series_id,version_number=o.version_number,
          lifecycle_status=case when o.lifecycle_status='archived' then 'archived' when v_active then 'published' else 'paused' end,
          updated_at=now()
      where id=po.id;

      update public.contract_lifecycle_backfill_issues
      set status='resolved',resolved_at=now(),last_seen_at=now()
      where (contract_offer_id=o.id or public_contract_offer_id=po.id) and status='open';
    exception when others then
      perform public.gridex_record_contract_backfill_issue(
        po.company_id,po.source_contract_offer_id,po.id,'PUBLICATION_BACKFILL_FAILED',
        jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm)
      );
      v_issues:=v_issues+1;
    end;
  end loop;

  -- Re-derive offer lifecycle from exact current channels. Preserve archived and drafts.
  update public.contract_offers o2
  set lifecycle_status=case
        when o2.lifecycle_status='archived' then 'archived'
        when exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ) then 'published'
        when o2.lifecycle_status in ('published','paused','superseded') then 'paused'
        else o2.lifecycle_status
      end,
      status=case when exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ) then 'active' else 'inactive' end,
      is_active=exists(
          select 1 from public.tenant_contract_assignments ta
          join public.tenant_contract_channels ch on ch.assignment_id=ta.id
          where ta.company_id=o2.company_id
            and ta.contract_product_version_id=o2.contract_product_version_id
            and ta.status='active' and ch.status='active'
        ),
      updated_at=now()
  where (p_company_id is null or o2.company_id=p_company_id)
    and o2.contract_product_version_id is not null;

  return jsonb_build_object(
    'ok',true,'synced_contract_offers',v_synced,'mapped_public_offers',v_mapped,
    'created_publication_versions',v_publications,
    'open_issue_count',(select count(*) from public.contract_lifecycle_backfill_issues i
                        where i.status='open' and (p_company_id is null or i.company_id=p_company_id)),
    'issues_seen_this_run',v_issues
  );
end $$;

create or replace function public.gridex_verify_contract_lifecycle_backfill(
  p_company_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_checks jsonb;
  v_total bigint;
begin
  with checks as (
    select 'MISSING_CANONICAL_PRODUCT'::text check_name,count(*)::bigint error_count,
      coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb) examples,'critical'::text severity
    from (select id,row_number() over(order by id) rn from public.contract_offers
          where (p_company_id is null or company_id=p_company_id) and contract_product_id is null) q
    union all
    select 'MISSING_CANONICAL_VERSION',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select id,row_number() over(order by id) rn from public.contract_offers
          where (p_company_id is null or company_id=p_company_id) and contract_product_version_id is null) q
    union all
    select 'MISSING_TENANT_ASSIGNMENT',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select o.id,row_number() over(order by o.id) rn from public.contract_offers o
          where (p_company_id is null or o.company_id=p_company_id)
            and o.contract_product_version_id is not null and not exists(
              select 1 from public.tenant_contract_assignments ta
              where ta.company_id=o.company_id and ta.contract_product_version_id=o.contract_product_version_id)) q
    union all
    select 'ACTIVE_CHANNEL_WITHOUT_PUBLICATION_VERSION',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select ch.id,row_number() over(order by ch.id) rn
          from public.tenant_contract_channels ch
          join public.tenant_contract_assignments ta on ta.id=ch.assignment_id
          where (p_company_id is null or ta.company_id=p_company_id) and ch.status='active' and ch.channel<>'internal'
            and not exists(
              select 1 from public.contract_publications cp
              join public.contract_publication_versions cpv on cpv.contract_publication_id=cp.id
              where cp.assignment_id=ta.id and cp.channel=ch.channel and cpv.status='published'
                and cpv.contract_product_version_id=ta.contract_product_version_id)) q
    union all
    select 'ACTIVE_PUBLIC_OFFER_WITHOUT_CANONICAL_PUBLICATION',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select p.id,row_number() over(order by p.id) rn from public.public_contract_offers p
          where (p_company_id is null or p.company_id=p_company_id)
            and p.is_public and not p.is_archived and p.publication_status='published'
            and (p.source_contract_offer_id is null or p.contract_product_version_id is null
                 or p.contract_publication_version_id is null)) q
    union all
    select 'ARCHIVED_OFFER_WITH_ACTIVE_CHANNEL',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select o.id,row_number() over(order by o.id) rn from public.contract_offers o
          where (p_company_id is null or o.company_id=p_company_id) and o.lifecycle_status='archived'
            and exists(select 1 from public.tenant_contract_assignments ta
              join public.tenant_contract_channels ch on ch.assignment_id=ta.id
              where ta.company_id=o.company_id and ta.contract_product_version_id=o.contract_product_version_id
                and ch.status='active')) q
    union all
    select 'DUPLICATE_ACTIVE_PUBLICATION_VERSION',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select (array_agg(cpv.id order by cpv.id))[1] id,row_number() over(order by cp.id) rn
          from public.contract_publications cp
          join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
          join public.contract_publication_versions cpv on cpv.contract_publication_id=cp.id and cpv.status='published'
          where p_company_id is null or ta.company_id=p_company_id
          group by cp.id having count(*)>1) q
    union all
    select 'ORPHAN_PUBLICATION_VERSION',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'critical'
    from (select cpv.id,row_number() over(order by cpv.id) rn
          from public.contract_publication_versions cpv
          left join public.contract_publications cp on cp.id=cpv.contract_publication_id
          where cp.id is null) q
    union all
    select 'OPEN_BACKFILL_ISSUE',count(*),coalesce(jsonb_agg(id) filter(where rn<=10),'[]'::jsonb),'warning'
    from (select i.id,row_number() over(order by i.last_seen_at desc,i.id) rn
          from public.contract_lifecycle_backfill_issues i
          where i.status='open' and (p_company_id is null or i.company_id=p_company_id)) q
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'check_name',check_name,'error_count',error_count,'examples',examples,
           'severity',severity,
           'recommended_action',case when check_name='OPEN_BACKFILL_ISSUE'
             then 'Review contract_lifecycle_backfill_issues.' else 'Repair canonical contract lifecycle mapping.' end
         ) order by check_name),'[]'::jsonb),
         coalesce(sum(error_count) filter(where severity='critical'),0)
  into v_checks,v_total from checks;

  return jsonb_build_object(
    'ok',v_total=0,'critical_error_count',v_total,'checks',v_checks,'verified_at',now()
  );
end $$;

-- Backfill every tenant. This call is intentionally idempotent and may be
-- re-run after manual resolution of a reported ambiguous legacy row.
select public.gridex_backfill_contract_lifecycle(null);

-- Enrich the compatibility read model with permission and runtime channel state.
-- Drop/recreate is deliberate because the previous view has a stable legacy
-- column order and the new fields are appended after those columns.
drop view if exists public.canonical_internal_contract_offers_v;
create view public.canonical_internal_contract_offers_v
with (security_invoker=true)
as
select
  o.*,
  cp.product_code as canonical_product_code,
  cp.status as canonical_product_status,
  pv.version_number as canonical_version_number,
  pv.status as canonical_version_status,
  pv.content_sha256 as canonical_content_sha256,
  public.gridex_validate_contract_readiness(o.company_id,o.id) as readiness,
  public.gridex_preview_delete_unused_contract(o.company_id,o.id) as deletion_preview,
  (o.lifecycle_status='published' and o.is_active and o.status='active'
    and coalesce(ta.internal_sales_allowed,false) and coalesce(internal_ch.status,'missing')='active') as currently_sellable,
  pv.required_legal_modules,
  pv.commercial_snapshot as canonical_commercial_snapshot,
  pv.locked_at as canonical_version_locked_at,
  lbv.status as canonical_legal_status,
  lbv.locked_at as canonical_legal_locked_at,
  coalesce(ta.internal_sales_allowed,false) as internal_sales_allowed,
  coalesce(ta.website_publication_allowed,false) as website_publication_allowed,
  coalesce(internal_ch.status,'missing') as internal_channel_status,
  coalesce(website_ch.status,'missing') as website_channel_status,
  coalesce(api_ch.status,'missing') as api_channel_status,
  coalesce(active_pub.active_count,0)::integer as active_publication_version_count
from public.contract_offers o
left join public.contract_products cp on cp.id=o.contract_product_id
left join public.contract_product_versions pv on pv.id=o.contract_product_version_id
left join public.legal_bundle_versions lbv on lbv.id=o.legal_bundle_version_id
left join public.tenant_contract_assignments ta
  on ta.company_id=o.company_id and ta.contract_product_version_id=o.contract_product_version_id
left join public.tenant_contract_channels internal_ch on internal_ch.assignment_id=ta.id and internal_ch.channel='internal'
left join public.tenant_contract_channels website_ch on website_ch.assignment_id=ta.id and website_ch.channel='website'
left join public.tenant_contract_channels api_ch on api_ch.assignment_id=ta.id and api_ch.channel='api'
left join lateral (
  select count(*) active_count
  from public.contract_publications publication
  join public.contract_publication_versions publication_version
    on publication_version.contract_publication_id=publication.id
  where publication.assignment_id=ta.id and publication_version.status='published'
) active_pub on true;

revoke all on function public.gridex_contract_business_usage_counts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_contract_system_dependency_counts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.gridex_record_contract_backfill_issue(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.gridex_backfill_contract_lifecycle(uuid) from public,anon,authenticated;
revoke all on function public.gridex_verify_contract_lifecycle_backfill(uuid) from public,anon,authenticated;
grant execute on function public.gridex_preview_delete_unused_contract(uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid) to authenticated,service_role;
grant execute on function public.gridex_pause_contract_channels(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_archive_contract_product(uuid,uuid,uuid) to authenticated,service_role;
grant execute on function public.gridex_backfill_contract_lifecycle(uuid) to service_role;
grant execute on function public.gridex_verify_contract_lifecycle_backfill(uuid) to service_role;
grant select on public.canonical_internal_contract_offers_v to authenticated,service_role;

comment on function public.gridex_preview_delete_unused_contract(uuid,uuid) is
  'Separates binding business usage from removable technical lifecycle data. Locked technical versions alone do not block deletion.';
comment on function public.gridex_backfill_contract_lifecycle(uuid) is
  'Idempotently repairs all legacy internal/public contract offers into the canonical product, assignment, channel and publication graph.';
comment on function public.gridex_verify_contract_lifecycle_backfill(uuid) is
  'Returns machine-readable canonical lifecycle integrity checks and example IDs.';

commit;
