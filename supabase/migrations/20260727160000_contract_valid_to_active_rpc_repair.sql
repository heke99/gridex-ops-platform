-- GRIDEX forward-only repair: restore qualified valid_to references in the final active RPC definitions.
-- Historical migrations remain immutable; this migration is the new source of truth.

begin;

-- Final source before repair: 20260716010000_contract_billing_end_to_end_completion.sql
create or replace function public.gridex_sync_public_offer_to_canonical(p_offer_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  o public.public_contract_offers%rowtype; v_product_id uuid; v_contract_version_id uuid; v_assignment_id uuid;
  v_publication_id uuid; v_legal_version_id uuid; v_publication_version_id uuid; v_price_snapshot jsonb;
  v_commercial jsonb; v_publication jsonb; v_hash text; v_number integer; v_required text[]; v_published public.contract_publication_versions;
begin
  select * into o from public.public_contract_offers where id=p_offer_id for update;
  if not found then return null; end if;
  select snapshot_json into v_price_snapshot from public.price_plan_versions where id=o.price_plan_version_id and company_id=o.company_id and price_plan_id=o.price_plan_id;
  if v_price_snapshot is null then raise exception 'Exakt prisversion saknas för avtalet.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(o.company_id::text||':'||o.version_series_id::text,0));
  perform set_config('gridex.public_offer_write','on',true);

  insert into public.contract_products(company_id,product_code,name,product_category,description,status,created_by)
  values(o.company_id,'website:'||o.version_series_id::text,o.public_name,coalesce(o.contract_type,'unknown'),o.public_description,case when o.is_archived then 'archived' else 'active' end,o.created_by)
  on conflict(company_id,product_code) where company_id is not null do update set name=excluded.name,description=excluded.description,status=excluded.status,updated_at=now()
  returning id into v_product_id;

  v_required:=public.gridex_required_legal_modules(o.customer_type,o.contract_type,'website',o.automatic_renewal,o.power_of_attorney_required);
  v_commercial:=jsonb_build_object('schema','gridex_contract_commercial_v3','company_id',o.company_id,'version_series_id',o.version_series_id,'legacy_public_contract_offer_id',o.id,
    'contract_type',o.contract_type,'billing_model',o.billing_model,'customer_type',o.customer_type,'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,
    'pricing_snapshot',v_price_snapshot,'price_areas',o.price_areas,'binding_months',o.binding_months,'notice_months',o.notice_months,'automatic_renewal',o.automatic_renewal,'power_of_attorney_required',o.power_of_attorney_required);
  v_hash:=encode(digest(v_commercial::text,'sha256'),'hex');
  select id into v_contract_version_id from public.contract_product_versions where contract_product_id=v_product_id and content_sha256=v_hash limit 1;
  if v_contract_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_product_versions where contract_product_id=v_product_id;
    insert into public.contract_product_versions(contract_product_id,version_number,customer_type,contract_type,pricing_model,price_plan_id,price_plan_version_id,binding_months,notice_months,price_areas,automatic_renewal,power_of_attorney_required,required_legal_modules,commercial_snapshot,content_sha256,status,approved_at,approved_by,locked_at,created_by)
    values(v_product_id,v_number,o.customer_type,o.contract_type,coalesce(v_price_snapshot->>'pricing_model',o.billing_model,o.contract_type),o.price_plan_id,o.price_plan_version_id,o.binding_months,o.notice_months,o.price_areas,o.automatic_renewal,o.power_of_attorney_required,v_required,v_commercial,v_hash,
      case when o.publication_status='published' then 'approved' else 'draft' end,case when o.publication_status='published' then now() end,case when o.publication_status='published' then o.updated_by end,case when o.publication_status='published' then now() end,o.created_by)
    returning id into v_contract_version_id;
  end if;
  if o.publication_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.contract_product_versions
    set status='approved',approved_at=coalesce(approved_at,now()),approved_by=coalesce(approved_by,o.updated_by),locked_at=coalesce(locked_at,now())
    where id=v_contract_version_id and (status<>'approved' or locked_at is null);
  end if;

  if o.publication_status='published' then
    perform set_config('gridex.version_transition','on',true);
    update public.tenant_contract_assignments ta set status='ended',valid_to=coalesce(ta.valid_to,current_date),updated_at=now()
    from public.contract_product_versions pv where pv.id=ta.contract_product_version_id and ta.company_id=o.company_id and pv.contract_product_id=v_product_id and ta.contract_product_version_id<>v_contract_version_id and ta.status='active';
  end if;

  insert into public.tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,website_publication_allowed,status,legal_mode,valid_from,valid_to,assigned_by)
  values(o.company_id,v_contract_version_id,true,true,case when o.publication_status='published' then 'active' when o.is_archived then 'ended' else 'paused' end,'ops_standard',o.valid_from,o.valid_to,o.updated_by)
  on conflict(company_id,contract_product_version_id) do update set website_publication_allowed=true,status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,updated_at=now()
  returning id into v_assignment_id;
  insert into public.tenant_contract_channels(assignment_id,channel,status,valid_from,valid_to,marketing_content,updated_by)
  values(v_assignment_id,'website',case when o.publication_status='published' and o.website_enabled then 'active' when o.is_archived then 'ended' else 'paused' end,o.valid_from::timestamptz,o.valid_to::timestamptz,jsonb_build_object('name',o.public_name,'description',o.public_description,'sort_order',o.sort_order),o.updated_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,valid_from=excluded.valid_from,valid_to=excluded.valid_to,marketing_content=excluded.marketing_content,updated_by=excluded.updated_by,updated_at=now();

  v_legal_version_id:=public.gridex_materialize_legal_bundle_version(o.company_id,v_contract_version_id,o.legal_bundle_id,o.updated_by);
  if o.publication_status='published' then
    update public.legal_bundle_versions set status='published',published_at=coalesce(published_at,now()),locked_at=coalesce(locked_at,now()) where id=v_legal_version_id and locked_at is null;
  end if;

  insert into public.contract_publications(assignment_id,channel,status,created_by)
  values(v_assignment_id,'website',case when o.publication_status='published' then 'review' when o.is_archived then 'archived' else 'draft' end,o.created_by)
  on conflict(assignment_id,channel) do update set status=excluded.status,updated_at=now()
  returning id into v_publication_id;

  v_publication:=jsonb_build_object('schema','gridex_contract_publication_v3','legacy_public_contract_offer_id',o.id,'version_series_id',o.version_series_id,'version_number',o.version_number,
    'company_id',o.company_id,'contract_product_id',v_product_id,'contract_product_version_id',v_contract_version_id,'legal_bundle_version_id',v_legal_version_id,
    'price_plan_id',o.price_plan_id,'price_plan_version_id',o.price_plan_version_id,'price_book_id',o.price_book_id,'customer_type',o.customer_type,'channel','website','valid_from',o.valid_from,'valid_to',o.valid_to,
    'website_cta_enabled',o.website_cta_enabled,'public_name',o.public_name,'public_description',o.public_description,'public_price_text',o.public_price_text,'pricing_snapshot',v_price_snapshot);
  v_hash:=encode(digest(v_publication::text,'sha256'),'hex');
  select id into v_publication_version_id from public.contract_publication_versions where contract_publication_id=v_publication_id and content_sha256=v_hash limit 1;
  if v_publication_version_id is null then
    select coalesce(max(version_number),0)+1 into v_number from public.contract_publication_versions where contract_publication_id=v_publication_id;
    insert into public.contract_publication_versions(contract_publication_id,version_number,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,legacy_public_contract_offer_id,customer_type,channel,valid_from,valid_to,publication_snapshot,content_sha256,status,created_by)
    values(v_publication_id,v_number,v_contract_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,v_legal_version_id,o.id,o.customer_type,'website',o.valid_from::timestamptz,o.valid_to::timestamptz,v_publication,v_hash,case when o.publication_status='published' then 'review' when o.is_archived then 'archived' else 'draft' end,o.created_by)
    returning id into v_publication_version_id;
  end if;

  update public.public_contract_offers set contract_product_id=v_product_id,contract_product_version_id=v_contract_version_id,legal_bundle_version_id=v_legal_version_id,contract_publication_version_id=v_publication_version_id,
    metadata=coalesce(metadata,'{}')||jsonb_build_object('contract_product_id',v_product_id,'contract_product_version_id',v_contract_version_id,'tenant_contract_assignment_id',v_assignment_id,'legal_bundle_version_id',v_legal_version_id,'contract_publication_id',v_publication_id,'contract_publication_version_id',v_publication_version_id,'canonical_publication_sha256',v_hash,'source_of_truth','contract_publication_versions')
  where id=o.id;

  if o.publication_status='published' then
    v_published:=public.gridex_publish_contract_publication_version(v_publication_version_id,o.updated_by);
    update public.public_contract_offers set metadata=metadata||jsonb_build_object('canonical_offer_reference',v_published.offer_reference),is_public=true,published_at=coalesce(published_at,v_published.published_at),readiness_status='ready',readiness_blockers='[]'::jsonb where id=o.id;
  end if;
  return v_publication_version_id;
end $$;

-- Final source before repair: 20260721123000_contract_lifecycle_unpublish_delete_backfill.sql
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
    set status='ended',valid_to=coalesce(ch.valid_to,now()),updated_at=now()
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
end $$;

-- Final source before repair: 20260721123000_contract_lifecycle_unpublish_delete_backfill.sql
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
  set status='ended',valid_to=coalesce(pv.valid_to,now())
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

-- Final source before repair: 20260727030000_contract_operation_readiness_completion.sql
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
  v_readiness jsonb;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.archive');
  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked','code','contract_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;
  if o.lifecycle_status='archived' then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','archived','code','contract_already_archived',
      'offer_id',o.id,'contract_product_id',o.contract_product_id
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,o.id,'archive',null
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'mode','blocked',
      'code','invalid_contract_transition',
      'current_status',o.lifecycle_status,'requested_status','archived',
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  v_before:=to_jsonb(o);

  if o.contract_product_id is null then
    perform public.gridex_sync_internal_offer_to_canonical(o.id);
    select * into o from public.contract_offers where id=o.id for update;
  end if;

  update public.tenant_contract_channels ch
  set status='ended',valid_to=coalesce(ch.valid_to,now()),updated_by=p_actor_user_id,updated_at=now()
  from public.tenant_contract_assignments ta
  join public.contract_product_versions cpv on cpv.id=ta.contract_product_version_id
  where ch.assignment_id=ta.id and ta.company_id=p_company_id and cpv.contract_product_id=o.contract_product_id
    and ch.status<>'ended';
  get diagnostics v_channels=row_count;

  perform set_config('gridex.version_transition','on',true);
  update public.contract_publication_versions pv
  set status=case when pv.locked_at is null then 'archived' else 'ended' end,
      valid_to=coalesce(pv.valid_to,now())
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
  set status='ended',valid_to=coalesce(ta.valid_to,current_date),updated_at=now()
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
    'mode','archived','code','contract_archived','offer',to_jsonb(o),'contract_product_id',o.contract_product_id,
    'affected_channels',v_channels,'affected_publications',v_publications,
    'affected_publication_versions',v_versions,'affected_assignments',v_assignments,
    'affected_public_offers',v_public_offers,'affected_contract_offers',v_offers
  );
end $$;

-- Final source before repair: 20260727020000_contract_lifecycle_reference_readiness_repair.sql
create or replace function public.gridex_delete_unused_contract(
  p_company_id uuid,
  p_offer_id uuid,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_preview jsonb;
  v_graph jsonb;
  v_product_id uuid;
  v_public_offer_ids uuid[]:='{}'::uuid[];
  v_assignment_ids uuid[]:='{}'::uuid[];
  v_product_version_ids uuid[]:='{}'::uuid[];
  v_publication_ids uuid[]:='{}'::uuid[];
  v_publication_version_ids uuid[]:='{}'::uuid[];
  v_legal_version_ids uuid[]:='{}'::uuid[];
  v_counts jsonb:='{}'::jsonb;
  v_count bigint;
begin
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.delete_unused');
  select * into o
  from public.contract_offers co
  where co.id=p_offer_id and co.company_id=p_company_id
  for update;
  if not found then
    raise exception using errcode='P0002',message='contract_offer_not_found';
  end if;

  v_preview:=public.gridex_preview_delete_unused_contract(p_company_id,p_offer_id);
  if not coalesce((v_preview->>'can_delete')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'deleted',false,'mode','blocked',
      'code','contract_delete_blocked',
      'reason_codes',coalesce(v_preview->'reason_codes','[]'::jsonb),
      'blockers',coalesce(v_preview->'blockers','[]'::jsonb),
      'recommended_action',coalesce(v_preview->>'recommended_action','review'),
      'delete_preview',v_preview
    );
  end if;

  v_graph:=v_preview->'graph';
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_public_offer_ids
    from jsonb_array_elements_text(coalesce(v_graph->'public_contract_offer_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_assignment_ids
    from jsonb_array_elements_text(coalesce(v_graph->'tenant_assignment_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_product_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'contract_product_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_publication_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'publication_version_ids','[]'::jsonb));
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into v_legal_version_ids
    from jsonb_array_elements_text(coalesce(v_graph->'legal_bundle_version_ids','[]'::jsonb));

  v_product_id:=o.contract_product_id;
  perform set_config('gridex.public_offer_write','on',true);
  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);

  update public.tenant_contract_channels ch
  set status='ended',
      valid_to=coalesce(ch.valid_to,now()),
      updated_by=p_actor_user_id,
      updated_at=now()
  where ch.assignment_id=any(v_assignment_ids) and ch.status<>'ended';

  update public.contract_publications cp
  set status='ended',updated_at=now()
  where cp.id=any(v_publication_ids) and cp.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set status='ended',valid_to=coalesce(cpv.valid_to,now())
  where cpv.id=any(v_publication_version_ids)
    and cpv.status not in ('ended','archived');

  update public.contract_publication_versions cpv
  set legacy_public_contract_offer_id=null
  where cpv.legacy_public_contract_offer_id=any(v_public_offer_ids);

  -- Diagnostics belong to the removed technical graph. Delete them before the
  -- public offer regardless of historical FK action drift.
  delete from public.contract_lifecycle_backfill_issues i
  where i.company_id=p_company_id and (
    i.contract_offer_id=p_offer_id
    or i.public_contract_offer_id=any(v_public_offer_ids)
  );
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_lifecycle_backfill_issues',v_count);

  perform public.gridex_assert_no_public_offer_fk_references(v_public_offer_ids);

  delete from public.contract_offer_versions cov
  where cov.company_id=p_company_id and cov.contract_offer_id=o.id;
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_offer_versions',v_count);

  delete from public.public_contract_offers pco where pco.id=any(v_public_offer_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('public_contract_offers',v_count);

  delete from public.contract_publication_versions cpv
  where cpv.id=any(v_publication_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publication_versions',v_count);

  delete from public.contract_publications cp where cp.id=any(v_publication_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_publications',v_count);

  delete from public.tenant_contract_channels ch where ch.assignment_id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_channels',v_count);

  delete from public.tenant_contract_assignments ta where ta.id=any(v_assignment_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('tenant_contract_assignments',v_count);

  delete from public.contract_offers co
  where co.id=o.id and co.company_id=p_company_id;
  get diagnostics v_count=row_count;
  if v_count<>1 then
    raise exception using errcode='55000',message='contract_offer_delete_count_mismatch';
  end if;
  v_counts:=v_counts||jsonb_build_object('contract_offers',v_count);

  delete from public.legal_bundle_version_documents d
  where d.legal_bundle_version_id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_version_documents',v_count);

  delete from public.legal_bundle_versions lbv where lbv.id=any(v_legal_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('legal_bundle_versions',v_count);

  delete from public.contract_product_versions cpv
  where cpv.id=any(v_product_version_ids);
  get diagnostics v_count=row_count;
  v_counts:=v_counts||jsonb_build_object('contract_product_versions',v_count);

  if v_product_id is not null
     and not exists(
       select 1 from public.contract_product_versions cpv
       where cpv.contract_product_id=v_product_id
     ) then
    delete from public.contract_products cp
    where cp.id=v_product_id and cp.company_id=p_company_id;
    get diagnostics v_count=row_count;
    v_counts:=v_counts||jsonb_build_object('contract_products',v_count);
  end if;

  -- Price versions/books are immutable shared pricing evidence and have many
  -- later consumers (quotes, portfolio, invoices). Contract deletion does not
  -- own their garbage collection.
  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'contract_product',coalesce(v_product_id,p_offer_id)::text,
    'contract.delete_unused',to_jsonb(o),null,
    jsonb_build_object('offer_id',p_offer_id,'deleted_rows',v_counts,'preview',v_preview)
  );

  return jsonb_build_object(
    'ok',true,'changed',true,'deleted',true,'mode','deleted',
    'offer_id',p_offer_id,'contract_product_id',v_product_id,
    'deleted_rows',v_counts
  );
end $$;

-- Final source before repair: 20260727030000_contract_operation_readiness_completion.sql
create or replace function public.gridex_publish_contract_channel(
  p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
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
  v_billing_model text;
  v_spot_weight numeric;
  v_portfolio_weight numeric;
  v_fixed_weight numeric;
  v_price_areas text[]:='{}'::text[];
begin
  v_channel:=lower(coalesce(p_channel,''));
  if v_channel not in ('internal','website','api','partner','phone') then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','invalid_contract_channel','channel',v_channel,
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'invalid_contract_channel','channel',
        'Kanalen måste vara internal, website, api, partner eller phone.',to_jsonb(v_channel)
      ))
    );
  end if;
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');

  select * into o from public.contract_offers
  where id=p_offer_id and company_id=p_company_id for update;
  if not found then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_offer_not_found',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_offer_not_found','contract_offer_id',
        'Avtalsversionen hittades inte för valt bolag.',to_jsonb(p_offer_id),
        'contract_offer',p_offer_id
      ))
    );
  end if;

  v_readiness:=public.gridex_validate_contract_readiness_v2(
    p_company_id,p_offer_id,
    case when o.lifecycle_status='paused' then 'resume_channel' else 'activate_channel' end,
    v_channel
  );
  if not coalesce((v_readiness->>'can_execute')::boolean,false) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_channel_not_ready',
      'channel',v_channel,'lifecycle_status',o.lifecycle_status,
      'blockers',coalesce(v_readiness->'blockers','[]'::jsonb),
      'readiness',v_readiness
    );
  end if;
  if o.contract_product_version_id is null or not exists(
    select 1 from public.contract_product_versions pv
    where pv.id=o.contract_product_version_id and pv.status='approved' and pv.locked_at is not null
  ) then
    return jsonb_build_object(
      'ok',false,'changed',false,'code','contract_version_not_locked',
      'blockers',jsonb_build_array(public.gridex_contract_readiness_blocker_v2(
        'contract_version_not_locked','contract_product_version_id',
        'Canonical avtalsversion måste vara approved och låst före kanalaktivering.',
        to_jsonb(o.contract_product_version_id),'contract_product_version',o.contract_product_version_id
      ))
    );
  end if;

  if exists(
    select 1
    from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    join public.contract_publications cp on cp.assignment_id=ta.id and cp.channel=v_channel
    join public.contract_publication_versions cpv
      on cpv.contract_publication_id=cp.id
     and cpv.contract_product_version_id=o.contract_product_version_id
    where ta.company_id=p_company_id
      and ta.contract_product_version_id=o.contract_product_version_id
      and ta.status='active'
      and ch.channel=v_channel and ch.status='active'
      and cp.status='published' and cpv.status='published'
      and (ch.valid_from is null or ch.valid_from<=now())
      and (ch.valid_to is null or ch.valid_to>=now())
      and (
        v_channel<>'website'
        or exists(
          select 1 from public.public_contract_offers pco
          where pco.company_id=p_company_id
            and pco.contract_publication_version_id=cpv.id
            and pco.source_contract_offer_id=o.id
            and pco.lifecycle_status='published'
            and pco.publication_status='published'
            and pco.is_public and pco.website_enabled and pco.website_cta_enabled
        )
      )
  ) then
    return jsonb_build_object(
      'ok',true,'changed',false,'mode','published','code','contract_channel_already_active',
      'channel',v_channel,'contract_product_id',o.contract_product_id,
      'contract_product_version_id',o.contract_product_version_id,
      'blockers','[]'::jsonb
    );
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
  select * into o from public.contract_offers where id=o.id;

  -- The compatibility public-offer row is still consumed by parts of the
  -- website runtime. Derive its presentation fields from the same immutable
  -- commercial snapshot that is locked into the publication version.
  v_billing_model:=coalesce(nullif(o.commercial_snapshot->>'pricing_model',''),o.contract_type);
  v_spot_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,spot_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'spot_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'spot_weight_percent')::numeric end,
    100
  );
  v_portfolio_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,portfolio_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'portfolio_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'portfolio_weight_percent')::numeric end,
    0
  );
  v_fixed_weight:=coalesce(
    case when coalesce(o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot#>>'{portfolio_method,mix_shares,fixed_weight_percent}')::numeric end,
    case when coalesce(o.commercial_snapshot->>'fixed_weight_percent','') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (o.commercial_snapshot->>'fixed_weight_percent')::numeric end,
    0
  );
  select coalesce(array_agg(distinct upper(btrim(area)) order by upper(btrim(area))),'{}'::text[])
  into v_price_areas
  from (
    select value as area
    from jsonb_array_elements_text(
      case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
        then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
    )
    where nullif(btrim(value),'') is not null
    union all
    select unnest(cpv.price_areas)
    from public.contract_product_versions cpv
    where cpv.id=o.contract_product_version_id
      and jsonb_array_length(
        case when jsonb_typeof(o.commercial_snapshot->'price_areas')='array'
          then o.commercial_snapshot->'price_areas' else '[]'::jsonb end
      )=0
  ) areas;

  -- Move only the selected channel from older versions in the same product
  -- series. Other channels stay active until separately switched.
  update public.tenant_contract_channels old_channel
  set status='ended',valid_to=coalesce(old_channel.valid_to,now()),updated_at=now()
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
  set status='ended',valid_to=coalesce(old_publication_version.valid_to,now())
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
    and old_offer.lifecycle_status not in ('archived','expired','closed');

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
  v_offer_reference:=public.gridex_new_offer_reference(concat_ws('|',p_company_id::text,o.version_series_id::text,o.version_number::text,v_channel));
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
        v_billing_model,o.customer_type,
        o.monthly_fee_sek,o.invoice_fee_sek,o.spot_markup_ore_per_kwh,o.variable_fee_ore_per_kwh,
        o.fixed_price_ore_per_kwh,o.green_fee_mode,o.green_fee_value,o.start_fee_sek,o.admin_fee_sek,
        o.break_fee_sek,o.discount_value,o.discount_unit,o.discount_months,o.vat_rate,o.terms_version,
        o.default_binding_months,o.default_notice_months,
        v_spot_weight,v_portfolio_weight,v_fixed_weight,v_price_areas,
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
        public_name=o.name,public_description=o.description,contract_type=o.contract_type,
        billing_model=v_billing_model,customer_type=o.customer_type,
        monthly_fee_sek=o.monthly_fee_sek,invoice_fee_sek=o.invoice_fee_sek,
        spot_markup_ore_per_kwh=o.spot_markup_ore_per_kwh,variable_fee_ore_per_kwh=o.variable_fee_ore_per_kwh,
        fixed_price_ore_per_kwh=o.fixed_price_ore_per_kwh,green_fee_mode=o.green_fee_mode,green_fee_value=o.green_fee_value,
        start_fee_sek=o.start_fee_sek,administration_fee_sek=o.admin_fee_sek,break_fee_sek=o.break_fee_sek,
        discount_value=o.discount_value,discount_unit=o.discount_unit,discount_months=o.discount_months,
        vat_rate=o.vat_rate,terms_version=o.terms_version,binding_months=o.default_binding_months,
        notice_months=o.default_notice_months,
        spot_weight_percent=v_spot_weight,portfolio_weight_percent=v_portfolio_weight,
        fixed_weight_percent=v_fixed_weight,price_areas=v_price_areas,
        automatic_renewal=o.automatic_renewal,
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
end $$;

-- Final source before repair: 20260721123000_contract_lifecycle_unpublish_delete_backfill.sql
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
  set status='ended',valid_to=coalesce(pv.valid_to,now())
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

-- Final source before repair: 20260721170000_contract_graph_api_revision_hardening.sql
create or replace function public.gridex_backfill_contract_lifecycle(
  p_company_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
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

      v_offer_reference:=public.gridex_new_offer_reference(concat_ws('|',o.company_id::text,o.version_series_id::text,o.version_number::text,'website'));
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
          update public.contract_publication_versions backfill_publication_version
          set status='published',valid_to=o.valid_to::timestamptz,
              published_at=coalesce(published_at,po.published_at,now()),locked_at=coalesce(locked_at,now()),
              legacy_public_contract_offer_id=coalesce(legacy_public_contract_offer_id,po.id)
          where id=v_publication_version_id;
        end if;
      else
        if v_publication_version_id is not null then
          perform set_config('gridex.version_transition','on',true);
          update public.contract_publication_versions backfill_publication_version
          set status=case when o.lifecycle_status='archived' then 'archived' else 'ended' end,
              valid_to=coalesce(backfill_publication_version.valid_to,po.archived_at,po.updated_at,now())
          where backfill_publication_version.id=v_publication_version_id and backfill_publication_version.status in ('draft','review','published','paused');
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

-- Final source before repair: 20260726010000_contract_tenant_lifecycle_completion.sql
create or replace function public.gridex_transition_tenant_lifecycle(
  p_company_id uuid,
  p_next_status text,
  p_actor_user_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  c public.companies%rowtype;
  v_before jsonb;
  v_readiness jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_event_id uuid;
begin
  if p_actor_user_id is null or not (
    exists(select 1 from public.admin_users a where a.user_id=p_actor_user_id
      and coalesce(a.is_active,true)
      and lower(coalesce(a.role,'')) in ('super_admin','superadmin','platform_superadmin'))
    or exists(select 1 from public.user_roles ur left join public.roles r on r.id=ur.role_id
      where ur.user_id=p_actor_user_id and coalesce(ur.status,'active')='active'
        and coalesce(ur.is_active,true)
        and lower(coalesce(ur.role,r.key,r.name,'')) in ('super_admin','superadmin','platform_superadmin'))
  ) then
    raise exception using errcode='42501',message='tenant_lifecycle_forbidden';
  end if;
  if p_next_status not in ('active','onboarding','paused','suspended','closed','archived','pending_deletion') then
    raise exception using errcode='22023',message='tenant_lifecycle_status_invalid';
  end if;
  if p_next_status not in ('active','onboarding') and nullif(btrim(coalesce(p_reason,'')),'') is null then
    return jsonb_build_object('ok',false,'changed',false,'code','tenant_reason_required');
  end if;

  select * into c from public.companies where id=p_company_id for update;
  if not found then return jsonb_build_object('ok',false,'changed',false,'code','tenant_not_found'); end if;
  v_before:=to_jsonb(c);
  if c.status='closed' and p_next_status<>'closed' then
    return jsonb_build_object('ok',false,'changed',false,'code','tenant_closed_terminal');
  end if;

  if p_next_status='active' then
    v_readiness:=public.gridex_tenant_activation_readiness(p_company_id);
    if not coalesce((v_readiness->>'ready')::boolean,false) then
      insert into public.company_onboarding_lifecycle(
        company_id,current_step,status,blocking_reasons,last_error_code,updated_at
      ) values(
        p_company_id,'blocked','blocked',coalesce(v_readiness->'blocking_reasons','[]'::jsonb),
        'tenant_not_operationally_ready',now()
      ) on conflict(company_id) do update set
        current_step='blocked',status='blocked',
        blocking_reasons=excluded.blocking_reasons,last_error_code=excluded.last_error_code,updated_at=now();
      return jsonb_build_object(
        'ok',false,'changed',false,'code','tenant_not_operationally_ready',
        'blocking_reasons',v_readiness->'blocking_reasons','readiness',v_readiness
      );
    end if;
  end if;

  if p_next_status='closed' then
    if exists(select 1 from public.customer_contracts cc
      where cc.company_id=p_company_id and cc.status in ('active','signed','current')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_active_customer_contracts','message','Aktiva kundavtal måste överföras eller avslutas.'));
    end if;
    if exists(select 1 from public.supplier_switch_requests s
      where s.company_id=p_company_id and s.status not in ('completed','failed','cancelled','rejected')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_open_supplier_switches','message','Pågående leverantörsbyten måste slutföras.'));
    end if;
    if exists(select 1 from public.billing_underlays b
      where b.company_id=p_company_id and b.status not in ('completed','exported','cancelled','rejected')) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','tenant_has_unsettled_billing','message','Ofärdig fakturering måste regleras.'));
    end if;
    if jsonb_array_length(v_blockers)>0 then
      return jsonb_build_object('ok',false,'changed',false,'code','tenant_closure_blocked',
        'blocking_reasons',v_blockers);
    end if;
  end if;

  update public.companies set
    status=p_next_status,
    status_reason=p_reason,
    is_active=(p_next_status='active'),
    is_paused=(p_next_status in ('paused','suspended','closed','archived','pending_deletion')),
    paused_at=case when p_next_status='paused' then coalesce(paused_at,now()) when p_next_status='active' then null else paused_at end,
    paused_by=case when p_next_status='paused' then p_actor_user_id when p_next_status='active' then null else paused_by end,
    closed_at=case when p_next_status='closed' then coalesce(closed_at,now()) else closed_at end,
    closed_by=case when p_next_status='closed' then p_actor_user_id else closed_by end,
    closure_reason=case when p_next_status='closed' then p_reason else closure_reason end,
    updated_at=now()
  where id=p_company_id;

  if p_next_status in ('paused','suspended','closed','archived','pending_deletion') then
    update public.integration_api_clients
    set status=case when p_next_status='closed' then 'revoked' else 'paused' end,
        revoked_at=case when p_next_status='closed' then coalesce(revoked_at,now()) else revoked_at end,
        revoked_by=case when p_next_status='closed' then p_actor_user_id else revoked_by end,
        revoke_reason=case when p_next_status='closed' then p_reason else revoke_reason end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'tenant_lifecycle_pause',true,'tenant_lifecycle_status',p_next_status
        ),updated_at=now()
    where company_id=p_company_id and status in ('active','paused');

    update public.tenant_contract_channels ch set
      status=case when p_next_status='closed' then 'ended' else 'paused' end,
      valid_to=case when p_next_status='closed' then coalesce(ch.valid_to,now()) else ch.valid_to end,
      updated_by=p_actor_user_id,updated_at=now()
    from public.tenant_contract_assignments ta
    where ch.assignment_id=ta.id and ta.company_id=p_company_id and ch.status='active';

    update public.website_contract_quotes set status='revoked',updated_at=now()
    where company_id=p_company_id and status='active';
  elsif p_next_status='active' then
    update public.integration_api_clients set
      status='active',
      metadata=coalesce(metadata,'{}'::jsonb)-'tenant_lifecycle_pause'-'tenant_lifecycle_status',
      updated_at=now()
    where company_id=p_company_id and status='paused'
      and coalesce((metadata->>'tenant_lifecycle_pause')::boolean,false);
  end if;

  insert into public.company_onboarding_lifecycle(
    company_id,current_step,status,completed_steps,blocking_reasons,
    last_error_code,completed_at,activated_at,updated_at
  ) values(
    p_company_id,
    case when p_next_status='active' then 'activated'
         when p_next_status='onboarding' then 'created' else 'blocked' end,
    case when p_next_status='active' then 'activated'
         when p_next_status='onboarding' then 'in_progress' else 'blocked' end,
    case when p_next_status='active' then array[
      'created','legal_setup','admin_setup','energy_setup','integration_setup',
      'branding_setup','contracts_setup','review','ready','activated'
    ]::text[] else '{}'::text[] end,
    '[]'::jsonb,null,
    case when p_next_status='active' then now() else null end,
    case when p_next_status='active' then now() else null end,now()
  ) on conflict(company_id) do update set
    current_step=excluded.current_step,status=excluded.status,
    completed_steps=case when p_next_status='active' then excluded.completed_steps
      else public.company_onboarding_lifecycle.completed_steps end,
    blocking_reasons='[]'::jsonb,last_error_code=null,
    completed_at=case when p_next_status='active' then now()
      else public.company_onboarding_lifecycle.completed_at end,
    activated_at=case when p_next_status='active' then now()
      else public.company_onboarding_lifecycle.activated_at end,
    updated_at=now();

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
  ) values(
    p_company_id,p_actor_user_id,'company',p_company_id::text,
    'tenant.'||p_next_status,v_before,
    jsonb_build_object('status',p_next_status,'reason',p_reason),
    jsonb_build_object('previous_status',c.status,'next_status',p_next_status)
  );
  insert into public.domain_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,source,idempotency_key,payload
  ) values(
    p_company_id,'tenant.'||p_next_status,'company',p_company_id::text,p_actor_user_id,'database',
    format('tenant.%s:%s:%s',p_next_status,p_company_id,extract(epoch from now())::bigint),
    jsonb_build_object('previous_status',c.status,'status',p_next_status,'reason',p_reason)
  ) returning id into v_event_id;
  insert into public.event_outbox(company_id,domain_event_id,destination_type,destination_key,payload)
  values(p_company_id,v_event_id,'internal','tenant.'||p_next_status,
    jsonb_build_object('domain_event_id',v_event_id,'event_type','tenant.'||p_next_status))
  on conflict do nothing;

  return jsonb_build_object('ok',true,'changed',c.status is distinct from p_next_status,
    'mode',p_next_status,'previous_status',c.status,'status',p_next_status,'event_id',v_event_id);
end $$;

-- Sensitive contract lifecycle RPCs are server/service-role only.
revoke all on function public.gridex_sync_public_offer_to_canonical(uuid) from public,anon,authenticated;
grant execute on function public.gridex_sync_public_offer_to_canonical(uuid) to service_role;
revoke all on function public.gridex_sync_internal_offer_to_canonical(uuid) from public,anon,authenticated;
grant execute on function public.gridex_sync_internal_offer_to_canonical(uuid) to service_role;
revoke all on function public.gridex_pause_contract_channels(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_pause_contract_channels(uuid,uuid,uuid) to service_role;
revoke all on function public.gridex_archive_contract_product(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_archive_contract_product(uuid,uuid,uuid) to service_role;
revoke all on function public.gridex_delete_unused_contract(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.gridex_delete_unused_contract(uuid,uuid,uuid) to service_role;
revoke all on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) to service_role;
revoke all on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.gridex_unpublish_contract_channel(uuid,uuid,text,uuid) to service_role;
revoke all on function public.gridex_backfill_contract_lifecycle(uuid) from public,anon,authenticated;
grant execute on function public.gridex_backfill_contract_lifecycle(uuid) to service_role;
revoke all on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.gridex_transition_tenant_lifecycle(uuid,text,uuid,text) to service_role;

comment on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) is
  'Canonical channel publication RPC. Final valid_to-qualified source of truth after 20260727030000.';
comment on function public.gridex_archive_contract_product(uuid,uuid,uuid) is
  'Atomic idempotent contract archive RPC. Preserves history and qualifies every valid_to reference.';

commit;
