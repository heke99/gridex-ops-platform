\set ON_ERROR_STOP on
\if :{?company_a_id}
\else
  \echo 'Missing -v company_a_id=<uuid>'
  \quit 2
\endif
\if :{?company_b_id}
\else
  \echo 'Missing -v company_b_id=<uuid>'
  \quit 2
\endif
\if :{?actor_id}
\else
  \echo 'Missing -v actor_id=<uuid>'
  \quit 2
\endif

begin;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('gridex.contract_test_company_a_id', :'company_a_id', true);
select set_config('gridex.contract_test_company_b_id', :'company_b_id', true);
select set_config('gridex.contract_test_actor_id', :'actor_id', true);

do $test$
declare
  v_company_a uuid:=current_setting('gridex.contract_test_company_a_id')::uuid;
  v_company_b uuid:=current_setting('gridex.contract_test_company_b_id')::uuid;
  v_actor_id uuid:=current_setting('gridex.contract_test_actor_id')::uuid;
  v_token text:=to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
  v_snapshot jsonb;
  v_payload jsonb;
  v_created jsonb;
  v_published jsonb;
  v_graph jsonb;
  v_preview jsonb;
  v_offer_id uuid;
  v_offer_reference text;
  v_cross_count bigint;
begin
  if v_company_a=v_company_b then
    raise exception 'multitenant_test_requires_two_distinct_companies';
  end if;
  if not exists(select 1 from public.companies where id=v_company_a)
     or not exists(select 1 from public.companies where id=v_company_b) then
    raise exception 'multitenant_test_company_missing';
  end if;

  v_snapshot:=jsonb_build_object(
    'schema','gridex_contract_pricing_v5',
    'pricing_model','spot',
    'vat_rate',0.25,
    'price_areas',jsonb_build_array('SE3'),
    'base_components',jsonb_build_array(
      jsonb_build_object('source_type','nord_pool_spot','label','Spotpris','weight_percent',100,'price_area','SE3')
    ),
    'price_components',jsonb_build_array(
      jsonb_build_object('component_code','spot_markup','component_type','markup','name','Påslag','calculation_type','per_kwh','amount',4,'unit','ore_per_kwh','website_card_visible',true),
      jsonb_build_object('component_code','monthly_fee','component_type','fee','name','Månadsavgift','calculation_type','fixed_monthly','amount',49,'unit','sek_month','website_card_visible',true),
      jsonb_build_object('component_code','invoice_fee','component_type','fee','name','Fakturaavgift','calculation_type','per_invoice','amount',19,'unit','sek_invoice','website_card_visible',true)
    )
  );
  v_payload:=jsonb_build_object(
    'name','MULTITENANT ISOLATION '||v_token,
    'slug','multitenant-isolation-'||lower(v_token),
    'lifecycle_status','draft',
    'contract_type','variable_hourly',
    'customer_type','both',
    'pricing_model','spot',
    'terms_version','test-v1',
    'spot_markup_ore_per_kwh',4,
    'monthly_fee_sek',49,
    'invoice_fee_sek',19,
    'default_binding_months',0,
    'default_notice_months',1,
    'automatic_renewal',true,
    'automatic_renewal_term_months',12,
    'power_of_attorney_required',true,
    'valid_from',current_date::text
  );

  v_created:=public.gridex_upsert_internal_contract_offer(
    v_company_a,null,v_payload,v_snapshot,v_actor_id
  );
  v_offer_id:=(v_created#>>'{offer,id}')::uuid;
  if v_offer_id is null then
    raise exception 'multitenant_fixture_offer_missing:%',v_created;
  end if;

  v_graph:=public.gridex_resolve_contract_lifecycle_graph(v_company_b,v_offer_id);
  if coalesce((v_graph->>'ok')::boolean,true)
     or coalesce(v_graph->>'code','')<>'contract_offer_not_found' then
    raise exception 'tenant_b_resolved_tenant_a_offer:%',v_graph;
  end if;
  v_preview:=public.gridex_preview_delete_unused_contract(v_company_b,v_offer_id);
  if coalesce((v_preview->>'can_delete')::boolean,true) then
    raise exception 'tenant_b_previewed_tenant_a_offer_as_deletable:%',v_preview;
  end if;

  begin
    perform public.gridex_publish_internal_contract_version(v_company_b,v_offer_id,v_actor_id);
    raise exception 'tenant_b_published_tenant_a_offer';
  exception when others then
    if sqlerrm='tenant_b_published_tenant_a_offer' then raise; end if;
  end;

  perform public.gridex_publish_internal_contract_version(v_company_a,v_offer_id,v_actor_id);
  v_published:=public.gridex_publish_contract_channel(v_company_a,v_offer_id,'website',v_actor_id);
  v_offer_reference:=v_published->>'offer_reference';
  if coalesce(v_offer_reference,'') !~ '^offer_[0-9a-f]{64}$' then
    raise exception 'multitenant_offer_reference_invalid:%',v_published;
  end if;

  select count(*) into v_cross_count
  from public.canonical_public_contract_offers_v
  where company_id=v_company_b
    and canonical_offer_reference=v_offer_reference;
  if v_cross_count<>0 then
    raise exception 'tenant_b_feed_exposed_tenant_a_reference:%',v_offer_reference;
  end if;
  if not exists(
    select 1 from public.canonical_public_contract_offers_v
    where company_id=v_company_a
      and canonical_offer_reference=v_offer_reference
  ) then
    raise exception 'tenant_a_feed_missing_own_reference:%',v_offer_reference;
  end if;

  begin
    perform public.gridex_delete_unused_contract(v_company_b,v_offer_id,v_actor_id);
    raise exception 'tenant_b_deleted_tenant_a_offer';
  exception when others then
    if sqlerrm='tenant_b_deleted_tenant_a_offer' then raise; end if;
  end;

  raise notice 'Gridex contract multitenant isolation DB test passed for offer %',v_offer_id;
end
$test$;

rollback;
\echo 'Gridex contract multitenant isolation DB test passed and rolled back.'
