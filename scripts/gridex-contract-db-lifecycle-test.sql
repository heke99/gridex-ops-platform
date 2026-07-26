\set ON_ERROR_STOP on
\if :{?company_id}
\else
  \echo 'Missing -v company_id=<uuid>'
  \quit 2
\endif
\if :{?actor_id}
\else
  \echo 'Missing -v actor_id=<uuid>'
  \quit 2
\endif

begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('gridex.contract_test_company_id', :'company_id', true);
select set_config('gridex.contract_test_actor_id', :'actor_id', true);

do $test$
declare
  v_company_id uuid:=current_setting('gridex.contract_test_company_id')::uuid;
  v_actor_id uuid:=current_setting('gridex.contract_test_actor_id')::uuid;
  v_token text:=to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  v_payload jsonb;
  v_snapshot jsonb;
  v_created jsonb;
  v_published jsonb;
  v_website_first jsonb;
  v_website_second jsonb;
  v_successor jsonb;
  v_successor_published jsonb;
  v_successor_website jsonb;
  v_deleted jsonb;
  v_archived jsonb;
  v_delete_preview jsonb;
  v_delete_created jsonb;
  v_delete_offer_id uuid;
  v_delete_public_offer_id uuid;
  v_stale_publication_version_id uuid;
  v_graph jsonb;
  v_blocked jsonb;
  v_offer_id uuid;
  v_successor_id uuid;
  v_product_id uuid;
  v_product_version_id uuid;
  v_price_version_id uuid;
  v_price_book_id uuid;
  v_publication_version_id uuid;
  v_count bigint;
begin
  if not exists(select 1 from public.companies where id=v_company_id) then
    raise exception 'contract_test_company_not_found';
  end if;

  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_pricing_v5',
    'pricing_model','spot',
    'vat_rate',0.25,
    'price_areas',jsonb_build_array('SE1','SE2','SE3','SE4'),
    'spot_interval_resolution','hourly',
    'base_components',jsonb_build_array(
      jsonb_build_object(
        'source_type','nord_pool_spot','label','Spotpris','weight_percent',100,
        'price_area','SE3','metadata',jsonb_build_object('test',true)
      )
    ),
    'price_components',jsonb_build_array(
      jsonb_build_object('component_code','spot_markup','component_type','markup','name','Påslag','calculation_type','per_kwh','amount',4.125,'unit','ore_per_kwh','website_card_visible',true),
      jsonb_build_object('component_code','monthly_fee','component_type','fee','name','Månadsavgift','calculation_type','fixed_monthly','amount',49.75,'unit','sek_month','website_card_visible',true),
      jsonb_build_object('component_code','invoice_fee','component_type','fee','name','Fakturaavgift','calculation_type','per_invoice','amount',19.25,'unit','sek_invoice','website_card_visible',true),
      jsonb_build_object('component_code','optional_roundtrip','component_type','fee','name','Roundtripavgift','calculation_type','fixed_monthly','amount',12.5,'unit','sek_month','website_card_visible',false)
    ),
    'optional_fees',jsonb_build_array(
      jsonb_build_object(
        'id','optional_roundtrip','label','Roundtripavgift','amount',12.5,
        'unit','sek_month','calculation_base',null,'billing_frequency','monthly',
        'lifecycle','recurring','website_visibility',false,
        'vat_treatment','standard','sort_order',1
      )
    ),
    'website_card_visibility',jsonb_build_object(
      'spot_markup',true,'monthly_fee',true,'invoice_fee',true,'optional_fees',false
    )
  );

  v_payload:=jsonb_build_object(
    'name','GRIDEX DB LIFECYCLE '||v_token,
    'slug','gridex-db-lifecycle-'||lower(v_token),
    'lifecycle_status','draft',
    'contract_type','variable_hourly',
    'customer_type','both',
    'pricing_model','spot',
    'terms_version','test-v1',
    'description','Rollback-only canonical contract lifecycle verification',
    'max_customers',7,
    'discount_value',10,
    'discount_unit','percent',
    'discount_calculation_base','monthly_fee',
    'discount_months',3,
    'discount_starts_on_mode','contract_start',
    'vat_rate',25,
    'spot_markup_ore_per_kwh',4.125,
    'monthly_fee_sek',49.75,
    'invoice_fee_sek',19.25,
    'default_binding_months',0,
    'default_notice_months',1,
    'automatic_renewal',true,
    'automatic_renewal_term_months',12,
    'power_of_attorney_required',true,
    'power_of_attorney_mode','required_when_information_missing',
    'valid_from',current_date::text,
    'optional_fee_lines',v_snapshot->'optional_fees'
  );

  v_created:=public.gridex_upsert_internal_contract_offer(
    v_company_id,null,v_payload,v_snapshot,v_actor_id
  );
  v_offer_id:=(v_created#>>'{offer,id}')::uuid;
  v_product_id:=(v_created->>'contract_product_id')::uuid;
  v_product_version_id:=(v_created->>'contract_product_version_id')::uuid;
  v_price_version_id:=(v_created#>>'{offer,price_plan_version_id}')::uuid;
  v_price_book_id:=(v_created#>>'{offer,price_book_id}')::uuid;

  if v_offer_id is null or v_product_id is null or v_product_version_id is null
     or v_price_version_id is null or v_price_book_id is null then
    raise exception 'draft_canonical_identity_missing:%',v_created;
  end if;
  if coalesce((select currently_sellable from public.canonical_internal_contract_offers_v where id=v_offer_id),true) then
    raise exception 'draft_became_sellable';
  end if;
  if abs(coalesce((select vat_rate from public.contract_offers where id=v_offer_id),-1)-0.25)>0.000001 then
    raise exception 'vat_percent_input_was_not_normalized_to_fraction';
  end if;

  v_published:=public.gridex_publish_internal_contract_version(
    v_company_id,v_offer_id,v_actor_id
  );
  if (v_published->>'contract_product_id')::uuid<>v_product_id
     or (v_published->>'contract_product_version_id')::uuid<>v_product_version_id
     or (v_published->>'price_plan_version_id')::uuid<>v_price_version_id
     or (v_published->>'price_book_id')::uuid<>v_price_book_id then
    raise exception 'publication_changed_canonical_identity:%',v_published;
  end if;
  if not coalesce((select currently_sellable from public.canonical_internal_contract_offers_v where id=v_offer_id),false) then
    raise exception 'published_internal_version_not_sellable';
  end if;

  v_website_first:=public.gridex_publish_contract_channel(
    v_company_id,v_offer_id,'website',v_actor_id
  );
  v_publication_version_id:=(v_website_first->>'contract_publication_version_id')::uuid;
  if v_publication_version_id is null then
    raise exception 'website_publication_identity_missing:%',v_website_first;
  end if;
  if coalesce(v_website_first->>'offer_reference','') !~ '^offer_[0-9a-f]{64}$' then
    raise exception 'new_offer_reference_is_not_opaque:%',v_website_first;
  end if;
  if coalesce((
    select revision from public.contract_publication_revisions
    where company_id=v_company_id and channel='website'
  ),0)<=0 then
    raise exception 'website_publication_revision_was_not_bumped';
  end if;
  if not exists(
    select 1 from public.public_contract_offers po
    where po.id=(v_website_first->>'public_contract_offer_id')::uuid
      and po.source_contract_offer_id=v_offer_id
      and po.contract_product_id=v_product_id
      and po.contract_product_version_id=v_product_version_id
      and po.contract_publication_version_id=v_publication_version_id
      and po.is_public and po.website_enabled and po.publication_status='published'
  ) then
    raise exception 'website_offer_not_bound_to_same_canonical_version';
  end if;

  perform public.gridex_unpublish_contract_channel(
    v_company_id,v_offer_id,'website',v_actor_id
  );
  if exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id=v_offer_id
      and (is_public or website_enabled or website_cta_enabled or publication_status='published')
  ) then
    raise exception 'website_channel_remained_public';
  end if;

  v_website_second:=public.gridex_publish_contract_channel(
    v_company_id,v_offer_id,'website',v_actor_id
  );
  if (v_website_second->>'contract_publication_version_id')::uuid<>v_publication_version_id then
    raise exception 'unchanged_republication_created_new_publication_identity';
  end if;
  if not exists(
    select 1 from public.contract_publication_versions
    where id=v_publication_version_id and status='published' and locked_at is not null
  ) then
    raise exception 'republished_publication_version_not_active';
  end if;

  -- Create a changed successor draft. The currently published predecessor must
  -- remain sellable until the successor is explicitly published.
  v_payload:=jsonb_set(v_payload,'{monthly_fee_sek}','50.75'::jsonb,true);
  v_payload:=jsonb_set(v_payload,'{vat_rate}','0.25'::jsonb,true);
  v_payload:=jsonb_set(v_payload,'{lifecycle_status}','"draft"'::jsonb,true);
  v_snapshot:=jsonb_set(
    v_snapshot,'{price_components,1,amount}','50.75'::jsonb,true
  );
  v_successor:=public.gridex_upsert_internal_contract_offer(
    v_company_id,v_offer_id,v_payload,v_snapshot,v_actor_id
  );
  v_successor_id:=(v_successor#>>'{offer,id}')::uuid;
  if v_successor_id is null or v_successor_id=v_offer_id then
    raise exception 'successor_draft_not_created:%',v_successor;
  end if;
  if (select lifecycle_status from public.contract_offers where id=v_offer_id)<>'published'
     or not coalesce((select currently_sellable from public.canonical_internal_contract_offers_v where id=v_offer_id),false) then
    raise exception 'predecessor_was_replaced_before_successor_publication';
  end if;
  if coalesce((select currently_sellable from public.canonical_internal_contract_offers_v where id=v_successor_id),true) then
    raise exception 'successor_draft_became_sellable';
  end if;
  if abs(coalesce((select vat_rate from public.contract_offers where id=v_successor_id),-1)-0.25)>0.000001 then
    raise exception 'canonical_fraction_input_was_not_preserved';
  end if;

  v_deleted:=public.gridex_delete_unused_contract(
    v_company_id,v_successor_id,v_actor_id
  );
  if not coalesce((v_deleted->>'ok')::boolean,false)
     or coalesce(v_deleted->>'mode','')<>'deleted' then
    raise exception 'unused_successor_not_deleted:%',v_deleted;
  end if;
  if not exists(select 1 from public.contract_offers where id=v_offer_id and lifecycle_status='published') then
    raise exception 'deleting_successor_removed_predecessor';
  end if;

  -- Recreate the successor and exercise a channel-by-channel handover. Internal
  -- publication must not create a website outage; the predecessor website stays
  -- public until the successor website channel is explicitly published.
  v_successor:=public.gridex_upsert_internal_contract_offer(
    v_company_id,v_offer_id,v_payload,v_snapshot,v_actor_id
  );
  v_successor_id:=(v_successor#>>'{offer,id}')::uuid;
  v_successor_published:=public.gridex_publish_internal_contract_version(
    v_company_id,v_successor_id,v_actor_id
  );
  if not coalesce((v_successor_published->>'ok')::boolean,false) then
    raise exception 'successor_internal_publication_failed:%',v_successor_published;
  end if;
  if (select lifecycle_status from public.contract_offers where id=v_offer_id)<>'published' then
    raise exception 'predecessor_website_was_superseded_by_internal_handover';
  end if;
  if exists(
    select 1 from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=v_company_id
      and ta.contract_product_version_id=v_product_version_id
      and ch.channel='internal' and ch.status='active'
  ) then
    raise exception 'predecessor_internal_channel_remained_active';
  end if;
  if not exists(
    select 1 from public.tenant_contract_assignments ta
    join public.tenant_contract_channels ch on ch.assignment_id=ta.id
    where ta.company_id=v_company_id
      and ta.contract_product_version_id=v_product_version_id
      and ta.status='active' and ch.channel='website' and ch.status='active'
  ) then
    raise exception 'predecessor_website_channel_was_closed_too_early';
  end if;
  if not exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id=v_offer_id
      and is_public and website_enabled and publication_status='published'
  ) then
    raise exception 'predecessor_public_offer_was_closed_too_early';
  end if;

  v_successor_website:=public.gridex_publish_contract_channel(
    v_company_id,v_successor_id,'website',v_actor_id
  );
  if not coalesce((v_successor_website->>'ok')::boolean,false) then
    raise exception 'successor_website_publication_failed:%',v_successor_website;
  end if;
  if (select lifecycle_status from public.contract_offers where id=v_offer_id)<>'superseded' then
    raise exception 'predecessor_not_superseded_after_website_handover';
  end if;
  if exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id=v_offer_id
      and (is_public or website_enabled or website_cta_enabled or publication_status='published')
  ) then
    raise exception 'predecessor_public_offer_remained_after_website_handover';
  end if;
  if not exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id=v_successor_id
      and is_public and website_enabled and publication_status='published'
  ) then
    raise exception 'successor_public_offer_not_active_after_handover';
  end if;

  v_archived:=public.gridex_archive_contract_product(
    v_company_id,v_successor_id,v_actor_id
  );
  if not coalesce((v_archived->>'ok')::boolean,false) then
    raise exception 'archive_failed:%',v_archived;
  end if;
  select count(*) into v_count
  from public.contract_offers
  where company_id=v_company_id and version_series_id=(
    select version_series_id from public.contract_offers where id=v_offer_id
  ) and lifecycle_status<>'archived';
  if v_count<>0 then
    raise exception 'archive_did_not_close_entire_series:%',v_count;
  end if;
  if exists(
    select 1 from public.public_contract_offers
    where source_contract_offer_id=v_offer_id
      and (is_public or website_enabled or website_cta_enabled)
  ) then
    raise exception 'archive_left_public_channel_enabled';
  end if;

  -- Regression: a contract that was published and then unpublished, but never
  -- used by a customer, remains permanently deletable together with its
  -- exclusive technical publication graph.
  v_payload:=jsonb_set(v_payload,'{name}',to_jsonb('GRIDEX DELETE ROUNDTRIP '||v_token),true);
  v_payload:=jsonb_set(v_payload,'{slug}',to_jsonb('gridex-delete-roundtrip-'||lower(v_token)),true);
  v_payload:=jsonb_set(v_payload,'{lifecycle_status}','"draft"'::jsonb,true);
  v_delete_created:=public.gridex_upsert_internal_contract_offer(
    v_company_id,null,v_payload,v_snapshot,v_actor_id
  );
  v_delete_offer_id:=(v_delete_created#>>'{offer,id}')::uuid;
  perform public.gridex_publish_internal_contract_version(v_company_id,v_delete_offer_id,v_actor_id);
  perform public.gridex_publish_contract_channel(v_company_id,v_delete_offer_id,'website',v_actor_id);
  perform public.gridex_unpublish_contract_channel(v_company_id,v_delete_offer_id,'website',v_actor_id);
  if not coalesce((select ta.website_publication_allowed
      from public.tenant_contract_assignments ta
      join public.contract_offers o on o.contract_product_version_id=ta.contract_product_version_id
      where o.id=v_delete_offer_id),false) then
    raise exception 'unpublish_removed_website_permission';
  end if;
  perform public.gridex_unpublish_contract_channel(v_company_id,v_delete_offer_id,'internal',v_actor_id);

  -- Reproduce the production FK shape: a publication version outside the
  -- delete target's normal assignment tree directly references the public
  -- offer through legacy_public_contract_offer_id. The resolver must find it
  -- without first filtering by the target publication ids, and delete must
  -- return a domain blocker rather than leaking SQLSTATE 23503.
  select id into v_delete_public_offer_id
  from public.public_contract_offers
  where source_contract_offer_id=v_delete_offer_id
  order by created_at desc,id desc
  limit 1;
  select cpv.id into v_stale_publication_version_id
  from public.contract_publication_versions cpv
  join public.public_contract_offers po on po.contract_publication_version_id=cpv.id
  where po.source_contract_offer_id=v_offer_id
    and cpv.id is distinct from (
      select contract_publication_version_id
      from public.public_contract_offers
      where id=v_delete_public_offer_id
    )
  order by cpv.created_at desc,cpv.id desc
  limit 1;
  if v_delete_public_offer_id is null or v_stale_publication_version_id is null then
    raise exception 'fk_reproducer_fixture_missing';
  end if;

  perform set_config('gridex.version_transition','on',true);
  perform set_config('gridex.publication_link_repair','on',true);
  update public.contract_publication_versions
  set legacy_public_contract_offer_id=v_delete_public_offer_id
  where id=v_stale_publication_version_id;

  v_graph:=public.gridex_resolve_contract_lifecycle_graph(v_company_id,v_delete_offer_id);
  if not (v_graph->'direct_reverse_legacy_publication_version_ids' @> to_jsonb(array[v_stale_publication_version_id])) then
    raise exception 'direct_reverse_reference_was_not_resolved:%',v_graph;
  end if;
  v_delete_preview:=public.gridex_preview_delete_unused_contract(v_company_id,v_delete_offer_id);
  if coalesce((v_delete_preview->>'can_delete')::boolean,true)
     or not (coalesce(v_delete_preview->'reason_codes','[]'::jsonb) ? 'PUBLICATION_PRODUCT_VERSION_MISMATCH') then
    raise exception 'preview_promised_unsafe_delete:%',v_delete_preview;
  end if;
  v_blocked:=public.gridex_delete_unused_contract(v_company_id,v_delete_offer_id,v_actor_id);
  if coalesce((v_blocked->>'ok')::boolean,true)
     or coalesce(v_blocked->>'mode','')<>'blocked' then
    raise exception 'delete_did_not_return_structured_graph_blocker:%',v_blocked;
  end if;
  if not exists(select 1 from public.contract_offers where id=v_delete_offer_id) then
    raise exception 'blocked_delete_removed_offer';
  end if;

  update public.contract_publication_versions
  set legacy_public_contract_offer_id=null
  where id=v_stale_publication_version_id
    and legacy_public_contract_offer_id=v_delete_public_offer_id;

  v_delete_preview:=public.gridex_preview_delete_unused_contract(v_company_id,v_delete_offer_id);
  if coalesce((v_delete_preview->>'can_delete')::boolean,true)
     or not (coalesce(v_delete_preview->'reason_codes','[]'::jsonb) ? 'PERMANENT_DELETE_REQUIRES_DRAFT')
     or coalesce((v_delete_preview->>'has_business_usage')::boolean,true) then
    raise exception 'previously_published_contract_delete_boundary_failed:%',v_delete_preview;
  end if;
  v_blocked:=public.gridex_delete_unused_contract(v_company_id,v_delete_offer_id,v_actor_id);
  if coalesce((v_blocked->>'ok')::boolean,true)
     or coalesce(v_blocked->>'mode','')<>'blocked'
     or not exists(select 1 from public.contract_offers where id=v_delete_offer_id) then
    raise exception 'previously_published_contract_was_not_preserved:%',v_blocked;
  end if;

  raise notice 'Gridex contract lifecycle DB test passed for temporary offers %, %',v_offer_id,v_delete_offer_id;
end
$test$;

rollback;
\echo 'Gridex contract DB lifecycle test passed and rolled back.'
