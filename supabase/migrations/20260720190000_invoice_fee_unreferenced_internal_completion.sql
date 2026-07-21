-- Complete invoice-fee remediation for legacy internal offers that are
-- unpublished and have no customer/version references.
-- These rows may be updated in place without mutating signed or published history.

begin;

alter table public.contract_invoice_fee_remediation_tasks
  drop constraint if exists contract_invoice_fee_remediation_tasks_blocker_code_check;
alter table public.contract_invoice_fee_remediation_tasks
  add constraint contract_invoice_fee_remediation_tasks_blocker_code_check
  check(blocker_code is null or blocker_code in(
    'invoice_fee_missing','invoice_fee_conflict','invoice_fee_ambiguous',
    'tenant_context_missing','tenant_context_conflict',
    'legacy_snapshot_completion_failed'
  ));

create or replace function public.gridex_legacy_internal_offer_pricing_snapshot(
  p_offer_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.contract_offers%rowtype;
  v_existing jsonb;
  v_components jsonb := '[]'::jsonb;
  v_base_components jsonb := '[]'::jsonb;
  v_retained jsonb := '[]'::jsonb;
  v_visibility jsonb;
  v_price_areas jsonb;
  v_pricing_model text;
  v_interval_resolution text;
  v_code text;
  v_component jsonb;
begin
  select * into o
  from public.contract_offers
  where id=p_offer_id;

  if not found then
    raise exception using errcode='P0002',message='internal_contract_offer_not_found';
  end if;

  v_existing := case
    when jsonb_typeof(o.commercial_snapshot)='object' and o.commercial_snapshot<>'{}'::jsonb
      then o.commercial_snapshot
    when jsonb_typeof(o.version_snapshot->'pricing_snapshot')='object'
      then o.version_snapshot->'pricing_snapshot'
    else '{}'::jsonb
  end;

  v_visibility := coalesce(v_existing->'website_visibility','{}'::jsonb);
  v_price_areas := case
    when jsonb_typeof(v_existing->'price_areas')='array' then v_existing->'price_areas'
    when jsonb_typeof(o.version_snapshot#>'{pricing,priceAreas}')='array' then o.version_snapshot#>'{pricing,priceAreas}'
    else '[]'::jsonb
  end;

  v_pricing_model := case
    when o.contract_type='fixed' then 'fixed'
    when o.contract_type='portfolio' then 'portfolio'
    when o.contract_type='mixed' then 'mixed'
    else 'spot'
  end;

  v_interval_resolution := case
    when o.contract_type='variable_hourly' then 'hourly'
    when o.contract_type='variable_quarterly' then 'quarterly'
    when o.contract_type='fixed' then 'fixed'
    when o.contract_type='portfolio' then 'portfolio'
    else 'monthly'
  end;

  if jsonb_typeof(v_existing->'base_components')='array'
     and jsonb_array_length(v_existing->'base_components')>0 then
    v_base_components:=v_existing->'base_components';
  elsif o.contract_type='fixed' then
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'source_type','fixed','label','Fast pris','weight_percent',100,
      'fixed_price_sek_per_kwh',case when o.fixed_price_ore_per_kwh is null then null else o.fixed_price_ore_per_kwh/100 end,
      'price_area',area
    ))),'[]'::jsonb)
    into v_base_components
    from (
      select value as area from jsonb_array_elements_text(v_price_areas)
      union all
      select null where jsonb_array_length(v_price_areas)=0
    ) areas;
  else
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'source_type','spot','label','Spotpris','weight_percent',100,
      'fixed_price_sek_per_kwh',null,'price_area',area
    ))),'[]'::jsonb)
    into v_base_components
    from (
      select value as area from jsonb_array_elements_text(v_price_areas)
      union all
      select null where jsonb_array_length(v_price_areas)=0
    ) areas;
  end if;

  -- Preserve unknown/extension components, but replace all compatibility
  -- components from the row with one canonical representation.
  if jsonb_typeof(v_existing->'price_components')='array' then
    select coalesce(jsonb_agg(component order by ordinal),'[]'::jsonb)
      into v_retained
    from jsonb_array_elements(v_existing->'price_components') with ordinality rows(component,ordinal)
    where coalesce(
      nullif(component->>'component_code',''),
      nullif(component->>'component_type',''),
      nullif(component#>>'{metadata,component_code}','')
    ) not in(
      'monthly_fee','invoice_fee','spot_markup','variable_fee','green_energy_fee',
      'start_fee','administration_fee','admin_fee','break_fee'
    );
  end if;

  v_components := v_retained;

  if o.monthly_fee_sek is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','monthly_fee','component_type','monthly_fee','name','Månadsavgift',
      'amount',o.monthly_fee_sek,'calculation_type','per_month','unit','sek_month',
      'priority',100,'status','active',
      'website_card_visible',coalesce((v_visibility->>'monthly_fee')::boolean,true),
      'metadata',jsonb_build_object('lifecycle','per_month')
    ));
  end if;

  if o.invoice_fee_sek is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','invoice_fee','component_type','invoice_fee','name','Fakturaavgift',
      'amount',o.invoice_fee_sek,'calculation_type','per_invoice','unit','sek_invoice',
      'priority',110,'status','active',
      'website_card_visible',coalesce((v_visibility->>'invoice_fee')::boolean,false),
      'metadata',jsonb_build_object(
        'lifecycle','per_invoice',
        'visibility',jsonb_build_object(
          'website_card',coalesce((v_visibility->>'invoice_fee')::boolean,false),
          'quote_breakdown',true,'checkout',true,'contract_document',true,'invoice',true
        )
      )
    ));
  end if;

  if o.spot_markup_ore_per_kwh is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','spot_markup','component_type','spot_markup','name','Spotpåslag',
      'amount',o.spot_markup_ore_per_kwh,'calculation_type','per_kwh','unit','ore_per_kwh',
      'priority',130,'status','active',
      'website_card_visible',coalesce((v_visibility->>'spot_markup')::boolean,true),
      'metadata',jsonb_build_object('replaces_legacy_markup',true)
    ));
  end if;

  if o.variable_fee_ore_per_kwh is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','variable_fee','component_type','variable_fee','name','Rörlig avgift',
      'amount',o.variable_fee_ore_per_kwh,'calculation_type','per_kwh','unit','ore_per_kwh',
      'priority',140,'status','active',
      'website_card_visible',coalesce((v_visibility->>'variable_fee')::boolean,true),
      'metadata','{}'::jsonb
    ));
  end if;

  if o.green_fee_value is not null and coalesce(o.green_fee_mode,'none')<>'none' then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','green_energy_fee','component_type','green_energy_fee','name','Grön el-avgift',
      'amount',o.green_fee_value,
      'calculation_type',case when o.green_fee_mode='sek_month' then 'per_month' else 'per_kwh' end,
      'unit',case when o.green_fee_mode='sek_month' then 'sek_month' else 'ore_per_kwh' end,
      'priority',150,'status','active',
      'website_card_visible',coalesce((v_visibility->>'green_energy_fee')::boolean,true),
      'metadata','{}'::jsonb
    ));
  end if;

  if o.start_fee_sek is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','start_fee','component_type','start_fee','name','Startavgift',
      'amount',o.start_fee_sek,'calculation_type','fixed_once','unit','sek_once',
      'priority',200,'status','active','website_card_visible',false,'metadata','{}'::jsonb
    ));
  end if;

  if o.admin_fee_sek is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','administration_fee','component_type','administration_fee','name','Administrationsavgift',
      'amount',o.admin_fee_sek,'calculation_type','per_month','unit','sek_month',
      'priority',210,'status','active','website_card_visible',false,'metadata','{}'::jsonb
    ));
  end if;

  if o.break_fee_sek is not null then
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'component_code','break_fee','component_type','break_fee','name','Brytavgift',
      'amount',o.break_fee_sek,'calculation_type','fixed_once','unit','sek_once',
      'priority',220,'status','active','website_card_visible',false,'metadata','{}'::jsonb
    ));
  end if;

  return jsonb_strip_nulls(
    v_existing || jsonb_build_object(
      'schema_version',5,
      'contract_type',o.contract_type,
      'customer_type',o.customer_type,
      'pricing_model',v_pricing_model,
      'price_areas',v_price_areas,
      'valid_from',o.valid_from,
      'valid_to',o.valid_to,
      'binding_months',o.default_binding_months,
      'notice_months',o.default_notice_months,
      'automatic_renewal',coalesce(o.automatic_renewal,false),
      'power_of_attorney_required',coalesce(o.power_of_attorney_required,true),
      'base_components',v_base_components,
      'price_components',v_components,
      'website_visibility',v_visibility || jsonb_build_object(
        'invoice_fee',coalesce((v_visibility->>'invoice_fee')::boolean,false)
      ),
      'vat_rate',case when coalesce(o.vat_rate,0.25)>1 then o.vat_rate/100 else coalesce(o.vat_rate,0.25) end,
      'vat_rate_percent',case when coalesce(o.vat_rate,0.25)>1 then o.vat_rate else coalesce(o.vat_rate,0.25)*100 end,
      'interval_resolution',v_interval_resolution,
      'legacy_source',jsonb_build_object(
        'table','contract_offers','offer_id',o.id,'completed_at',now()
      )
    )
  );
end $$;

comment on function public.gridex_legacy_internal_offer_pricing_snapshot(uuid) is
  'Builds a full schema-v5 pricing snapshot from an unreferenced legacy internal offer. It preserves unknown extension components and treats invoice fee zero as a real value.';

create or replace function public.gridex_complete_unreferenced_internal_invoice_fee_tasks()
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r record;
  v_snapshot jsonb;
  v_readiness jsonb;
  v_processed integer:=0;
  v_resolved integer:=0;
  v_blocked integer:=0;
  v_failed integer:=0;
  v_error text;
begin
  for r in
    select o.*,t.evidence as remediation_evidence
    from public.contract_offers o
    join public.contract_invoice_fee_remediation_tasks t
      on t.source_table='contract_offers' and t.offer_id=o.id
    where t.status in('open','failed')
      and t.blocker_code in('invoice_fee_missing','invoice_fee_conflict','invoice_fee_ambiguous')
      and o.company_id is not null
      and o.invoice_fee_sek is not null
      and o.invoice_fee_sek>=0
      and o.contract_type in('variable_monthly','variable_hourly','variable_quarterly','spot','fixed')
      and o.published_at is null
      and not exists(
        select 1 from public.customer_contracts cc
        where cc.company_id=o.company_id and cc.contract_offer_id=o.id
      )
      and not exists(
        select 1 from public.contract_offer_versions cov
        where (to_jsonb(cov)->>'contract_offer_id'=o.id::text or to_jsonb(cov)->>'offer_id'=o.id::text)
      )
    order by o.created_at,o.id
    for update of o
  loop
    v_processed:=v_processed+1;
    begin
      v_snapshot:=public.gridex_legacy_internal_offer_pricing_snapshot(r.id);
      v_readiness:=public.gridex_invoice_fee_readiness(v_snapshot,r.invoice_fee_sek);

      if coalesce(v_readiness->>'status','blocked')<>'ready' then
        perform public.gridex_record_invoice_fee_remediation(
          r.company_id,'contract_offers',r.id,'open',
          coalesce(v_readiness->>'code','invoice_fee_missing'),
          jsonb_build_object(
            'readiness',v_readiness,
            'snapshot',v_snapshot,
            'strategy','unpublished_unreferenced_in_place'
          )
        );
        v_blocked:=v_blocked+1;
        continue;
      end if;

      update public.contract_offers
      set commercial_snapshot=v_snapshot,
          version_snapshot=coalesce(version_snapshot,'{}'::jsonb)
            || jsonb_build_object(
              'pricing_snapshot',v_snapshot,
              'pricing',coalesce(version_snapshot->'pricing','{}'::jsonb)
                || jsonb_build_object(
                  'monthlyFeeSek',monthly_fee_sek,
                  'invoiceFeeSek',invoice_fee_sek,
                  'spotMarkupOrePerKwh',spot_markup_ore_per_kwh,
                  'variableFeeOrePerKwh',variable_fee_ore_per_kwh,
                  'fixedPriceOrePerKwh',fixed_price_ore_per_kwh,
                  'greenFeeMode',green_fee_mode,
                  'greenFeeValue',green_fee_value
                )
            ),
          updated_at=now()
      where id=r.id and company_id=r.company_id;

      perform public.gridex_record_invoice_fee_remediation(
        r.company_id,'contract_offers',r.id,'resolved',null,
        jsonb_build_object(
          'old_evidence',r.remediation_evidence,
          'new_value',r.invoice_fee_sek,
          'readiness',v_readiness,
          'strategy','unpublished_unreferenced_in_place',
          'history_mutated',false,
          'requires_price_area_before_publication',jsonb_array_length(coalesce(v_snapshot->'price_areas','[]'::jsonb))=0
        )
      );

      insert into public.audit_logs(
        company_id,actor_user_id,entity_type,entity_id,action,old_values,new_values,metadata
      ) values(
        r.company_id,coalesce(r.updated_by,r.created_by),'contract_offer',r.id::text,
        'contract.invoice_fee.legacy_snapshot_completed',
        jsonb_build_object('commercial_snapshot',r.commercial_snapshot,'version_snapshot',r.version_snapshot),
        jsonb_build_object('invoice_fee_sek',r.invoice_fee_sek,'commercial_snapshot',v_snapshot),
        jsonb_build_object(
          'version_safe',true,
          'unpublished',true,
          'customer_references',0,
          'offer_version_references',0,
          'price_area_required_before_publication',jsonb_array_length(coalesce(v_snapshot->'price_areas','[]'::jsonb))=0
        )
      );

      v_resolved:=v_resolved+1;
    exception when others then
      v_error:=sqlerrm;
      perform public.gridex_record_invoice_fee_remediation(
        r.company_id,'contract_offers',r.id,'failed','legacy_snapshot_completion_failed',
        jsonb_build_object(
          'strategy','unpublished_unreferenced_in_place',
          'invoice_fee_sek',r.invoice_fee_sek
        ),v_error
      );
      v_failed:=v_failed+1;
    end;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,'resolved',v_resolved,'blocked',v_blocked,'failed',v_failed
  );
end $$;

revoke all on function public.gridex_legacy_internal_offer_pricing_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.gridex_legacy_internal_offer_pricing_snapshot(uuid) to service_role;
revoke all on function public.gridex_complete_unreferenced_internal_invoice_fee_tasks() from public,anon,authenticated;
grant execute on function public.gridex_complete_unreferenced_internal_invoice_fee_tasks() to service_role;

select public.gridex_complete_unreferenced_internal_invoice_fee_tasks();

commit;
