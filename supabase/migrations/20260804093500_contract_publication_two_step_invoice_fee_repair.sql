-- GRIDEX OPS: make contract publication a two-step flow and repair canonical
-- invoice-fee materialization in website publication snapshots.
--
-- Step 1: publish the immutable contract version internally after readiness.
-- Step 2: optionally publish that exact version on the website.
--
-- The website publication graph is created by the publish RPC. Missing graph
-- rows are therefore not pre-publication blockers. This migration also makes
-- an explicit 0 SEK invoice fee canonical in the publication snapshot.

begin;

create or replace function public.gridex_canonicalize_publication_invoice_fee_v1(
  p_publication_snapshot jsonb,
  p_invoice_fee_sek numeric
) returns jsonb
language plpgsql
immutable
security invoker
set search_path=public,pg_catalog,pg_temp
as $$
declare
  v_snapshot jsonb:=coalesce(p_publication_snapshot,'{}'::jsonb);
  v_commercial jsonb:=coalesce(v_snapshot->'commercial_snapshot','{}'::jsonb);
  v_source_components jsonb;
  v_retained_components jsonb;
  v_visible boolean:=true;
begin
  if p_invoice_fee_sek is null or p_invoice_fee_sek<0 then
    return v_snapshot;
  end if;

  v_source_components:=case
    when jsonb_typeof(v_commercial->'price_components')='array'
      then v_commercial->'price_components'
    when jsonb_typeof(v_commercial->'price_components_snapshot')='array'
      then v_commercial->'price_components_snapshot'
    else '[]'::jsonb
  end;

  select coalesce(
    (
      select case
        when lower(coalesce(component.value->>'website_card_visible','')) in ('true','1') then true
        when lower(coalesce(component.value->>'website_card_visible','')) in ('false','0') then false
        when lower(coalesce(component.value->'metadata'->'visibility'->>'website_card','')) in ('true','1') then true
        when lower(coalesce(component.value->'metadata'->'visibility'->>'website_card','')) in ('false','0') then false
        else null
      end
      from jsonb_array_elements(v_source_components) component(value)
      where coalesce(
        nullif(component.value->>'component_code',''),
        nullif(component.value->>'component_type',''),
        nullif(component.value->'metadata'->>'component_code','')
      )='invoice_fee'
      limit 1
    ),
    case
      when lower(coalesce(v_commercial->'website_visibility'->>'invoice_fee','')) in ('true','1') then true
      when lower(coalesce(v_commercial->'website_visibility'->>'invoice_fee','')) in ('false','0') then false
      else null
    end,
    true
  ) into v_visible;

  select coalesce(jsonb_agg(component.value order by component.ordinality),'[]'::jsonb)
  into v_retained_components
  from jsonb_array_elements(v_source_components) with ordinality
    component(value,ordinality)
  where coalesce(
    nullif(component.value->>'component_code',''),
    nullif(component.value->>'component_type',''),
    nullif(component.value->'metadata'->>'component_code','')
  ) is distinct from 'invoice_fee';

  v_retained_components:=coalesce(v_retained_components,'[]'::jsonb)
    ||jsonb_build_array(jsonb_build_object(
      'component_code','invoice_fee',
      'component_type','invoice_fee',
      'name','Fakturaavgift',
      'amount',p_invoice_fee_sek,
      'calculation_type','per_invoice',
      'unit','sek_invoice',
      'priority',110,
      'status','active',
      'website_card_visible',v_visible,
      'metadata',jsonb_build_object(
        'lifecycle','per_invoice',
        'visibility',jsonb_build_object(
          'website_card',v_visible,
          'quote_breakdown',true,
          'checkout',true,
          'contract_document',true,
          'invoice',true
        )
      )
    ));

  v_commercial:=jsonb_set(
    v_commercial,
    '{price_components}',
    v_retained_components,
    true
  )||jsonb_build_object('invoice_fee_sek',p_invoice_fee_sek);

  return jsonb_set(v_snapshot,'{commercial_snapshot}',v_commercial,true);
end
$$;

create or replace function public.gridex_finalize_contract_publication_v1(
  p_publication_version_id uuid,
  p_actor_user_id uuid default null,
  p_allow_locked_metadata_repair boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_catalog,pg_temp
as $$
declare
  v public.contract_publication_versions%rowtype;
  v_company_id uuid;
  v_channel text;
  v_blockers text[];
  v_price_options jsonb;
  v_legal_snapshot jsonb;
  v_snapshot jsonb;
  v_hash text;
  v_before jsonb;
  v_invoice_fee_sek numeric;
begin
  select pv.* into v
  from public.contract_publication_versions pv
  where pv.id=p_publication_version_id
  for update;

  select a.company_id,p.channel into v_company_id,v_channel
  from public.contract_publications p
  join public.tenant_contract_assignments a on a.id=p.assignment_id
  where p.id=v.contract_publication_id;
  if not found then
    raise exception using errcode='P0002',
      message='PUBLICATION_VERSION_NOT_FOUND';
  end if;
  if v.locked_at is not null and not p_allow_locked_metadata_repair then
    raise exception using errcode='55000',
      message='PUBLICATION_VERSION_NOT_LOCKED_FOR_REPAIR';
  end if;
  v_before:=to_jsonb(v);

  select offer.invoice_fee_sek into v_invoice_fee_sek
  from public.contract_offers offer
  where offer.company_id=v_company_id
    and offer.id::text=v.publication_snapshot->>'source_contract_offer_id';

  if v_invoice_fee_sek is not null then
    v_snapshot:=public.gridex_canonicalize_publication_invoice_fee_v1(
      v.publication_snapshot,
      v_invoice_fee_sek
    );
    if v_snapshot is distinct from v.publication_snapshot then
      if v.locked_at is not null then
        perform set_config('gridex.version_transition','on',true);
        perform set_config('gridex.publication_graph_repair','on',true);
      end if;
      v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');
      update public.contract_publication_versions
      set publication_snapshot=v_snapshot,content_sha256=v_hash
      where id=v.id;
      if v.locked_at is not null then
        perform set_config('gridex.publication_graph_repair','off',true);
      end if;
      v.publication_snapshot:=v_snapshot;
      v.content_sha256:=v_hash;
    end if;
  end if;

  perform public.gridex_materialize_publication_price_options_v1(
    v.id,p_actor_user_id
  );
  v_blockers:=public.gridex_validate_publication_graph_v1(v.id);
  if cardinality(v_blockers)>0 then
    raise exception using errcode='23514',
      message=coalesce(v_blockers[1],'PUBLICATION_SNAPSHOT_INVALID'),
      detail=to_jsonb(v_blockers)::text;
  end if;

  v_price_options:=public.gridex_publication_price_options_json_v1(v.id);
  select jsonb_build_object(
    'legal_bundle_version_id',b.id,
    'status',b.status,
    'content_sha256',b.content_sha256,
    'documents',coalesce((select jsonb_agg(jsonb_build_object(
      'module_key',d.module_key,'content_sha256',d.content_sha256
    ) order by d.sort_order,d.module_key)
      from public.legal_bundle_version_documents d
      where d.legal_bundle_version_id=b.id),'[]'::jsonb)
  ) into v_legal_snapshot
  from public.legal_bundle_versions b
  where b.id=v.legal_bundle_version_id;

  select publication_snapshot into v_snapshot
  from public.contract_publication_versions
  where id=v.id;

  v_snapshot:=coalesce(v_snapshot,'{}'::jsonb)
    ||jsonb_build_object(
      'schema','gridex_contract_publication_v6',
      'channel',v_channel,
      'offer_reference',v.offer_reference,
      'price_options',v_price_options,
      'supported_price_areas',to_jsonb(
        public.gridex_supported_price_areas_v1(
          v.contract_product_version_id
        )
      ),
      'legal_snapshot',coalesce(v_legal_snapshot,'{}'::jsonb)
    );
  v_hash:=encode(extensions.digest(v_snapshot::text,'sha256'),'hex');

  perform set_config('gridex.version_transition','on',true);
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','on',true);
  end if;
  update public.contract_publication_versions
  set publication_snapshot=v_snapshot,content_sha256=v_hash,
      status='published',published_at=coalesce(published_at,now()),
      locked_at=coalesce(locked_at,now())
  where id=v.id;
  if v.locked_at is not null then
    perform set_config('gridex.publication_graph_repair','off',true);
  end if;
  update public.contract_publications
  set status='published',updated_at=now()
  where id=v.contract_publication_id;

  insert into public.audit_logs(
    company_id,actor_user_id,entity_type,entity_id,action,
    old_values,new_values,metadata
  ) values(
    v_company_id,p_actor_user_id,'contract_publication_version',v.id::text,
    case when v.locked_at is null then 'contract_publication_finalized'
      else 'contract_publication_graph_repaired' end,
    v_before,(select to_jsonb(current_row)
      from public.contract_publication_versions current_row
      where current_row.id=v.id),
    jsonb_build_object(
      'channel',v_channel,
      'commercial_values_changed',false,
      'invoice_fee_canonicalized',v_invoice_fee_sek is not null
    )
  );

  return jsonb_build_object('ok',true,'publication_version_id',v.id,
    'channel',v_channel,'content_sha256',v_hash,
    'price_options',v_price_options,'blockers','[]'::jsonb);
end
$$;

revoke all on function public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)
  from public,anon,authenticated;
grant execute on function public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric)
  to service_role;

comment on function public.gridex_canonicalize_publication_invoice_fee_v1(jsonb,numeric) is
  'Upserts exactly one canonical per-invoice fee component, including explicit 0 SEK, into a publication commercial snapshot.';
comment on function public.gridex_finalize_contract_publication_v1(uuid,uuid,boolean) is
  'Finalizes the exact contract publication graph and repairs derived invoice-fee snapshot materialization before fail-closed validation.';

commit;
